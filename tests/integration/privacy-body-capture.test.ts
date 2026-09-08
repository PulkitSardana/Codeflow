import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parseSessionJson, type ExecutionSession } from "@codeflow/session";

const root = path.resolve(import.meta.dirname, "../..");

describe("HTTP body privacy", () => {
  it("does not capture bodies by default", () => {
    const session = recordPrivacyFixture([]);
    const request = session.events.find((event) => event.type === "http-request");
    const response = session.events.find((event) => event.type === "http-response");

    expect(request?.metadata?.bodyCaptured).toBe(false);
    expect(request?.metadata).not.toHaveProperty("bodyPreview");
    expect(response?.metadata?.responseBodyCaptured).toBe(false);
    expect(response?.metadata).not.toHaveProperty("responseBodyPreview");
    expect(session.metadata.privacy?.captureBodies).toBe(false);
  });

  it("captures bounded redacted body previews only when explicitly enabled", () => {
    const session = recordPrivacyFixture(["--capture-bodies"]);
    const request = session.events.find((event) => event.type === "http-request");
    const response = session.events.find((event) => event.type === "http-response");

    expect(request?.metadata?.bodyCaptured).toBe(true);
    expect(request?.metadata?.headers).toMatchObject({ authorization: "[REDACTED]" });
    expect(request?.metadata?.url).toContain("access_token=%5BREDACTED%5D");
    expect(request?.metadata?.bodyPreview).toMatchObject({
      captured: true,
      value: {
        userId: "user_123",
        password: "[REDACTED]"
      }
    });
    expect(response?.metadata?.responseBodyCaptured).toBe(true);
    expect(response?.metadata?.responseBodyPreview).toMatchObject({
      captured: true,
      value: {
        ok: true,
        refreshToken: "[REDACTED]"
      }
    });
    expect(session.metadata.privacy?.captureBodies).toBe(true);
  });
});

function recordPrivacyFixture(options: string[]): ExecutionSession {
  const output = path.join(os.tmpdir(), `codeflow-privacy-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const result = spawnSync(
    process.execPath,
    ["packages/cli/dist/index.js", "record", ...options, "--output", output, "--", process.execPath, "tests/fixtures/privacy/fetch-body.mjs"],
    {
      cwd: root,
      encoding: "utf8"
    }
  );

  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const parsed = parseSessionJson(fs.readFileSync(output, "utf8"));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) {
    throw new Error(parsed.errors.join("\n"));
  }
  return parsed.session;
}
