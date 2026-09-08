import { AsyncLocalStorage, executionAsyncId } from "node:async_hooks";
import type { ExecutionEventType, JsonObject, SourceLocation } from "@codeflow/session";

export interface SpanStartInput {
  eventType: "function-enter" | "custom";
  name: string;
  parentId?: string;
  source?: SourceLocation;
  metadata?: JsonObject;
}

export interface SpanEndInput {
  metadata?: JsonObject;
  error?: {
    type: string;
    message: string;
    stack?: string;
    source?: SourceLocation;
  };
}

export interface RecordEventInput {
  type: ExecutionEventType;
  name?: string;
  parentId?: string;
  duration?: number;
  source?: SourceLocation;
  metadata?: JsonObject;
  outcome?: "ok" | "error";
}

export interface RecordErrorInput {
  type: string;
  message: string;
  stack?: string;
  parentId?: string;
  source?: SourceLocation;
  metadata?: JsonObject;
}

export interface CodeFlowRecorderBridge {
  startSpan(input: SpanStartInput): string;
  endSpan(id: string, input?: SpanEndInput): void;
  recordEvent(input: RecordEventInput): string;
  recordError(input: RecordErrorInput): string;
}

const BRIDGE_KEY = "__CODEFLOW_RECORDER_BRIDGE__";
const context = new AsyncLocalStorage<string>();

export function setRecorderBridge(bridge: CodeFlowRecorderBridge | undefined): void {
  (globalThis as unknown as Record<string, CodeFlowRecorderBridge | undefined>)[BRIDGE_KEY] = bridge;
}

export function getRecorderBridge(): CodeFlowRecorderBridge | undefined {
  return (globalThis as unknown as Record<string, CodeFlowRecorderBridge | undefined>)[BRIDGE_KEY];
}

export function getCurrentSpanId(): string | undefined {
  return context.getStore();
}

export function getCurrentAsyncId(): number {
  return executionAsyncId();
}

export function runWithSpanContext<T>(spanId: string, fn: () => T): T {
  return context.run(spanId, fn);
}
