import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const runNetworkTests = process.env.CODEFLOW_RUN_NETWORK_TESTS === "1";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe.skipIf(!runNetworkTests)("demo recording", () => {
  it("records calls, HTTP, errors, and source snapshots", () => {
    const output = path.join(os.tmpdir(), `codeflow-demo-${Date.now()}.json`);
    const result = spawnSync(
      process.execPath,
      ["packages/cli/dist/index.js", "record", "--output", output, "--", process.execPath, "examples/demo.js"],
      {
        cwd: root,
        encoding: "utf8"
      }
    );

    expect(result.status).toBe(0);
    const session = JSON.parse(fs.readFileSync(output, "utf8"));
    expect(session.calls.length).toBeGreaterThan(5);
    expect(session.http.length).toBeGreaterThan(0);
    expect(session.errors.length).toBe(1);
    expect(session.files.some((file: { path: string }) => file.path === "examples/demo.js")).toBe(true);
  });
});
