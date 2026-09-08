import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { sourceContentFromMap } from "@codeflow/parser";
import {
  CODEFLOW_SESSION_VERSION,
  createEmptySession,
  hashContent,
  languageFromPath,
  sanitizeMetadata,
  serializeSession,
  type CallRecord,
  type ErrorRecord,
  type ExecutionEvent,
  type ExecutionSession,
  type FileSnapshot,
  type HttpRecord,
  type JsonObject,
  type SessionMetadata,
  type SourceLocation
} from "@codeflow/session";
import { setRecorderBridge, type CodeFlowRecorderBridge, type RecordErrorInput, type RecordEventInput, type SpanEndInput, type SpanStartInput } from "@codeflow/core";

const FLUSHING_KEY = "__CODEFLOW_FLUSHING__";

export interface CodeFlowRecorderOptions {
  outputFile: string;
  metadata: SessionMetadata;
  projectRoot?: string;
  maxSourceFileBytes?: number;
}

export class CodeFlowRecorder implements CodeFlowRecorderBridge {
  readonly outputFile: string;
  readonly projectRoot: string;
  readonly maxSourceFileBytes: number;

  private readonly session: ExecutionSession;
  private readonly openCalls = new Map<string, CallRecord>();
  private readonly callsById = new Map<string, CallRecord>();
  private readonly httpByRequestId = new Map<string, HttpRecord>();
  private readonly startPerf = performance.now();
  private idCounter = 0;
  private started = false;
  private stopped = false;

  constructor(options: CodeFlowRecorderOptions) {
    this.outputFile = options.outputFile;
    this.projectRoot = options.projectRoot ?? options.metadata.rootDir ?? process.cwd();
    this.maxSourceFileBytes = options.maxSourceFileBytes ?? 250_000;
    this.session = createEmptySession({
      ...options.metadata,
      rootDir: options.metadata.rootDir ?? this.projectRoot
    });
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.recordEvent({
      type: "process-start",
      name: this.session.metadata.command?.join(" ") || this.session.metadata.project,
      metadata: sanitizeMetadata({
        version: CODEFLOW_SESSION_VERSION,
        cwd: this.projectRoot,
        command: this.session.metadata.command
      })
    });
  }

  stop(exitCode: number | null = typeof process.exitCode === "number" ? process.exitCode : 0): ExecutionSession {
    if (this.stopped) {
      return this.session;
    }
    this.stopped = true;

    for (const call of Array.from(this.openCalls.values())) {
      this.closeCall(call.id, { metadata: { forcedClose: true } });
    }

    const duration = performance.now() - this.startPerf;
    this.session.metadata.duration = duration;
    this.session.metadata.exitCode = exitCode;
    this.recordEvent({
      type: "process-end",
      name: this.session.metadata.command?.join(" ") || this.session.metadata.project,
      duration,
      metadata: sanitizeMetadata({ exitCode })
    });
    this.computeSelfDurations();
    this.session.files = this.collectSourceSnapshots();
    this.flush();
    return this.session;
  }

  getSession(): ExecutionSession {
    return this.session;
  }

  startSpan(input: SpanStartInput): string {
    const id = this.nextId("call");
    const event = this.createEvent({
      type: input.eventType,
      name: input.name,
      parentId: input.parentId,
      source: input.source,
      metadata: input.metadata
    }, id);
    this.session.events.push(event);

    const call: CallRecord = {
      id,
      eventId: event.id,
      parentId: input.parentId,
      name: input.name,
      startTime: event.time,
      callCount: 1,
      source: input.source,
      errorIds: [],
      metadata: input.metadata
    };
    this.session.calls.push(call);
    this.openCalls.set(id, call);
    this.callsById.set(id, call);
    return id;
  }

  endSpan(id: string, input?: SpanEndInput): void {
    this.closeCall(id, input);
  }

  recordEvent(input: RecordEventInput): string {
    const event = this.createEvent(input);
    this.session.events.push(event);

    if (event.type === "http-request") {
      const method = readString(event.metadata, "method") ?? "GET";
      const url = readString(event.metadata, "url") ?? event.name ?? "unknown";
      const httpRecord: HttpRecord = {
        id: this.nextId("http"),
        requestEventId: event.id,
        parentId: event.parentId,
        method,
        url,
        startTime: event.time,
        requestTimestamp: event.timestamp,
        source: event.source,
        retryAttempt: readNumber(event.metadata, "retryAttempt"),
        metadata: event.metadata
      };
      this.session.http.push(httpRecord);
      this.httpByRequestId.set(event.id, httpRecord);
    }

    if (event.type === "http-response") {
      const requestEventId = readString(event.metadata, "requestEventId");
      const httpRecord = requestEventId ? this.httpByRequestId.get(requestEventId) : undefined;
      if (httpRecord) {
        httpRecord.responseEventId = event.id;
        httpRecord.status = readNumber(event.metadata, "status");
        httpRecord.endTime = event.time;
        httpRecord.duration = event.duration;
        httpRecord.responseTimestamp = event.timestamp;
        const errorId = readString(event.metadata, "errorId");
        if (errorId) {
          httpRecord.errorId = errorId;
        }
      }
    }

    return event.id;
  }

  recordError(input: RecordErrorInput): string {
    const errorEvent = this.createEvent({
      type: "error",
      name: input.type,
      parentId: input.parentId,
      source: input.source,
      metadata: sanitizeMetadata({
        message: input.message,
        stack: input.stack,
        ...input.metadata
      }),
      outcome: "error"
    });
    this.session.events.push(errorEvent);

    const errorRecord: ErrorRecord = {
      id: this.nextId("error"),
      eventId: errorEvent.id,
      parentId: input.parentId,
      timestamp: errorEvent.timestamp,
      time: errorEvent.time,
      type: input.type,
      message: input.message,
      stack: input.stack,
      source: input.source,
      contextPath: this.contextPath(input.parentId),
      metadata: input.metadata
    };
    this.session.errors.push(errorRecord);

    let callId = input.parentId;
    while (callId) {
      const call = this.callsById.get(callId);
      if (!call) {
        break;
      }
      if (!call.errorIds.includes(errorRecord.id)) {
        call.errorIds.push(errorRecord.id);
      }
      callId = call.parentId;
    }

    return errorRecord.id;
  }

  flush(): void {
    const registry = globalThis as unknown as Record<string, unknown>;
    registry[FLUSHING_KEY] = true;
    try {
      fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
      fs.writeFileSync(this.outputFile, serializeSession(this.session), "utf8");
    } finally {
      registry[FLUSHING_KEY] = false;
    }
  }

  installAsGlobal(): void {
    setRecorderBridge(this);
  }

  private closeCall(id: string, input?: SpanEndInput): void {
    const call = this.openCalls.get(id);
    if (!call) {
      return;
    }

    const now = this.now();
    call.endTime = now.time;
    call.duration = Math.max(0, call.endTime - call.startTime);
    if (input?.metadata) {
      call.metadata = { ...(call.metadata ?? {}), ...input.metadata };
    }
    if (input?.error) {
      call.metadata = { ...(call.metadata ?? {}), error: sanitizeMetadata(input.error) ?? {} };
    }

    const exitEvent = this.createEvent({
      type: "function-exit",
      name: call.name,
      parentId: call.id,
      duration: call.duration,
      source: call.source,
      metadata: input?.metadata,
      outcome: input?.error ? "error" : "ok"
    });
    this.session.events.push(exitEvent);
    call.exitEventId = exitEvent.id;
    this.openCalls.delete(id);
  }

  private computeSelfDurations(): void {
    const childrenByParent = new Map<string, CallRecord[]>();
    for (const call of this.session.calls) {
      if (!call.parentId) {
        continue;
      }
      const children = childrenByParent.get(call.parentId) ?? [];
      children.push(call);
      childrenByParent.set(call.parentId, children);
    }

    for (const call of this.session.calls) {
      const childDuration = (childrenByParent.get(call.id) ?? []).reduce((total, child) => total + (child.duration ?? 0), 0);
      call.selfDuration = Math.max(0, (call.duration ?? 0) - childDuration);
    }
  }

  private collectSourceSnapshots(): FileSnapshot[] {
    const files = new Map<string, SourceLocation>();
    for (const event of this.session.events) {
      if (event.source?.file) {
        files.set(event.source.file, event.source);
      }
    }
    for (const call of this.session.calls) {
      if (call.source?.file) {
        files.set(call.source.file, call.source);
      }
    }
    for (const error of this.session.errors) {
      if (error.source?.file) {
        files.set(error.source.file, error.source);
      }
    }

    const snapshots: FileSnapshot[] = [];
    const registry = globalThis as unknown as Record<string, unknown>;
    registry[FLUSHING_KEY] = true;
    try {
      for (const file of files.keys()) {
        const snapshot = this.snapshotFile(file, files.get(file));
        if (snapshot) {
          snapshots.push(snapshot);
        }
      }
    } finally {
      registry[FLUSHING_KEY] = false;
    }

    return snapshots.sort((left, right) => left.path.localeCompare(right.path));
  }

  private snapshotFile(file: string, source?: SourceLocation): FileSnapshot | undefined {
    if (file.startsWith("node:") || file.includes("/node_modules/")) {
      return undefined;
    }

    const absolutePath = path.isAbsolute(file) ? file : path.resolve(this.projectRoot, file);
    const relative = path.relative(this.projectRoot, absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return undefined;
    }

    try {
      const stat = fs.statSync(absolutePath);
      if (!stat.isFile()) {
        return undefined;
      }

      const base: FileSnapshot = {
        path: relative.split(path.sep).join("/"),
        absolutePath,
        language: languageFromPath(absolutePath),
        size: stat.size
      };

      if (stat.size > this.maxSourceFileBytes) {
        return {
          ...base,
          truncated: true,
          reason: `File exceeds ${this.maxSourceFileBytes} bytes`
        };
      }

      const content = fs.readFileSync(absolutePath, "utf8");
      return {
        ...base,
        content,
        hash: hashContent(content)
      };
    } catch {
      const mappedContent = sourceContentFromMap(source, { projectRoot: this.projectRoot });
      if (!mappedContent) {
        return undefined;
      }
      const relative = path.relative(this.projectRoot, mappedContent.path);
      return {
        path: (relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : mappedContent.path).split(path.sep).join("/"),
        absolutePath: mappedContent.path,
        language: languageFromPath(mappedContent.path),
        content: mappedContent.content,
        size: Buffer.byteLength(mappedContent.content, "utf8"),
        hash: hashContent(mappedContent.content)
      };
    }
  }

  private contextPath(parentId: string | undefined): string[] {
    const pathNames: string[] = [];
    let cursor = parentId;
    while (cursor) {
      const call = this.callsById.get(cursor);
      if (!call) {
        break;
      }
      pathNames.unshift(call.name);
      cursor = call.parentId;
    }
    return pathNames;
  }

  private createEvent(input: RecordEventInput, forcedId?: string): ExecutionEvent {
    const now = this.now();
    return {
      id: forcedId ?? this.nextId("event"),
      type: input.type,
      name: input.name,
      timestamp: now.timestamp,
      time: now.time,
      duration: input.duration,
      parentId: input.parentId,
      context: {
        pid: process.pid,
        ppid: process.ppid,
        runtime: this.session.metadata.runtime
      },
      source: input.source,
      metadata: input.metadata,
      outcome: input.outcome
    };
  }

  private now(): { time: number; timestamp: string } {
    const time = Math.max(0, performance.now() - this.startPerf);
    return {
      time,
      timestamp: new Date(performance.timeOrigin + performance.now()).toISOString()
    };
  }

  private nextId(prefix: "call" | "event" | "http" | "error"): string {
    this.idCounter += 1;
    return `${prefix}-${String(this.idCounter).padStart(6, "0")}`;
  }
}

function readString(metadata: JsonObject | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(metadata: JsonObject | undefined, key: string): number | undefined {
  const value = metadata?.[key];
  return typeof value === "number" ? value : undefined;
}
