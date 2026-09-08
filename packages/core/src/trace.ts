import { captureSourceLocation, serializeError } from "@codeflow/parser";
import { sanitizeMetadata, type JsonObject, type SourceLocation } from "@codeflow/session";
import {
  getCurrentSpanId,
  getRecorderBridge,
  runWithSpanContext,
  type RecordEventInput
} from "./bridge.js";

export interface TraceOptions {
  source?: SourceLocation;
  metadata?: Record<string, unknown>;
}

export function trace<T>(name: string, fn: () => T, options: TraceOptions = {}): T {
  const bridge = getRecorderBridge();
  if (!bridge) {
    return fn();
  }

  const source = options.source ?? captureSourceLocation();
  const spanId = bridge.startSpan({
    eventType: "function-enter",
    name,
    parentId: getCurrentSpanId(),
    source,
    metadata: sanitizeMetadata(options.metadata)
  });

  return runWithSpanContext(spanId, () => {
    try {
      const result = fn();
      if (isPromiseLike(result)) {
        return result.then(
          (value) => {
            bridge.endSpan(spanId);
            return value;
          },
          (error) => {
            const serialized = serializeError(error);
            bridge.recordError({ ...serialized, parentId: spanId });
            bridge.endSpan(spanId, { error: serialized });
            throw error;
          }
        ) as T;
      }

      bridge.endSpan(spanId);
      return result;
    } catch (error) {
      const serialized = serializeError(error);
      bridge.recordError({ ...serialized, parentId: spanId });
      bridge.endSpan(spanId, { error: serialized });
      throw error;
    }
  });
}

export function recordCustomEvent(name: string, metadata?: Record<string, unknown>, source?: SourceLocation): string | undefined {
  const bridge = getRecorderBridge();
  if (!bridge) {
    return undefined;
  }
  return bridge.recordEvent({
    type: "custom",
    name,
    parentId: getCurrentSpanId(),
    source: source ?? captureSourceLocation(),
    metadata: sanitizeMetadata(metadata)
  });
}

export function recordConsole(level: string, values: unknown[]): string | undefined {
  return recordRuntimeEvent({
    type: "console",
    name: level,
    metadata: {
      level,
      values: sanitizeMetadata({ values })?.values ?? []
    }
  });
}

export function recordFileRead(file: string, metadata?: Record<string, unknown>): string | undefined {
  return recordRuntimeEvent({
    type: "file-read",
    name: file,
    metadata: sanitizeMetadata(metadata)
  });
}

export function recordFileWrite(file: string, metadata?: Record<string, unknown>): string | undefined {
  return recordRuntimeEvent({
    type: "file-write",
    name: file,
    metadata: sanitizeMetadata(metadata)
  });
}

export async function recordDatabaseQuery<T>(
  name: string,
  fn: () => Promise<T> | T,
  metadata?: Record<string, unknown>
): Promise<T> {
  const bridge = getRecorderBridge();
  if (!bridge) {
    return await fn();
  }

  const start = performance.now();
  const source = captureSourceLocation();
  try {
    const result = await fn();
    bridge.recordEvent({
      type: "database-query",
      name,
      parentId: getCurrentSpanId(),
      duration: performance.now() - start,
      source,
      metadata: sanitizeMetadata(metadata),
      outcome: "ok"
    });
    return result;
  } catch (error) {
    const serialized = serializeError(error);
    bridge.recordError({ ...serialized, parentId: getCurrentSpanId() });
    bridge.recordEvent({
      type: "database-query",
      name,
      parentId: getCurrentSpanId(),
      duration: performance.now() - start,
      source,
      metadata: sanitizeMetadata(metadata),
      outcome: "error"
    });
    throw error;
  }
}

export function recordRuntimeEvent(input: Omit<RecordEventInput, "parentId"> & { parentId?: string }): string | undefined {
  const bridge = getRecorderBridge();
  if (!bridge) {
    return undefined;
  }
  return bridge.recordEvent({
    ...input,
    parentId: input.parentId ?? getCurrentSpanId()
  });
}

function isPromiseLike<T>(value: T | PromiseLike<Awaited<T>>): value is PromiseLike<Awaited<T>> {
  return Boolean(value && typeof (value as PromiseLike<Awaited<T>>).then === "function");
}
