import { CODEFLOW_SESSION_VERSION, type ExecutionSession, type SessionMetadata, type SessionValidationResult } from "./types.js";

export function createEmptySession(metadata: SessionMetadata): ExecutionSession {
  return {
    version: CODEFLOW_SESSION_VERSION,
    metadata,
    events: [],
    calls: [],
    http: [],
    errors: [],
    files: []
  };
}

export function serializeSession(session: ExecutionSession): string {
  return `${JSON.stringify(session, null, 2)}\n`;
}

export function parseSessionJson(input: string): SessionValidationResult {
  try {
    return validateSession(JSON.parse(input));
  } catch (error) {
    return { ok: false, errors: [`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
}

export function migrateSession(input: unknown): SessionValidationResult {
  if (!isRecord(input)) {
    return { ok: false, errors: ["Session must be a JSON object"] };
  }

  if (input.version === CODEFLOW_SESSION_VERSION) {
    return validateSession(input);
  }

  return { ok: false, errors: [`Unsupported session version: ${String(input.version)}`] };
}

export function validateSession(input: unknown): SessionValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ["Session must be a JSON object"] };
  }

  if (input.version !== CODEFLOW_SESSION_VERSION) {
    errors.push(`Expected version ${CODEFLOW_SESSION_VERSION}`);
  }

  if (!isRecord(input.metadata)) {
    errors.push("metadata must be an object");
  } else {
    requireString(input.metadata.project, "metadata.project", errors);
    requireString(input.metadata.runtime, "metadata.runtime", errors);
    requireString(input.metadata.runtimeVersion, "metadata.runtimeVersion", errors);
    requireIsoDate(input.metadata.timestamp, "metadata.timestamp", errors);
  }

  requireArray(input.events, "events", errors);
  requireArray(input.calls, "calls", errors);
  requireArray(input.http, "http", errors);
  requireArray(input.errors, "errors", errors);
  requireArray(input.files, "files", errors);

  if (Array.isArray(input.events)) {
    const eventIds = new Set<string>();
    input.events.forEach((event, index) => {
      if (!isRecord(event)) {
        errors.push(`events[${index}] must be an object`);
        return;
      }
      requireString(event.id, `events[${index}].id`, errors);
      requireString(event.type, `events[${index}].type`, errors);
      requireIsoDate(event.timestamp, `events[${index}].timestamp`, errors);
      requireNumber(event.time, `events[${index}].time`, errors);
      if (typeof event.id === "string") {
        if (eventIds.has(event.id)) {
          errors.push(`Duplicate event id: ${event.id}`);
        }
        eventIds.add(event.id);
      }
    });
  }

  if (Array.isArray(input.calls)) {
    input.calls.forEach((call, index) => {
      if (!isRecord(call)) {
        errors.push(`calls[${index}] must be an object`);
        return;
      }
      requireString(call.id, `calls[${index}].id`, errors);
      requireString(call.eventId, `calls[${index}].eventId`, errors);
      requireString(call.name, `calls[${index}].name`, errors);
      requireNumber(call.startTime, `calls[${index}].startTime`, errors);
      requireArray(call.errorIds, `calls[${index}].errorIds`, errors);
    });
  }

  if (Array.isArray(input.http)) {
    input.http.forEach((entry, index) => {
      if (!isRecord(entry)) {
        errors.push(`http[${index}] must be an object`);
        return;
      }
      requireString(entry.id, `http[${index}].id`, errors);
      requireString(entry.requestEventId, `http[${index}].requestEventId`, errors);
      requireString(entry.method, `http[${index}].method`, errors);
      requireString(entry.url, `http[${index}].url`, errors);
      requireNumber(entry.startTime, `http[${index}].startTime`, errors);
      requireIsoDate(entry.requestTimestamp, `http[${index}].requestTimestamp`, errors);
    });
  }

  if (Array.isArray(input.errors)) {
    input.errors.forEach((entry, index) => {
      if (!isRecord(entry)) {
        errors.push(`errors[${index}] must be an object`);
        return;
      }
      requireString(entry.id, `errors[${index}].id`, errors);
      requireString(entry.eventId, `errors[${index}].eventId`, errors);
      requireString(entry.type, `errors[${index}].type`, errors);
      requireString(entry.message, `errors[${index}].message`, errors);
      requireArray(entry.contextPath, `errors[${index}].contextPath`, errors);
    });
  }

  if (Array.isArray(input.files)) {
    input.files.forEach((entry, index) => {
      if (!isRecord(entry)) {
        errors.push(`files[${index}] must be an object`);
        return;
      }
      requireString(entry.path, `files[${index}].path`, errors);
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, session: input as unknown as ExecutionSession };
}

export function assertValidSession(input: unknown): ExecutionSession {
  const result = validateSession(input);
  if (!result.ok) {
    throw new Error(result.errors.join("\n"));
  }
  return result.session;
}

function requireArray(value: unknown, label: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
  }
}

function requireString(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${label} must be a non-empty string`);
  }
}

function requireNumber(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${label} must be a finite number`);
  }
}

function requireIsoDate(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    errors.push(`${label} must be an ISO timestamp`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
