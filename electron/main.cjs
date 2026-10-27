// The desktop app is the Next.js standalone server (the same server.js the
// Docker image runs) plus a window. Browse, read, and live subscriptions stay
// in that server, so web and desktop share one codebase.
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const profiles = require("./profiles.cjs");

const APP_NAME = "OPC UA Viewer";

app.setName(APP_NAME);

let mainWindow = null;
let serverProcess = null;
let quitting = false;
let logTail = "";

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(start).catch((error) => {
    console.error(error);
    app.exit(1);
  });
}

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  shutdownServer();
});

process.on("SIGTERM", () => app.quit());
process.on("SIGINT", () => app.quit());

async function start() {
  const userData = app.getPath("userData");
  fs.mkdirSync(userData, { recursive: true });
  console.log(`OPC UA Viewer userData: ${userData}`);
  registerProfiles(path.join(userData, "connection-profiles.json"));

  const directory = standaloneDir();
  const serverJs = path.join(directory, "server.js");
  if (!fs.existsSync(serverJs)) {
    await fail(`Could not find the app server at ${serverJs}`);
    return;
  }

  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const launched = launchServer({ directory, serverJs, port, userData });
  serverProcess = launched.child;
  try {
    await waitForHttp(origin, launched.child);
    launched.markReady();
  } catch (error) {
    const message = error instanceof Error ? error.message : "The local server did not start";
    await fail(`${message}\n\n${logTail}`.trim());
    return;
  }

  console.log(`OPC UA Viewer serving ${origin}`);
  createWindow(origin);
}

function registerProfiles(file) {
  ipcMain.handle("profiles:list", (event) => {
    assertLocal(event);
    return profiles.listProfiles(file);
  });
  ipcMain.handle("profiles:save", (event, input) => {
    assertLocal(event);
    return profiles.saveProfile(file, input);
  });
  ipcMain.handle("profiles:delete", (event, id) => {
    assertLocal(event);
    profiles.deleteProfile(file, id);
  });
}

function assertLocal(event) {
  const url = event.senderFrame?.url ?? "";
  if (!url.startsWith("http://127.0.0.1:")) {
    throw new Error("Rejected profile request");
  }
}

function standaloneDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, "standalone");
  return path.join(__dirname, "..", "desktop-bundle");
}

function launchServer({ directory, serverJs, port, userData }) {
  const logFile = path.join(userData, "server.log");
  fs.writeFileSync(logFile, "");
  logTail = "";

  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("ELECTRON_") || key === "ATOM_SHELL_INTERNAL_RUN_AS_NODE") {
      delete env[key];
    }
  }
  // AppImage sets these. A child that inherits them can relaunch the GUI
  // instead of running as Node.
  delete env.APPIMAGE;
  delete env.APPDIR;
  delete env.ARGV0;
  delete env.OWD;

  env.ELECTRON_RUN_AS_NODE = "1";
  env.ELECTRON_NO_ASAR = "1";
  env.NODE_ENV = "production";
  env.PORT = String(port);
  env.HOSTNAME = "127.0.0.1";
  env.OPCUA_APPLICATION_NAME = APP_NAME;

  const child = spawn(process.execPath, [serverJs], {
    cwd: directory,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let ready = false;

  const record = (chunk) => {
    logTail = (logTail + chunk.toString()).slice(-4000);
    fs.appendFile(logFile, chunk, () => undefined);
  };
  child.stdout.on("data", record);
  child.stderr.on("data", record);
  child.on("error", (error) => {
    record(Buffer.from(`\nFailed to start server: ${error.message}\n`));
  });
  child.on("exit", (code, signal) => {
    if (quitting || !ready) return;
    const detail = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
    void fail(`The local server stopped (${detail}).\n\n${logTail}`.trim());
  });
  return {
    child,
    markReady() {
      ready = true;
    },
  };
}

function createWindow(origin) {
  const icon = windowIcon();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: "#252525",
    autoHideMenuBar: true,
    show: false,
    icon,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(origin)) event.preventDefault();
  });

  void mainWindow.loadURL(origin);
}

function windowIcon() {
  const packaged = path.join(process.resourcesPath, "icon.png");
  if (fs.existsSync(packaged)) return packaged;
  const dev = path.join(__dirname, "icon.png");
  if (fs.existsSync(dev)) return dev;
  return undefined;
}

function shutdownServer() {
  quitting = true;
  if (!serverProcess || serverProcess.killed) return;
  serverProcess.kill("SIGTERM");
  const pid = serverProcess.pid;
  setTimeout(() => {
    try {
      if (pid) process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }, 2000).unref();
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function waitForHttp(url, child) {
  const timeoutMs = 45_000;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      child.removeListener("exit", onExit);
      if (error) reject(error);
      else resolve();
    };
    const onExit = (code, signal) => {
      const detail = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      finish(new Error(`The local server exited (${detail}) before it was ready`));
    };
    child.once("exit", onExit);

    const tick = () => {
      if (settled) return;
      if (Date.now() - started > timeoutMs) {
        finish(new Error("The local server did not start"));
        return;
      }
      const request = http.get(url, (response) => {
        response.resume();
        if ((response.statusCode ?? 500) < 500) {
          finish();
          return;
        }
        setTimeout(tick, 200);
      });
      request.setTimeout(2000, () => request.destroy());
      request.on("error", () => {
        if (!settled) setTimeout(tick, 200);
      });
    };
    tick();
  });
}

async function fail(message) {
  console.error(message);
  shutdownServer();
  if (app.isReady()) {
    dialog.showErrorBox(APP_NAME, message.slice(0, 2000));
  }
  app.exit(1);
}
