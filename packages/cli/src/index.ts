#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildCallTree, compareSessions, formatPercent, hasRegression, summarizePerformance } from "@codeflow/analyzer";
import { exportSession, type ExportFormat } from "@codeflow/exporters";
import { recordBrowserSession } from "@codeflow/integration-playwright";
import { parseSessionJson, type ExecutionSession, type RegressionThresholds } from "@codeflow/session";

const requireFromHere = createRequire(import.meta.url);
const cliDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(cliDir, "../../..");

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

export async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case undefined:
    case "-h":
    case "--help":
    case "help":
      printHelp();
      return;
    case "init":
      initProject(rest);
      return;
    case "record":
      await recordCommand(rest);
      return;
    case "open":
      await openSession(rest);
      return;
    case "inspect":
      inspectSession(rest);
      return;
    case "compare":
      compareCommand(rest);
      return;
    case "report":
      reportCommand(rest);
      return;
    case "validate":
      validateCommand(rest);
      return;
    case "record-browser":
      await recordBrowserCommand(rest);
      return;
    case "browser":
      await browserCommand(rest);
      return;
    default:
      throw new Error(`Unknown command: ${command}\nRun codeflow --help for usage.`);
  }
}

function initProject(_args: string[]): void {
  const codeflowDir = path.join(process.cwd(), ".codeflow");
  fs.mkdirSync(codeflowDir, { recursive: true });
  const configFile = path.join(codeflowDir, "config.yaml");
  if (!fs.existsSync(configFile)) {
    fs.writeFileSync(
      configFile,
      [
        "performance:",
        "  maxRegressionPercent: 20",
        "  maxNewErrors: 0",
        "",
        "privacy:",
        "  captureBodies: false",
        "  maxBodyBytes: 4096",
        "  captureAuthorizationHeaders: false",
        ""
      ].join("\n"),
      "utf8"
    );
  }

  const gitignore = path.join(process.cwd(), ".gitignore");
  const entry = ".codeflow/";
  if (fs.existsSync(gitignore)) {
    const existing = fs.readFileSync(gitignore, "utf8");
    if (!existing.split(/\r?\n/).includes(entry)) {
      fs.appendFileSync(gitignore, existing.endsWith("\n") ? `${entry}\n` : `\n${entry}\n`, "utf8");
    }
  } else {
    fs.writeFileSync(gitignore, `${entry}\n`, "utf8");
  }

  console.log(`Initialized CodeFlow in ${codeflowDir}`);
}

async function recordCommand(args: string[]): Promise<void> {
  const separator = args.indexOf("--");
  const optionArgs = separator === -1 ? [] : args.slice(0, separator);
  const commandArgs = separator === -1 ? args : args.slice(separator + 1);
  const output = readOption(optionArgs, "--output", "-o") ?? defaultSessionFile();
  const projectName = readOption(optionArgs, "--project") ?? path.basename(process.cwd());
  const privacy = {
    ...readPrivacyConfig(process.cwd()),
    ...readCliPrivacy(optionArgs)
  };

  if (commandArgs.length === 0) {
    throw new Error("Usage: codeflow record [--output session.json] [--capture-bodies] [--max-body-bytes 4096] -- <command>");
  }

  const registerPath = requireFromHere.resolve("@codeflow/recorder/register");
  const nodeOptions = appendNodeOptions(process.env.NODE_OPTIONS, [
    "--enable-source-maps",
    `--import=${pathToFileURL(registerPath).href}`
  ]);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(commandArgs[0], commandArgs.slice(1), {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_OPTIONS: nodeOptions,
        CODEFLOW_SESSION_FILE: path.resolve(output),
        CODEFLOW_PROJECT_ROOT: process.cwd(),
        CODEFLOW_PROJECT_NAME: projectName,
        CODEFLOW_COMMAND_JSON: JSON.stringify(commandArgs),
        CODEFLOW_VERSION: "0.1.0",
        CODEFLOW_CAPTURE_HTTP_BODIES: privacy.captureBodies ? "1" : "0",
        CODEFLOW_MAX_HTTP_BODY_BYTES: String(privacy.maxBodyBytes ?? 4096)
      }
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (!fs.existsSync(output)) {
        reject(new Error(`Recording finished but no session was written to ${output}. Exit code ${code ?? signal ?? "unknown"}.`));
        return;
      }

      const session = loadSession(output);
      const summary = summarizePerformance(session);
      console.log("");
      console.log(`CodeFlow session: ${path.resolve(output)}`);
      console.log(`Events: ${session.events.length}, calls: ${session.calls.length}, HTTP: ${session.http.length}, errors: ${session.errors.length}`);
      console.log(`Total observed runtime: ${summary.totalDuration.toFixed(1)}ms`);
      if (typeof code === "number" && code !== 0) {
        process.exitCode = code;
      }
      resolve();
    });
  });
}

async function openSession(args: string[]): Promise<void> {
  const file = firstPositional(args);
  if (!file) {
    throw new Error("Usage: codeflow open <session.json> [--compare before.json] [--threshold 20] [--port 3939] [--no-open]");
  }
  const sessionPath = path.resolve(file);
  loadSession(sessionPath);
  const comparePath = readOption(args, "--compare");
  const resolvedComparePath = comparePath ? path.resolve(comparePath) : undefined;
  if (resolvedComparePath) {
    loadSession(resolvedComparePath);
  }
  const threshold = readOption(args, "--threshold");
  const port = Number(readOption(args, "--port", "-p") ?? "3939");
  const noOpen = args.includes("--no-open");
  const { url } = await startViewerServer({
    sessionPath,
    compareSessionPath: resolvedComparePath,
    threshold,
    port
  });
  console.log(`CodeFlow viewer: ${url}`);
  console.log("Press Ctrl+C to stop.");
  if (!noOpen) {
    openBrowser(url);
  }
}

function inspectSession(args: string[]): void {
  const file = firstPositional(args);
  if (!file) {
    throw new Error("Usage: codeflow inspect <session.json>");
  }
  const session = loadSession(file);
  const performance = summarizePerformance(session);
  const tree = buildCallTree(session, "duration");
  console.log(`CodeFlow Session: ${session.metadata.project}`);
  console.log(`Runtime: ${session.metadata.runtime} ${session.metadata.runtimeVersion}`);
  console.log(`Total: ${performance.totalDuration.toFixed(1)}ms`);
  console.log(`Events: ${session.events.length}`);
  console.log(`Calls: ${session.calls.length}`);
  console.log(`HTTP: ${session.http.length}`);
  console.log(`Errors: ${session.errors.length}`);
  console.log("");
  console.log("Top contributors:");
  for (const item of performance.topContributors.slice(0, 8)) {
    console.log(`  ${item.name} (${item.kind}) ${item.duration.toFixed(1)}ms`);
  }
  console.log("");
  console.log("Call tree:");
  for (const node of tree) {
    printTree(node, 0);
  }
}

function compareCommand(args: string[]): void {
  const positionals = args.filter((arg, index) => !arg.startsWith("-") && !isOptionValue(args, index));
  const beforeFile = positionals[0];
  const afterFile = positionals[1];
  if (!beforeFile || !afterFile) {
    throw new Error("Usage: codeflow compare <before.json> <after.json> [--threshold 20]");
  }

  const thresholds = {
    ...readConfigThresholds(process.cwd()),
    ...readCliThresholds(args)
  };
  const before = loadSession(beforeFile);
  const after = loadSession(afterFile);
  const comparison = compareSessions(before, after, thresholds);

  console.log(`${before.metadata.project}`);
  console.log("");
  console.log(`Before: ${comparison.beforeTotal.toFixed(1)}ms`);
  console.log(`After: ${comparison.afterTotal.toFixed(1)}ms`);
  console.log(`Observed change: ${comparison.totalDelta.toFixed(1)}ms (${formatPercent(comparison.totalPercent)})`);
  console.log("");
  console.log("Primary observed differences:");
  for (const entry of comparison.regressions.slice(0, 8)) {
    console.log(`  ${entry.name}`);
    console.log(`    ${entry.before.toFixed(1)}ms -> ${entry.after.toFixed(1)}ms (${formatPercent(entry.percent)})`);
  }

  const countDifferences = [...comparison.callCounts, ...comparison.databaseCounts]
    .filter((entry) => entry.delta !== 0)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
    .slice(0, 6);
  if (countDifferences.length > 0) {
    console.log("");
    console.log("Observed count differences:");
    for (const entry of countDifferences) {
      console.log(`  ${entry.name}: ${entry.before.toFixed(0)} -> ${entry.after.toFixed(0)} (${entry.delta > 0 ? "+" : ""}${entry.delta.toFixed(0)})`);
    }
  }

  if (comparison.thresholdFailures.length > 0) {
    console.log("");
    console.log("Regression detected:");
    comparison.thresholdFailures.forEach((failure) => console.log(`  ${failure}`));
  }

  if (hasRegression(comparison)) {
    process.exitCode = 1;
  }
}

function reportCommand(args: string[]): void {
  const file = firstPositional(args);
  if (!file) {
    throw new Error("Usage: codeflow report <session.json> [--format json|html|markdown] [--output file]");
  }
  const format = (readOption(args, "--format", "-f") ?? "markdown") as ExportFormat;
  const output = readOption(args, "--output", "-o");
  const session = loadSession(file);
  const rendered = exportSession(session, format);
  if (output) {
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, rendered, "utf8");
    console.log(`Report written to ${path.resolve(output)}`);
  } else {
    process.stdout.write(rendered);
  }
}

function validateCommand(args: string[]): void {
  const file = firstPositional(args);
  if (!file) {
    throw new Error("Usage: codeflow validate <session.json>");
  }
  loadSession(file);
  console.log(`Valid CodeFlow session: ${path.resolve(file)}`);
}

async function recordBrowserCommand(args: string[]): Promise<void> {
  const url = firstPositional(args);
  if (!url) {
    throw new Error("Usage: codeflow record-browser <url> [--output session.json] [--timeout-ms 30000] [--settle-ms 500] [--headed]");
  }
  const output = readOption(args, "--output", "-o") ?? defaultSessionFile("browser");
  const timeoutMs = readNumberOption(args, "--timeout-ms");
  const settleMs = readNumberOption(args, "--settle-ms");
  const session = await recordBrowserSession({
    url,
    outputFile: path.resolve(output),
    projectRoot: process.cwd(),
    timeoutMs,
    settleMs,
    headless: !args.includes("--headed")
  });
  console.log(`Browser session: ${path.resolve(output)}`);
  console.log(`Events: ${session.events.length}, HTTP: ${session.http.length}, errors: ${session.errors.length}`);
}

async function browserCommand(args: string[]): Promise<void> {
  const url = readOption(args, "--url") ?? "http://127.0.0.1:3000";
  const separator = args.indexOf("--");
  const commandArgs = separator === -1 ? [] : args.slice(separator + 1);
  if (commandArgs.length === 0) {
    await recordBrowserCommand([url, ...args]);
    return;
  }

  const output = readOption(args.slice(0, separator), "--output", "-o") ?? defaultSessionFile("browser");
  const child = spawn(commandArgs[0], commandArgs.slice(1), {
    stdio: "inherit",
    env: process.env
  });

  try {
    await waitForUrl(url, 30000);
    await recordBrowserSession({
      url,
      outputFile: path.resolve(output),
      projectRoot: process.cwd(),
      timeoutMs: readNumberOption(args, "--timeout-ms"),
      settleMs: readNumberOption(args, "--settle-ms"),
      headless: !args.includes("--headed")
    });
    console.log(`Browser session: ${path.resolve(output)}`);
  } finally {
    child.kill("SIGTERM");
  }
}

function loadSession(file: string): ExecutionSession {
  const absolute = path.resolve(file);
  const result = parseSessionJson(fs.readFileSync(absolute, "utf8"));
  if (!result.ok) {
    throw new Error(`Invalid session ${absolute}:\n${result.errors.join("\n")}`);
  }
  return result.session;
}

async function startViewerServer(options: { sessionPath: string; compareSessionPath?: string; threshold?: string; port: number }): Promise<{ url: string }> {
  const viewerDist = findViewerDist();
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    if (requestUrl.pathname === "/api/session") {
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(fs.readFileSync(options.sessionPath, "utf8"));
      return;
    }

    if (requestUrl.pathname === "/api/compare-session" && options.compareSessionPath) {
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(fs.readFileSync(options.compareSessionPath, "utf8"));
      return;
    }

    const filePath = safeStaticPath(viewerDist, requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      response.setHeader("content-type", contentType(filePath));
      response.end(fs.readFileSync(filePath));
      return;
    }

    if (requestUrl.pathname !== "/" && fs.existsSync(path.join(viewerDist, "index.html"))) {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(fs.readFileSync(path.join(viewerDist, "index.html")));
      return;
    }

    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(fallbackViewerHtml());
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => resolve());
  });

  const search = new URLSearchParams({ session: "/api/session" });
  if (options.compareSessionPath) {
    search.set("compare", "/api/compare-session");
  }
  if (options.threshold) {
    search.set("threshold", options.threshold);
  }
  return { url: `http://127.0.0.1:${options.port}/?${search.toString()}` };
}

function safeStaticPath(root: string, urlPath: string): string | undefined {
  const decoded = decodeURIComponent(urlPath);
  const absolute = path.resolve(root, decoded.replace(/^\/+/, ""));
  const normalizedRoot = path.resolve(root);
  return absolute === normalizedRoot || absolute.startsWith(`${normalizedRoot}${path.sep}`) ? absolute : undefined;
}

function findViewerDist(): string {
  const packageViewerDist = path.join(cliDir, "viewer");
  if (fs.existsSync(path.join(packageViewerDist, "index.html"))) {
    return packageViewerDist;
  }
  return path.join(repoRoot, "apps", "viewer", "dist");
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (filePath.endsWith(".svg")) {
    return "image/svg+xml";
  }
  return "application/octet-stream";
}

function openBrowser(url: string): void {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", url] : [url];
  const child = spawn(opener, args, { detached: true, stdio: "ignore" });
  child.unref();
}

function appendNodeOptions(existing: string | undefined, additions: string[]): string {
  return [...(existing ? [existing] : []), ...additions].join(" ");
}

function readOption(args: string[], long: string, short?: string): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === long || (short && arg === short)) {
      return args[index + 1];
    }
    if (arg.startsWith(`${long}=`)) {
      return arg.slice(long.length + 1);
    }
  }
  return undefined;
}

function readNumberOption(args: string[], long: string): number | undefined {
  const value = readOption(args, long);
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function firstPositional(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("-") && !isOptionValue(args, index)) {
      return arg;
    }
  }
  return undefined;
}

function isOptionValue(args: string[], index: number): boolean {
  const previous = args[index - 1];
  return Boolean(previous && (previous === "--output" || previous === "-o" || previous === "--format" || previous === "-f" || previous === "--port" || previous === "-p" || previous === "--threshold" || previous === "--url" || previous === "--project" || previous === "--compare" || previous === "--max-body-bytes" || previous === "--timeout-ms" || previous === "--settle-ms"));
}

function readCliThresholds(args: string[]): RegressionThresholds {
  const threshold = readOption(args, "--threshold");
  return threshold ? { maxRegressionPercent: Number(threshold) } : {};
}

function readCliPrivacy(args: string[]): { captureBodies?: boolean; maxBodyBytes?: number } {
  return {
    captureBodies: args.includes("--capture-bodies") ? true : undefined,
    maxBodyBytes: readNumberOption(args, "--max-body-bytes")
  };
}

function readConfigThresholds(cwd: string): RegressionThresholds {
  const file = path.join(cwd, ".codeflow", "config.yaml");
  if (!fs.existsSync(file)) {
    return {};
  }

  const thresholds: RegressionThresholds = {};
  let inPerformance = false;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (/^\s*performance:\s*$/.test(line)) {
      inPerformance = true;
      continue;
    }
    if (/^\S/.test(line)) {
      inPerformance = false;
    }
    if (!inPerformance) {
      continue;
    }
    const match = /^\s+([A-Za-z0-9_]+):\s*([0-9.]+)\s*$/.exec(line);
    if (!match) {
      continue;
    }
    const value = Number(match[2]);
    if (match[1] === "maxRegressionPercent") {
      thresholds.maxRegressionPercent = value;
    }
    if (match[1] === "maxTotalDurationMs") {
      thresholds.maxTotalDurationMs = value;
    }
    if (match[1] === "maxNewErrors") {
      thresholds.maxNewErrors = value;
    }
  }
  return thresholds;
}

function readPrivacyConfig(cwd: string): { captureBodies?: boolean; maxBodyBytes?: number } {
  const file = path.join(cwd, ".codeflow", "config.yaml");
  if (!fs.existsSync(file)) {
    return {};
  }

  const privacy: { captureBodies?: boolean; maxBodyBytes?: number } = {};
  let inPrivacy = false;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (/^\s*privacy:\s*$/.test(line)) {
      inPrivacy = true;
      continue;
    }
    if (/^\S/.test(line)) {
      inPrivacy = false;
    }
    if (!inPrivacy) {
      continue;
    }
    const match = /^\s+([A-Za-z0-9_]+):\s*(\S+)\s*$/.exec(line);
    if (!match) {
      continue;
    }
    if (match[1] === "captureBodies") {
      privacy.captureBodies = match[2] === "true";
    }
    if (match[1] === "maxBodyBytes") {
      const parsed = Number(match[2]);
      if (Number.isFinite(parsed) && parsed > 0) {
        privacy.maxBodyBytes = parsed;
      }
    }
  }
  return privacy;
}

function defaultSessionFile(kind = "session"): string {
  return path.join(".codeflow", `${kind}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
}

function printTree(node: ReturnType<typeof buildCallTree>[number], depth: number): void {
  const marker = depth === 0 ? "" : `${"  ".repeat(depth)}- `;
  console.log(`${marker}${node.name} ${node.totalDuration.toFixed(1)}ms self ${node.selfDuration.toFixed(1)}ms errors ${node.errorCount}`);
  for (const child of node.children) {
    printTree(child, depth + 1);
  }
}

async function waitForUrl(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      await response.arrayBuffer();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function fallbackViewerHtml(): string {
  return `<!doctype html><html><head><title>CodeFlow Viewer</title></head><body><main style="font-family: system-ui; padding: 32px;"><h1>CodeFlow Viewer</h1><p>The built viewer was not found. Run <code>npm run build</code>, then try <code>codeflow open</code> again.</p></main></body></html>`;
}

function printHelp(): void {
  console.log(`CodeFlow

Understand what your code actually did.

Usage:
  codeflow init
  codeflow record [--output session.json] [--capture-bodies] [--max-body-bytes 4096] -- <command>
  codeflow open <session.json> [--compare before.json] [--threshold 20] [--port 3939] [--no-open]
  codeflow inspect <session.json>
  codeflow compare <before.json> <after.json> [--threshold 20]
  codeflow report <session.json> [--format json|markdown|html] [--output file]
  codeflow validate <session.json>
  codeflow record-browser <url> [--output session.json] [--timeout-ms 30000] [--settle-ms 500]
`);
}
