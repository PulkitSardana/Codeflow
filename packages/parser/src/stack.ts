import { fileURLToPath } from "node:url";
import type { SourceLocation } from "@codeflow/session";
import { mapSourceLocation } from "./source-map.js";

export interface ParsedStackFrame extends SourceLocation {
  raw: string;
}

const INTERNAL_MARKERS = [
  "node:internal",
  "/node_modules/@codeflow/",
  "\\node_modules\\@codeflow\\",
  "/packages/core/",
  "/packages/parser/",
  "/packages/recorder/",
  "/packages/instrumentation/",
  "/integrations/node/"
];

export function captureSourceLocation(skipFrames = 0): SourceLocation | undefined {
  const stack = new Error().stack;
  if (!stack) {
    return undefined;
  }

  const frames = parseStack(stack).filter((frame) => !isInternalFrame(frame));
  return mapSourceLocation(stripRaw(frames[skipFrames]));
}

export function sourceFromError(error: unknown): SourceLocation | undefined {
  if (!(error instanceof Error) || !error.stack) {
    return undefined;
  }
  return mapSourceLocation(stripRaw(parseStack(error.stack).find((frame) => !isInternalFrame(frame))));
}

export function parseStack(stack: string): ParsedStackFrame[] {
  return stack
    .split("\n")
    .slice(1)
    .map((line) => parseStackLine(line.trim()))
    .filter((frame): frame is ParsedStackFrame => Boolean(frame));
}

export function parseStackLine(line: string): ParsedStackFrame | undefined {
  const withFunction = /^at\s+(.*?)\s+\((.*):(\d+):(\d+)\)$/.exec(line);
  if (withFunction) {
    return {
      raw: line,
      functionName: cleanFunctionName(withFunction[1]),
      file: normalizeFile(withFunction[2]),
      line: Number(withFunction[3]),
      column: Number(withFunction[4])
    };
  }

  const withoutFunction = /^at\s+(.*):(\d+):(\d+)$/.exec(line);
  if (withoutFunction) {
    return {
      raw: line,
      file: normalizeFile(withoutFunction[1]),
      line: Number(withoutFunction[2]),
      column: Number(withoutFunction[3])
    };
  }

  return undefined;
}

export function normalizeFile(file: string): string {
  if (file.startsWith("file://")) {
    try {
      return fileURLToPath(file);
    } catch {
      return file;
    }
  }
  return file;
}

export function serializeError(error: unknown): { type: string; message: string; stack?: string; source?: SourceLocation } {
  if (error instanceof Error) {
    return {
      type: error.name || "Error",
      message: error.message,
      stack: error.stack,
      source: sourceFromError(error)
    };
  }

  return {
    type: typeof error,
    message: String(error)
  };
}

function cleanFunctionName(name: string | undefined): string | undefined {
  if (!name || name === "async") {
    return undefined;
  }
  return name.replace(/^async\s+/, "");
}

function stripRaw(frame: ParsedStackFrame | undefined): SourceLocation | undefined {
  if (!frame) {
    return undefined;
  }
  const { raw: _raw, ...source } = frame;
  return source;
}

function isInternalFrame(frame: ParsedStackFrame): boolean {
  if (!frame.file) {
    return false;
  }
  return INTERNAL_MARKERS.some((marker) => frame.file?.includes(marker));
}
