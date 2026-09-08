import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const targets = [
  "apps/viewer/dist",
  "packages/session/dist",
  "packages/parser/dist",
  "packages/core/dist",
  "packages/instrumentation/dist",
  "packages/recorder/dist",
  "packages/analyzer/dist",
  "packages/exporters/dist",
  "packages/cli/dist",
  "integrations/node/dist",
  "integrations/playwright/dist",
  "coverage"
];

for (const target of targets) {
  fs.rmSync(path.join(root, target), { recursive: true, force: true });
}

console.log("Cleaned build outputs.");
