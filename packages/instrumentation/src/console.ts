import { sanitizeMetadata } from "@codeflow/session";
import { getCurrentSpanId, getRecorderBridge } from "@codeflow/core";

type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug";

const PATCH_KEY = "__CODEFLOW_CONSOLE_PATCHED__";

export function patchConsole(): () => void {
  const registry = globalThis as unknown as Record<string, unknown>;
  if (registry[PATCH_KEY]) {
    return () => undefined;
  }

  registry[PATCH_KEY] = true;
  const originals = new Map<ConsoleMethod, (...args: unknown[]) => void>();
  const methods: ConsoleMethod[] = ["log", "info", "warn", "error", "debug"];

  for (const method of methods) {
    const original = console[method].bind(console) as (...args: unknown[]) => void;
    originals.set(method, original);
    console[method] = ((...args: unknown[]) => {
      const bridge = getRecorderBridge();
      if (bridge) {
        bridge.recordEvent({
          type: "console",
          name: method,
          parentId: getCurrentSpanId(),
          metadata: sanitizeMetadata({
            level: method,
            values: args.map((value) => formatConsoleValue(value))
          }),
          outcome: method === "error" ? "error" : "ok"
        });
      }
      original(...args);
    }) as typeof console[typeof method];
  }

  return () => {
    for (const [method, original] of originals) {
      console[method] = original as typeof console[typeof method];
    }
    registry[PATCH_KEY] = false;
  };
}

function formatConsoleValue(value: unknown): unknown {
  if (value instanceof Error) {
    return { type: value.name, message: value.message, stack: value.stack };
  }
  return value;
}
