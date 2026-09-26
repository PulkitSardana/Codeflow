import { describe, expect, it } from "vitest";
import { createEmptySession, parseSessionJson, redactHeaders, redactText, redactUrl, sanitizeCommand, sanitizeHttpBodyPreview, sanitizeMetadata } from "@codeflow/session";

describe("session format", () => {
  it("validates a minimal versioned session", () => {
    const session = createEmptySession({
      project: "unit",
      runtime: "node",
      runtimeVersion: "v24",
      timestamp: new Date("2026-08-25T00:00:00.000Z").toISOString()
    });

    const parsed = parseSessionJson(JSON.stringify(session));

    expect(parsed.ok).toBe(true);
  });

  it("rejects invalid sessions with actionable errors", () => {
    const parsed = parseSessionJson(JSON.stringify({ version: 999 }));

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.join("\n")).toContain("Expected version 1");
      expect(parsed.errors.join("\n")).toContain("metadata must be an object");
    }
  });
});

describe("privacy redaction", () => {
  it("redacts secrets in URLs, headers, and metadata", () => {
    expect(redactUrl("https://api.example.test/pay?access_token=secret&cart=123")).toBe(
      "https://api.example.test/pay?access_token=%5BREDACTED%5D&cart=123"
    );
    expect(redactHeaders({ authorization: "Bearer secret", "content-type": "json" })).toEqual({
      authorization: "[REDACTED]",
      "content-type": "json"
    });
    expect(sanitizeMetadata({ password: "secret", nested: { apiKey: "secret" } })).toEqual({
      password: "[REDACTED]",
      nested: { apiKey: "[REDACTED]" }
    });
    expect(redactUrl("https://user:pass@example.test/#access_token=secret")).toBe(
      "https://%5BREDACTED%5D:%5BREDACTED%5D@example.test/#access_token=[REDACTED]"
    );
    expect(redactText("Authorization: Bearer secret-value")).toBe("Authorization: [REDACTED]");
    expect(sanitizeMetadata({ detail: "access_token=secret-value" })).toEqual({ detail: "access_token=[REDACTED]" });
    expect(sanitizeMetadata({ detail: "authorization=secret-value" })).toEqual({ detail: "authorization=[REDACTED]" });
    expect(sanitizeCommand(["node", "app.js", "--api-key", "secret-value", "--token=another-secret"])).toEqual([
      "node",
      "app.js",
      "--api-key",
      "[REDACTED]",
      "--token=[REDACTED]"
    ]);
  });

  it("sanitizes opt-in HTTP body previews", () => {
    expect(sanitizeHttpBodyPreview(JSON.stringify({ userId: "user_1", password: "secret" }), "application/json")).toEqual({
      captured: true,
      encoding: "text",
      contentType: "application/json",
      truncated: false,
      value: {
        userId: "user_1",
        password: "[REDACTED]"
      }
    });

    expect(sanitizeHttpBodyPreview("access_token=secret&cart=123", "application/x-www-form-urlencoded")).toEqual({
      captured: true,
      encoding: "text",
      contentType: "application/x-www-form-urlencoded",
      truncated: false,
      value: {
        access_token: "[REDACTED]",
        cart: "123"
      }
    });
  });
});
