import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CodeFlowRecorder } from "@codeflow/recorder";
import { REDACTED } from "@codeflow/session";

describe("recorder privacy boundaries", () => {
  it("redacts persisted execution data and excludes sensitive source files", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeflow-recorder-privacy-"));

    try {
      fs.writeFileSync(path.join(projectRoot, "app.js"), 'const apiKey = "source-secret";\n', "utf8");
      fs.writeFileSync(path.join(projectRoot, ".env"), "PASSWORD=environment-secret\n", "utf8");

      const recorder = new CodeFlowRecorder({
        outputFile: path.join(projectRoot, ".codeflow", "session.json"),
        projectRoot,
        metadata: {
          project: "privacy-fixture",
          runtime: "node",
          runtimeVersion: process.version,
          timestamp: new Date().toISOString(),
          rootDir: projectRoot,
          command: ["node", "app.js", "--access-token", "command-secret"]
        }
      });

      recorder.start();
      recorder.startSpan({
        eventType: "function-enter",
        name: "Authorization: Bearer event-secret",
        source: { file: path.join(projectRoot, "app.js"), line: 1 },
        metadata: { detail: "access_token=metadata-secret" }
      });
      recorder.recordEvent({
        type: "custom",
        source: { file: path.join(projectRoot, ".env"), line: 1 }
      });
      recorder.recordError({
        type: "Error",
        message: "access_token=error-secret",
        stack: "Error: Authorization: Bearer stack-secret",
        metadata: { credential: "metadata-secret" },
        source: { file: path.join(projectRoot, "app.js"), line: 1 }
      });

      const session = recorder.stop(1);
      const serialized = JSON.stringify(session);

      for (const secret of [
        "source-secret",
        "environment-secret",
        "command-secret",
        "event-secret",
        "metadata-secret",
        "error-secret",
        "stack-secret",
        projectRoot
      ]) {
        expect(serialized).not.toContain(secret);
      }

      expect(session.metadata.rootDir).toBeUndefined();
      expect(session.metadata.command).toContain(REDACTED);
      expect(session.errors[0]?.message).toBe(`access_token=${REDACTED}`);
      expect(session.files.some((file) => file.path === ".env")).toBe(false);
      expect(session.files.every((file) => file.absolutePath === undefined)).toBe(true);
      expect(session.files.find((file) => file.path === "app.js")?.content).toContain(REDACTED);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
