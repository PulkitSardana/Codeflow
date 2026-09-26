import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");

const packages = [
  { name: "@codeflow/session", directory: "packages/session" },
  { name: "@codeflow/parser", directory: "packages/parser" },
  { name: "@codeflow/core", directory: "packages/core" },
  { name: "@codeflow/instrumentation", directory: "packages/instrumentation" },
  { name: "@codeflow/integration-node", directory: "integrations/node" },
  { name: "@codeflow/recorder", directory: "packages/recorder" },
  { name: "@codeflow/analyzer", directory: "packages/analyzer" },
  { name: "@codeflow/exporters", directory: "packages/exporters" },
  { name: "@codeflow/integration-playwright", directory: "integrations/playwright" },
  { name: "@codeflow/cli", directory: "packages/cli" }
];

const manifests = packages.map(({ name, directory }) => {
  const manifestPath = path.join(root, directory, "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.name !== name) {
    throw new Error(`Expected ${manifestPath} to declare ${name}.`);
  }
  if (manifest.private) {
    throw new Error(`${name} is private and cannot be published.`);
  }
  return manifest;
});

const versions = new Set(manifests.map((manifest) => manifest.version));
if (versions.size !== 1) {
  throw new Error(`All release packages must share one version. Found: ${[...versions].join(", ")}.`);
}

if (!dryRun && !process.env.NODE_AUTH_TOKEN) {
  throw new Error("NODE_AUTH_TOKEN is required for a real npm publish.");
}

for (const { name, directory } of packages) {
  const args = ["publish", "--access", "public"];
  if (dryRun) {
    args.push("--dry-run");
  } else {
    args.push("--provenance");
  }

  console.log(`\n${dryRun ? "Verifying" : "Publishing"} ${name}@${manifests.find((manifest) => manifest.name === name).version}`);
  execFileSync("npm", args, { cwd: path.join(root, directory), stdio: "inherit" });
}
