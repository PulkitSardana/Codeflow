import http from "node:http";
import https from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { captureSourceLocation, serializeError } from "@codeflow/parser";
import { redactHeaders, redactUrl, sanitizeMetadata } from "@codeflow/session";
import { getCurrentSpanId, getRecorderBridge } from "@codeflow/core";

const PATCH_KEY = "__CODEFLOW_NODE_HTTP_PATCHED__";

type HttpModule = typeof http | typeof https;
type RequestFunction = typeof http.request;
type GetFunction = typeof http.get;

export function patchNodeHttp(): () => void {
  const registry = globalThis as unknown as Record<string, unknown>;
  if (registry[PATCH_KEY]) {
    return () => undefined;
  }

  registry[PATCH_KEY] = true;
  const restores = [patchModule(http, "http:"), patchModule(https, "https:")];
  return () => {
    for (const restore of restores) {
      restore();
    }
    registry[PATCH_KEY] = false;
  };
}

function patchModule(moduleRef: HttpModule, protocol: "http:" | "https:"): () => void {
  const mutable = moduleRef as unknown as { request: RequestFunction; get: GetFunction };
  const originalRequest = mutable.request;
  const originalGet = mutable.get;

  mutable.request = function patchedRequest(...args: Parameters<RequestFunction>): ClientRequest {
    const bridge = getRecorderBridge();
    if (!bridge) {
      return originalRequest.apply(moduleRef, args) as ClientRequest;
    }

    const request = describeRequest(args, protocol);
    const source = captureSourceLocation();
    const parentId = getCurrentSpanId();
    const start = performance.now();
    const requestEventId = bridge.recordEvent({
      type: "http-request",
      name: `${request.method} ${request.url}`,
      parentId,
      source,
      metadata: sanitizeMetadata({
        method: request.method,
        url: request.url,
        headers: request.headers,
        bodyCaptured: false,
        client: "node:http"
      })
    });

    const req = originalRequest.apply(moduleRef, args) as ClientRequest;
    let completed = false;

    const finish = (response: IncomingMessage | undefined, error?: unknown) => {
      if (completed) {
        return;
      }
      completed = true;
      const serialized = error ? serializeError(error) : undefined;
      const errorId = serialized ? bridge.recordError({ ...serialized, parentId, source }) : undefined;
      bridge.recordEvent({
        type: "http-response",
        name: `${request.method} ${request.url} ${response?.statusCode ?? "failed"}`,
        parentId,
        duration: performance.now() - start,
        source,
        metadata: sanitizeMetadata({
          requestEventId,
          method: request.method,
          url: request.url,
          status: response?.statusCode,
          headers: response?.headers ? redactHeaders(response.headers as Record<string, unknown>) : undefined,
          errorId,
          responseBodyCaptured: false,
          timing: "response-headers"
        }),
        outcome: serialized || (response?.statusCode && response.statusCode >= 400) ? "error" : "ok"
      });
    };

    req.once("response", (response) => finish(response));
    req.once("error", (error) => finish(undefined, error));
    return req;
  } as RequestFunction;

  mutable.get = function patchedGet(...args: Parameters<GetFunction>): ClientRequest {
    const req = mutable.request(...(args as Parameters<RequestFunction>));
    req.end();
    return req;
  } as GetFunction;

  return () => {
    mutable.request = originalRequest;
    mutable.get = originalGet;
  };
}

function describeRequest(args: unknown[], protocol: "http:" | "https:"): { method: string; url: string; headers?: unknown } {
  const [first, second] = args;
  const options = mergeOptions(first, second);
  const method = String(options.method ?? "GET").toUpperCase();
  const host = options.hostname ?? options.host ?? "localhost";
  const path = options.path ?? "/";
  const port = options.port ? `:${String(options.port)}` : "";

  if (typeof first === "string" || first instanceof URL) {
    try {
      const parsed = new URL(String(first));
      if (options.method) {
        return {
          method,
          url: redactUrl(parsed.toString()),
          headers: options.headers
        };
      }
      return {
        method: String(options.method ?? "GET").toUpperCase(),
        url: redactUrl(parsed.toString()),
        headers: options.headers
      };
    } catch {
      return { method, url: redactUrl(String(first)), headers: options.headers };
    }
  }

  return {
    method,
    url: redactUrl(`${protocol}//${host}${port}${path}`),
    headers: options.headers
  };
}

function mergeOptions(first: unknown, second: unknown): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  if (first && typeof first === "object" && !(first instanceof URL)) {
    Object.assign(output, first);
  }
  if (second && typeof second === "object") {
    Object.assign(output, second);
  }
  return output;
}
