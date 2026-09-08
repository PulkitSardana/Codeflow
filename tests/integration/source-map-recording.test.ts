import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parseSessionJson } from "@codeflow/session";

const root = path.resolve(import.meta.dirname, "../..");

describe("recorder source maps", () => {
  it("records original TypeScript source locations from generated JavaScript", () => {
    const build = spawnSync("npx", ["tsc", "-p", "tests/fixtures/source-map/tsconfig.json"], {
      cwd: root,
      encoding: "utf8"
    });
    expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0);

    const output = path.join(os.tmpdir(), `codeflow-sourcemap-session-${Date.now()}.json`);
    const result = spawnSync(
      process.execPath,
      ["packages/cli/dist/index.js", "record", "--output", output, "--", process.execPath, "tests/fixtures/source-map/dist/app.js"],
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

    const call = parsed.session.calls.find((entry) => entry.name === "TypeScriptCheckout.run");
    expect(call?.source?.file?.replaceAll("\\", "/")).toContain("tests/fixtures/source-map/src/app.ts");
    expect(call?.source?.line).toBe(4);
    expect(parsed.session.files.some((file) => file.path === "tests/fixtures/source-map/src/app.ts" && file.content?.includes("TypeScriptCheckout.run"))).toBe(true);
  });
});
