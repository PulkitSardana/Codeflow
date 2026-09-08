import os from "node:os";
import path from "node:path";
import { serializeError } from "@codeflow/parser";
import { installNodeInstrumentation } from "@codeflow/integration-node";
import { setRecorderBridge } from "@codeflow/core";
import { CodeFlowRecorder } from "./recorder.js";

const outputFile = process.env.CODEFLOW_SESSION_FILE ?? path.join(process.cwd(), ".codeflow", `session-${safeTimestamp()}.json`);
const projectRoot = process.env.CODEFLOW_PROJECT_ROOT ?? process.cwd();
const command = parseCommand(process.env.CODEFLOW_COMMAND_JSON) ?? process.argv.slice(1);

const recorder = new CodeFlowRecorder({
  outputFile,
  projectRoot,
  metadata: {
    project: process.env.CODEFLOW_PROJECT_NAME ?? path.basename(projectRoot),
    runtime: "node",
    runtimeVersion: process.version,
    timestamp: new Date().toISOString(),
    rootDir: projectRoot,
    command,
    codeflowVersion: process.env.CODEFLOW_VERSION ?? "0.1.0",
    platform: os.platform(),
    arch: os.arch(),
    privacy: {
      captureBodies: process.env.CODEFLOW_CAPTURE_HTTP_BODIES === "1",
      maxBodyBytes: numberFromEnv(process.env.CODEFLOW_MAX_HTTP_BODY_BYTES, 4096),
      headersRedacted: true
    }
  }
});

recorder.installAsGlobal();
recorder.start();

const restore = installNodeInstrumentation({ projectRoot });
let finished = false;

function finish(exitCode: number | null): void {
  if (finished) {
    return;
  }
  finished = true;
  try {
    recorder.stop(exitCode);
  } finally {
    restore();
    setRecorderBridge(undefined);
  }
}

process.once("exit", (code) => finish(code));

process.once("SIGINT", () => {
  finish(130);
  process.exit(130);
});

process.once("SIGTERM", () => {
  finish(143);
  process.exit(143);
});

process.on("uncaughtException", (error) => {
  const serialized = serializeError(error);
  recorder.recordError({ ...serialized });
  finish(1);
  throw error;
});

process.on("unhandledRejection", (reason) => {
  const serialized = serializeError(reason);
  recorder.recordError({
    ...serialized,
    type: serialized.type || "UnhandledRejection"
  });
  process.exitCode = 1;
});

function parseCommand(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : undefined;
  } catch {
    return undefined;
  }
}

function safeTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
