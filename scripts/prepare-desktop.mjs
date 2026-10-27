import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
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
// Copy real files instead of pnpm symlinks. Installers on Windows do not keep
// those links, and electron-builder skips a root node_modules folder unless it
// is copied as a plain directory tree.
copyTree(standalone, dest, realpathSync(standalone));
copyTree(staticDir, path.join(dest, ".next", "static"), realpathSync(staticDir));

const pub = path.join(root, "public");
if (existsSync(pub)) copyTree(pub, path.join(dest, "public"), realpathSync(pub));

console.log(`Prepared ${dest} (${formatMb(directorySize(dest))})`);

function copyTree(src, target, sourceRoot, stack = new Set()) {
  const stat = lstatSync(src);
  if (stat.isSymbolicLink()) {
    let resolved;
    try {
      resolved = realpathSync(src);
    } catch {
      return;
    }
    if (resolved !== sourceRoot && !resolved.startsWith(sourceRoot + path.sep)) return;
    copyTree(resolved, target, sourceRoot, stack);
    return;
  }
  if (stat.isDirectory()) {
    const real = realpathSync(src);
    if (stack.has(real)) return;
    stack.add(real);
    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(src)) {
      copyTree(path.join(src, name), path.join(target, name), sourceRoot, stack);
    }
    stack.delete(real);
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
