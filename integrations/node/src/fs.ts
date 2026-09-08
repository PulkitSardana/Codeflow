import fs from "node:fs";
import path from "node:path";
import { sanitizeMetadata } from "@codeflow/session";
import { getCurrentSpanId, getRecorderBridge } from "@codeflow/core";

const PATCH_KEY = "__CODEFLOW_NODE_FS_PATCHED__";
const FLUSHING_KEY = "__CODEFLOW_FLUSHING__";

export function patchFileSystem(projectRoot = process.env.CODEFLOW_PROJECT_ROOT ?? process.cwd()): () => void {
  const registry = globalThis as unknown as Record<string, unknown>;
  if (registry[PATCH_KEY]) {
    return () => undefined;
  }

  registry[PATCH_KEY] = true;
  const mutable = fs as unknown as {
    readFileSync: typeof fs.readFileSync;
    writeFileSync: typeof fs.writeFileSync;
  };
  const originalReadFileSync = mutable.readFileSync;
  const originalWriteFileSync = mutable.writeFileSync;

  mutable.readFileSync = function patchedReadFileSync(file: fs.PathOrFileDescriptor, options?: unknown): unknown {
    const result = originalReadFileSync.apply(fs, [file, options] as Parameters<typeof fs.readFileSync>);
    recordFileEvent("file-read", file, projectRoot);
    return result;
  } as typeof fs.readFileSync;

  mutable.writeFileSync = function patchedWriteFileSync(
    file: fs.PathOrFileDescriptor,
    data: string | NodeJS.ArrayBufferView,
    options?: unknown
  ): void {
    originalWriteFileSync.apply(fs, [file, data, options] as Parameters<typeof fs.writeFileSync>);
    recordFileEvent("file-write", file, projectRoot);
  } as typeof fs.writeFileSync;

  return () => {
    mutable.readFileSync = originalReadFileSync;
    mutable.writeFileSync = originalWriteFileSync;
    registry[PATCH_KEY] = false;
  };
}

export function isCodeFlowFlushing(): boolean {
  return Boolean((globalThis as unknown as Record<string, unknown>)[FLUSHING_KEY]);
}

function recordFileEvent(type: "file-read" | "file-write", file: fs.PathOrFileDescriptor, projectRoot: string): void {
  if (isCodeFlowFlushing() || typeof file !== "string") {
    return;
  }

  const resolved = path.resolve(file);
  if (!shouldRecordPath(resolved, projectRoot)) {
    return;
  }

  const bridge = getRecorderBridge();
  if (!bridge) {
    return;
  }

  bridge.recordEvent({
    type,
    name: path.relative(projectRoot, resolved) || resolved,
    parentId: getCurrentSpanId(),
    metadata: sanitizeMetadata({
      path: path.relative(projectRoot, resolved) || resolved
    })
  });
}

function shouldRecordPath(filePath: string, projectRoot: string): boolean {
  const relative = path.relative(projectRoot, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }

  const normalized = relative.split(path.sep).join("/");
  return !(
    normalized.startsWith(".codeflow/") ||
    normalized.includes("/node_modules/") ||
    normalized.startsWith("node_modules/") ||
    normalized.includes("/.git/") ||
    normalized.startsWith(".git/") ||
    normalized.includes("/dist/") ||
    normalized.startsWith("dist/")
  );
}
