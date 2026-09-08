import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "apps", "viewer", "dist");
const target = path.join(root, "packages", "cli", "dist", "viewer");

if (!fs.existsSync(path.join(source, "index.html"))) {
  throw new Error("Viewer build not found. Run `npm run build:viewer` before copying CLI assets.");
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(source, target, { recursive: true });

console.log(`Copied viewer assets to ${path.relative(root, target)}`);
