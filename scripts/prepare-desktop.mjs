import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");
const serverJs = path.join(standalone, "server.js");
const staticDir = path.join(root, ".next", "static");
const dest = path.join(root, "desktop-bundle");

if (!existsSync(serverJs) || !existsSync(staticDir)) {
  console.error("Missing the Next.js standalone build. Run pnpm build first.");
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
// Keep pnpm's directory links. Next resolves packages by walking up from the
// real package directory inside node_modules/.pnpm, so flattening those links
// breaks the server.
copyTree(standalone, dest);
copyTree(staticDir, path.join(dest, ".next", "static"));

const pub = path.join(root, "public");
if (existsSync(pub)) copyTree(pub, path.join(dest, "public"));

console.log(`Prepared ${dest} (${formatMb(directorySize(dest))})`);

function copyTree(src, target) {
  const stat = lstatSync(src);
  if (stat.isSymbolicLink()) {
    const link = readlinkSync(src);
    const resolved = path.resolve(path.dirname(src), link);
    if (!existsSync(resolved)) return;
    mkdirSync(path.dirname(target), { recursive: true });
    symlinkSync(link, target);
    return;
  }
  if (stat.isDirectory()) {
    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(src)) {
      copyTree(path.join(src, name), path.join(target, name));
    }
    return;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(src, target);
}

function directorySize(directory) {
  let total = 0;
  for (const name of readdirSync(directory)) {
    const child = path.join(directory, name);
    const stat = lstatSync(child);
    if (stat.isSymbolicLink()) continue;
    total += stat.isDirectory() ? directorySize(child) : stat.size;
  }
  return total;
}

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
