export const CODEFLOW_SESSION_VERSION = 1 as const;

export type ExecutionEventType =
  | "process-start"
  | "process-end"
  | "function-enter"
  | "function-exit"
  | "http-request"
  | "http-response"
  | "database-query"
  | "error"
  | "console"
  | "file-read"
  | "file-write"
  | "custom";

export type RuntimeName = "node" | "browser" | "playwright" | "unknown" | string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface SourceLocation {
  file?: string;
  line?: number;
  column?: number;
  functionName?: string;
  module?: string;
  mapped?: boolean;
  original?: {
    file?: string;
    line?: number;
    column?: number;
  };
}

export interface ExecutionContext {
  pid?: number;
  ppid?: number;
  threadId?: string;
  asyncId?: number;
  runtime?: RuntimeName;
}

export interface SessionMetadata {
  project: string;
  runtime: RuntimeName;
  runtimeVersion: string;
  timestamp: string;
  rootDir?: string;
  command?: string[];
  codeflowVersion?: string;
  platform?: string;
  arch?: string;
  duration?: number;
  exitCode?: number | null;
  privacy?: {
    captureBodies: boolean;
    maxBodyBytes: number;
    headersRedacted: boolean;
  };
}

export interface ExecutionEvent {
  id: string;
  type: ExecutionEventType;
  name?: string;
  timestamp: string;
  time: number;
  duration?: number;
  parentId?: string;
  context?: ExecutionContext;
  source?: SourceLocation;
  metadata?: JsonObject;
  outcome?: "ok" | "error";
}

export interface CallRecord {
  id: string;
  eventId: string;
  exitEventId?: string;
  parentId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  selfDuration?: number;
  callCount: number;
  source?: SourceLocation;
  errorIds: string[];
  metadata?: JsonObject;
}

export interface HttpRecord {
  id: string;
  requestEventId: string;
  responseEventId?: string;
  parentId?: string;
  method: string;
  url: string;
  status?: number;
  startTime: number;
  endTime?: number;
  duration?: number;
  requestTimestamp: string;
  responseTimestamp?: string;
  source?: SourceLocation;
  retryAttempt?: number;
  errorId?: string;
  metadata?: JsonObject;
}

export interface ErrorRecord {
  id: string;
  eventId: string;
  parentId?: string;
  timestamp: string;
  time: number;
  type: string;
  message: string;
  stack?: string;
  source?: SourceLocation;
  contextPath: string[];
  metadata?: JsonObject;
}

export interface FileSnapshot {
  path: string;
  absolutePath?: string;
  language?: string;
  content?: string;
  size?: number;
  hash?: string;
  truncated?: boolean;
  reason?: string;
}

export interface ExecutionSession {
  version: typeof CODEFLOW_SESSION_VERSION;
  metadata: SessionMetadata;
  events: ExecutionEvent[];
  calls: CallRecord[];
  http: HttpRecord[];
  errors: ErrorRecord[];
  files: FileSnapshot[];
}

export type SessionValidationResult =
  | { ok: true; session: ExecutionSession }
  | { ok: false; errors: string[] };

export interface RegressionThresholds {
  maxRegressionPercent?: number;
  maxTotalDurationMs?: number;
  maxNewErrors?: number;
}
