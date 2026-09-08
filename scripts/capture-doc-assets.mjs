import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "packages/cli/dist/index.js");
const assetsDir = path.join(root, "docs", "assets");
const workDir = path.join(root, ".codeflow", "docs-assets");
const before = path.join(workDir, "before.json");
const after = path.join(workDir, "after.json");

fs.mkdirSync(assetsDir, { recursive: true });
fs.mkdirSync(workDir, { recursive: true });

run([cli, "record", "--output", before, "--", process.execPath, "examples/demo.js"]);
run([cli, "record", "--output", after, "--", process.execPath, "examples/demo.js"], {
  CODEFLOW_DEMO_REGRESSION: "1"
});

await withViewer([cli, "open", after, "--compare", before, "--threshold", "20", "--no-open", "--port", "3961"], async (url) => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(assetsDir, "viewer-session.png"), fullPage: true });
  await page.getByTestId("comparison-view").screenshot({ path: path.join(assetsDir, "viewer-comparison.png") });
  await browser.close();
});

console.log("Captured docs assets:");
console.log(`  ${path.relative(root, path.join(assetsDir, "viewer-session.png"))}`);
console.log(`  ${path.relative(root, path.join(assetsDir, "viewer-comparison.png"))}`);

function run(args, env = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${process.execPath} ${args.join(" ")}`);
  }
}

async function withViewer(args, fn) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: process.env
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  try {
    const url = await waitForUrl(() => stdout, () => stderr);
    await fn(url);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      child.once("exit", resolve);
      setTimeout(resolve, 1000);
    });
  }
}

async function waitForUrl(readStdout, readStderr) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const match = /CodeFlow viewer: (http:\/\/127\.0\.0\.1:\d+\/\S*)/.exec(readStdout());
    if (match) {
      return match[1];
    }
    if (readStderr()) {
      throw new Error(readStderr());
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for docs viewer URL");
}
