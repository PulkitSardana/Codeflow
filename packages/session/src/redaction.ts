import type { JsonObject, JsonValue } from "./types.js";

const SECRET_KEY_PATTERNS = [
  /authorization/i,
  /^cookie$/i,
  /^set-cookie$/i,
  /password/i,
  /passwd/i,
  /secret/i,
  /api[-_]?key/i,
  /access[-_]?token/i,
  /refresh[-_]?token/i,
  /id[-_]?token/i,
  /session[-_]?id/i,
  /^token$/i,
  /^jwt$/i,
  /credential/i
];

const MAX_METADATA_DEPTH = 6;
const MAX_STRING_LENGTH = 2000;
const DEFAULT_BODY_LIMIT = 4096;

export const REDACTED = "[REDACTED]";

export function isSensitiveKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function redactValue(key: string, value: unknown): JsonValue {
  if (isSensitiveKey(key)) {
    return REDACTED;
  }
  return sanitizeJson(value);
}

export function redactHeaders(headers: Headers | Record<string, unknown> | undefined): JsonObject | undefined {
  if (!headers) {
    return undefined;
  }

  const result: JsonObject = {};
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    headers.forEach((value, key) => {
      result[key] = isSensitiveKey(key) ? REDACTED : trimString(value);
    });
    return result;
  }

  for (const [key, value] of Object.entries(headers)) {
    result[key] = isSensitiveKey(key) ? REDACTED : sanitizeJson(value);
  }

  return result;
}

export function redactUrl(rawUrl: string): string {
  try {
    const hasProtocol = /^[a-z][a-z\d+\-.]*:/i.test(rawUrl);
    const parsed = new URL(rawUrl, hasProtocol ? undefined : "http://codeflow.local");
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (isSensitiveKey(key)) {
        parsed.searchParams.set(key, REDACTED);
      }
    }

    if (hasProtocol) {
      return parsed.toString();
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return rawUrl.replace(/([?&][^=]*(?:token|secret|password|api_key|apikey|authorization)[^=]*=)[^&]+/gi, `$1${REDACTED}`);
  }
}

export function sanitizeMetadata(metadata: unknown): JsonObject | undefined {
  if (typeof metadata === "undefined") {
    return undefined;
  }
  const sanitized = sanitizeJson(metadata, 0);
  if (isPlainObject(sanitized)) {
    return sanitized;
  }
  if (sanitized === undefined) {
    return undefined;
  }
  return { value: sanitized };
}

export function sanitizeHttpBodyPreview(body: unknown, contentType?: string, maxBytes = DEFAULT_BODY_LIMIT): JsonObject | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }

  const raw = bodyToText(body);
  if (raw === undefined) {
    return {
      captured: false,
      reason: "Unsupported body type"
    };
  }

  const truncated = Buffer.byteLength(raw, "utf8") > maxBytes;
  const trimmed = truncateBytes(raw, maxBytes);
  const lowerContentType = contentType?.toLowerCase() ?? "";

  if (lowerContentType.includes("application/json") || looksLikeJson(trimmed)) {
    try {
      return {
        captured: true,
        encoding: "text",
        contentType: contentType ?? "application/json",
        truncated,
        value: sanitizeJson(JSON.parse(trimmed))
      };
    } catch {
      return {
        captured: true,
        encoding: "text",
        contentType: contentType ?? "text/plain",
        truncated,
        value: redactSecretText(trimmed)
      };
    }
  }

  if (lowerContentType.includes("application/x-www-form-urlencoded") || looksLikeForm(trimmed)) {
    return {
      captured: true,
      encoding: "text",
      contentType: contentType ?? "application/x-www-form-urlencoded",
      truncated,
      value: sanitizeFormBody(trimmed)
    };
  }

  return {
    captured: true,
    encoding: "text",
    contentType: contentType ?? "text/plain",
    truncated,
    value: redactSecretText(trimmed)
  };
}

export function sanitizeJson(value: unknown, depth = 0): JsonValue {
  if (depth > MAX_METADATA_DEPTH) {
    return "[MaxDepth]";
  }

  if (value === null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === "string") {
    return trimString(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      type: value.name,
      message: trimString(value.message),
      stack: trimString(value.stack ?? "")
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => sanitizeJson(entry, depth + 1));
  }

  if (typeof value === "function") {
    return "[Function]";
  }

  if (typeof value === "undefined" || typeof value === "symbol") {
    return String(value);
  }

  if (isPlainObject(value)) {
    const output: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "undefined") {
        continue;
      }
      output[key] = isSensitiveKey(key) ? REDACTED : sanitizeJson(entry, depth + 1);
    }
    return output;
  }

  return trimString(String(value));
}

function trimString(value: string): string {
  return value.length <= MAX_STRING_LENGTH ? value : `${value.slice(0, MAX_STRING_LENGTH)}...`;
}

function bodyToText(body: unknown): string | undefined {
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(body)) {
    return body.toString("utf8");
  }
  if (body instanceof ArrayBuffer) {
    return Buffer.from(body).toString("utf8");
  }
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("utf8");
  }
  if (isPlainObject(body) || Array.isArray(body)) {
    return JSON.stringify(body);
  }
  return undefined;
}

function truncateBytes(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) {
    return value;
  }
  return buffer.subarray(0, maxBytes).toString("utf8");
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function looksLikeForm(value: string): boolean {
  return /^[^=&]+=[^&]*(?:&[^=&]+=[^&]*)*$/.test(value);
}

function sanitizeFormBody(value: string): JsonObject {
  const output: JsonObject = {};
  const params = new URLSearchParams(value);
  params.forEach((entry, key) => {
    output[key] = redactValue(key, entry);
  });
  return output;
}

function redactSecretText(value: string): string {
  return value
    .replace(/((?:password|passwd|secret|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|authorization|token)=)[^&\s"']+/gi, `$1${REDACTED}`)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, `$1${REDACTED}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}
