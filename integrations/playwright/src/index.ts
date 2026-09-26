import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  createEmptySession,
  redactText,
  redactUrl,
  sanitizeCommand,
  sanitizeMetadata,
  serializeSession,
  type ExecutionSession,
  type SessionMetadata
} from "@codeflow/session";

export interface BrowserRecordOptions {
  url: string;
  outputFile: string;
  projectRoot?: string;
  timeoutMs?: number;
  settleMs?: number;
  headless?: boolean;
}

export async function recordBrowserSession(options: BrowserRecordOptions): Promise<ExecutionSession> {
  const playwright = await importPlaywright();
  const projectRoot = options.projectRoot ?? process.cwd();
  const targetUrl = redactUrl(options.url);
  const metadata: SessionMetadata = {
    project: path.basename(projectRoot),
    runtime: "playwright",
    runtimeVersion: "playwright",
    timestamp: new Date().toISOString(),
    command: sanitizeCommand(["record-browser", targetUrl]),
    codeflowVersion: "0.1.0",
    platform: process.platform,
    arch: process.arch
  };
  const session = createEmptySession(metadata);
  const start = performance.now();
  let idCounter = 0;
  const nextId = (prefix: string) => `${prefix}-${String(++idCounter).padStart(6, "0")}`;
  const now = () => {
    const time = performance.now() - start;
    return { time, timestamp: new Date(performance.timeOrigin + performance.now()).toISOString() };
  };
  const record = (type: Parameters<typeof session.events.push>[0]["type"], name: string, metadataValue?: unknown) => {
    const stamp = now();
    const id = nextId("event");
    session.events.push({
      id,
      type,
      name: redactText(name),
      timestamp: stamp.timestamp,
      time: stamp.time,
      context: { runtime: "playwright" },
      metadata: sanitizeMetadata(metadataValue)
    });
    return id;
  };

  record("process-start", `record-browser ${targetUrl}`);
  const browser = await playwright.chromium.launch({ headless: options.headless ?? true });
  const page = await browser.newPage();

  await page.exposeFunction("__codeflowBrowserEvent", (event: unknown) => {
    const metadata = isRecord(event) ? event : { value: String(event) };
    const eventType = typeof metadata.type === "string" ? metadata.type : "browser-event";
    record("custom", eventType, metadata);
  });

  await page.addInitScript(() => {
    const codeflowGlobal = globalThis as unknown as {
      __codeflowBrowserEvent?: (event: Record<string, unknown>) => void;
    };

    function emit(event: Record<string, unknown>): void {
      try {
        codeflowGlobal.__codeflowBrowserEvent?.(event);
      } catch {
        // Page-side telemetry must never change application behavior.
      }
    }

    function describeTarget(target: EventTarget | null): Record<string, unknown> {
      if (!(target instanceof Element)) {
        return {};
      }
      const element = target as HTMLElement;
      const tag = element.tagName.toLowerCase();
      const input = element instanceof HTMLInputElement ? element : undefined;
      const buttonText = tag === "button" || tag === "a" ? element.innerText.trim().slice(0, 80) : undefined;
      return {
        tag,
        id: element.id || undefined,
        role: element.getAttribute("role") || undefined,
        type: input?.type,
        name: input?.name || undefined,
        text: buttonText || undefined
      };
    }

    document.addEventListener("click", (event) => {
      emit({
        type: "browser-click",
        x: event.clientX,
        y: event.clientY,
        button: event.button,
        target: describeTarget(event.target)
      });
    }, true);

    document.addEventListener("keydown", (event) => {
      emit({
        type: "browser-keydown",
        key: event.key.length === 1 ? "[character]" : event.key,
        printable: event.key.length === 1,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        target: describeTarget(event.target)
      });
    }, true);
  });

  page.on("framenavigated", (frame: BrowserFrame) => {
    record("custom", "browser-navigation", {
      url: redactUrl(frame.url())
    });
  });

  page.on("request", (request: BrowserRequest) => {
    const stamp = now();
    const eventId = nextId("event");
    session.events.push({
      id: eventId,
      type: "http-request",
      name: `${request.method()} ${redactUrl(request.url())}`,
      timestamp: stamp.timestamp,
      time: stamp.time,
      context: { runtime: "playwright" },
      metadata: sanitizeMetadata({
        method: request.method(),
        url: redactUrl(request.url()),
        resourceType: request.resourceType(),
        bodyCaptured: false
      })
    });
    session.http.push({
      id: nextId("http"),
      requestEventId: eventId,
      method: request.method(),
      url: redactUrl(request.url()),
      startTime: stamp.time,
      requestTimestamp: stamp.timestamp,
      metadata: sanitizeMetadata({ resourceType: request.resourceType() })
    });
  });

  page.on("response", (response: BrowserResponse) => {
    const matching = [...session.http].reverse().find((entry) => entry.url === redactUrl(response.url()) && !entry.responseEventId);
    const stamp = now();
    const eventId = nextId("event");
    session.events.push({
      id: eventId,
      type: "http-response",
      name: `${response.status()} ${redactUrl(response.url())}`,
      timestamp: stamp.timestamp,
      time: stamp.time,
      duration: matching ? stamp.time - matching.startTime : undefined,
      context: { runtime: "playwright" },
      metadata: sanitizeMetadata({
        requestEventId: matching?.requestEventId,
        method: matching?.method,
        url: redactUrl(response.url()),
        status: response.status(),
        responseBodyCaptured: false
      }),
      outcome: response.status() >= 400 ? "error" : "ok"
    });
    if (matching) {
      matching.responseEventId = eventId;
      matching.status = response.status();
      matching.endTime = stamp.time;
      matching.duration = stamp.time - matching.startTime;
      matching.responseTimestamp = stamp.timestamp;
    }
  });

  page.on("console", (message: BrowserConsoleMessage) => {
    const isError = message.type() === "error";
    record(isError ? "error" : "console", `browser:${message.type()}`, {
      level: message.type(),
      text: message.text()
    });
  });

  const recordBrowserError = (error: Error, type = error.name || "PageError") => {
    const stamp = now();
    const sanitizedType = redactText(type);
    const message = redactText(error.message);
    const stack = error.stack ? redactText(error.stack) : undefined;
    const eventId = record("error", sanitizedType, {
      message,
      stack
    });
    session.errors.push({
      id: nextId("error"),
      eventId,
      timestamp: stamp.timestamp,
      time: stamp.time,
      type: sanitizedType,
      message,
      stack,
      contextPath: ["browser"]
    });
  };

  page.on("pageerror", (error: Error) => recordBrowserError(error));

  try {
    await withTimeout(
      (async () => {
        await page.goto(options.url, { waitUntil: "load", timeout: options.timeoutMs ?? 30000 });
        await page.waitForTimeout(options.settleMs ?? 500);
      })(),
      (options.timeoutMs ?? 30000) + (options.settleMs ?? 500) + 1000,
      `Timed out recording browser page ${options.url}`
    );
  } catch (error) {
    recordBrowserError(error instanceof Error ? error : new Error(String(error)), "BrowserRecordingError");
  } finally {
    try {
      await withTimeout(browser.close(), 3000, "Timed out closing browser");
    } catch (error) {
      recordBrowserError(error instanceof Error ? error : new Error(String(error)), "BrowserCloseError");
    }
  }
  const total = performance.now() - start;
  metadata.duration = total;
  record("process-end", `record-browser ${targetUrl}`, { duration: total });
  fs.mkdirSync(path.dirname(options.outputFile), { recursive: true });
  fs.writeFileSync(options.outputFile, serializeSession(session), "utf8");
  return session;
}

async function importPlaywright(): Promise<PlaywrightLike> {
  try {
    return (await import("playwright")) as PlaywrightLike;
  } catch {
    throw new Error("Playwright is not installed. Install it with `npm install -D playwright` to use browser recording.");
  }
}

interface PlaywrightLike {
  chromium: {
    launch(options: { headless: boolean }): Promise<BrowserLike>;
  };
}

interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

interface PageLike {
  on(event: "request", listener: (request: BrowserRequest) => void): void;
  on(event: "response", listener: (response: BrowserResponse) => void): void;
  on(event: "console", listener: (message: BrowserConsoleMessage) => void): void;
  on(event: "pageerror", listener: (error: Error) => void): void;
  on(event: "framenavigated", listener: (frame: BrowserFrame) => void): void;
  exposeFunction(name: string, callback: (event: unknown) => void): Promise<void>;
  addInitScript(script: () => void): Promise<void>;
  goto(url: string, options: { waitUntil: "load"; timeout: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
}

interface BrowserRequest {
  method(): string;
  url(): string;
  resourceType(): string;
}

interface BrowserResponse {
  status(): number;
  url(): string;
}

interface BrowserConsoleMessage {
  type(): string;
  text(): string;
}

interface BrowserFrame {
  url(): string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
