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
  if (!line.startsWith("at ")) {
    return undefined;
  }

  const body = line.slice(3);
  const openParenthesis = body.endsWith(")") ? body.lastIndexOf(" (") : -1;
  const functionName = openParenthesis > 0 ? cleanFunctionName(body.slice(0, openParenthesis)) : undefined;
  const location = openParenthesis > 0 ? body.slice(openParenthesis + 2, -1) : body;
  const parsedLocation = parseLocation(location);

  return parsedLocation
    ? { raw: line, functionName, ...parsedLocation }
    : undefined;
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

function parseLocation(value: string): Pick<ParsedStackFrame, "file" | "line" | "column"> | undefined {
  const columnSeparator = value.lastIndexOf(":");
  if (columnSeparator <= 0) {
    return undefined;
  }

  const lineSeparator = value.lastIndexOf(":", columnSeparator - 1);
  if (lineSeparator <= 0) {
    return undefined;
  }

  const file = value.slice(0, lineSeparator);
  const line = Number(value.slice(lineSeparator + 1, columnSeparator));
  const column = Number(value.slice(columnSeparator + 1));
  if (!file || !Number.isSafeInteger(line) || !Number.isSafeInteger(column) || line < 1 || column < 1) {
    return undefined;
  }

  return {
    file: normalizeFile(file),
    line,
    column
  };
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
