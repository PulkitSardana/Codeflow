import { captureSourceLocation, serializeError } from "@codeflow/parser";
import { redactHeaders, redactUrl, sanitizeHttpBodyPreview, sanitizeMetadata } from "@codeflow/session";
import { getCurrentSpanId, getRecorderBridge } from "@codeflow/core";
import { httpBodyCaptureOptions } from "./privacy.js";

const PATCH_KEY = "__CODEFLOW_FETCH_PATCHED__";

export function patchFetch(): () => void {
  const registry = globalThis as unknown as Record<string, unknown>;
  if (registry[PATCH_KEY] || typeof globalThis.fetch !== "function") {
    return () => undefined;
  }

  registry[PATCH_KEY] = true;
  const original = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const bridge = getRecorderBridge();
    if (!bridge) {
      return original(input, init);
    }

    const request = describeRequest(input, init);
    const bodyCapture = httpBodyCaptureOptions();
    const source = captureSourceLocation();
    const start = performance.now();
    const parentId = getCurrentSpanId();
    const requestEventId = bridge.recordEvent({
      type: "http-request",
      name: `${request.method} ${request.url}`,
      parentId,
      source,
      metadata: sanitizeMetadata({
        method: request.method,
        url: request.url,
        headers: request.headers,
        bodyCaptured: bodyCapture.enabled && Boolean(request.bodyPreview),
        bodyPreview: bodyCapture.enabled ? request.bodyPreview : undefined
      })
    });

    try {
      const response = await original(input, init);
      const responsePreview = bodyCapture.enabled ? await captureResponseBody(response, bodyCapture.maxBytes) : undefined;
      bridge.recordEvent({
        type: "http-response",
        name: `${request.method} ${request.url} ${response.status}`,
        parentId,
        duration: performance.now() - start,
        source,
        metadata: sanitizeMetadata({
          requestEventId,
          method: request.method,
          url: request.url,
          status: response.status,
          ok: response.ok,
          redirected: response.redirected,
          responseBodyCaptured: bodyCapture.enabled && Boolean(responsePreview),
          responseBodyPreview: responsePreview
        }),
        outcome: response.ok ? "ok" : "error"
      });
      return response;
    } catch (error) {
      const serialized = serializeError(error);
      const errorId = bridge.recordError({ ...serialized, parentId, source });
      bridge.recordEvent({
        type: "http-response",
        name: `${request.method} ${request.url} failed`,
        parentId,
        duration: performance.now() - start,
        source,
        metadata: sanitizeMetadata({
          requestEventId,
          method: request.method,
          url: request.url,
          errorId
        }),
        outcome: "error"
      });
      throw error;
    }
  }) as typeof fetch;

  return () => {
    globalThis.fetch = original as typeof fetch;
    registry[PATCH_KEY] = false;
  };
}

function describeRequest(input: RequestInfo | URL, init?: RequestInit): { method: string; url: string; headers?: unknown; bodyPreview?: unknown } {
  const capture = httpBodyCaptureOptions();
  const initHeaders = init?.headers as Headers | Record<string, unknown> | undefined;
  const contentType = headerValue(initHeaders, "content-type");
  const bodyPreview = capture.enabled ? sanitizeHttpBodyPreview(init?.body, contentType, capture.maxBytes) : undefined;

  if (typeof Request !== "undefined" && input instanceof Request) {
    return {
      method: init?.method ?? input.method ?? "GET",
      url: redactUrl(input.url),
      headers: redactHeaders(initHeaders) ?? redactHeaders(input.headers),
      bodyPreview
    };
  }

  return {
    method: init?.method ?? "GET",
    url: redactUrl(String(input)),
    headers: redactHeaders(initHeaders),
    bodyPreview
  };
}

async function captureResponseBody(response: Response, maxBytes: number): Promise<unknown> {
  try {
    const contentType = response.headers.get("content-type") ?? undefined;
    const text = await response.clone().text();
    return sanitizeHttpBodyPreview(text, contentType, maxBytes);
  } catch {
    return {
      captured: false,
      reason: "Could not read response clone"
    };
  }
}

function headerValue(headers: Headers | Record<string, unknown> | undefined, name: string): string | undefined {
  if (!headers) {
    return undefined;
  }
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return typeof found?.[1] === "string" ? found[1] : undefined;
}
