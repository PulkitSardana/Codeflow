import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parseSessionJson } from "@codeflow/session";

describe("framework auto-instrumentation", () => {
  it("records Express route handlers as spans", () => {
    const session = recordFixture("express-app.mjs");

    expect(session.calls.some((call) => call.name === "Express GET /checkout/:id")).toBe(true);
    expect(session.http.some((entry) => entry.status === 200 && entry.url.includes("/checkout/123"))).toBe(true);
  });

  it("records Fastify route handlers as spans", () => {
    const session = recordFixture("fastify-app.mjs");

    expect(session.calls.some((call) => call.name === "Fastify GET /checkout/:id")).toBe(true);
    expect(session.http.some((entry) => entry.status === 200 && entry.url.includes("/checkout/123"))).toBe(true);
  });
});

function recordFixture(file: string) {
  const output = path.join(os.tmpdir(), `codeflow-${file}-${Date.now()}.json`);
  const result = spawnSync(
    process.execPath,
    ["packages/cli/dist/index.js", "record", "--output", output, "--", process.execPath, `tests/fixtures/frameworks/${file}`],
    {
      cwd: path.resolve(import.meta.dirname, "../.."),
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
