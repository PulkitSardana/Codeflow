import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parseSessionJson } from "@codeflow/session";

const root = path.resolve(import.meta.dirname, "../..");

describe("browser recording", () => {
  it("captures navigation, click, keyboard, network, console errors, and page errors", async () => {
    const server = http.createServer((request, response) => {
      if (request.url === "/api/ping") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html>
        <html>
          <body>
            <button id="checkout">Checkout</button>
            <input id="password" type="password" name="password" />
            <script>
              console.error("browser-console-error");
              fetch("/api/ping");
              setTimeout(() => {
                document.getElementById("checkout").click();
                document.getElementById("password").dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
                throw new Error("browser-page-error");
              }, 20);
            </script>
          </body>
        </html>`);
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Could not bind browser fixture");
      }
      const output = path.join(os.tmpdir(), `codeflow-browser-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
      const result = await runCli(["record-browser", `http://127.0.0.1:${address.port}`, "--output", output, "--timeout-ms", "5000", "--settle-ms", "300"]);

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const parsed = parseSessionJson(fs.readFileSync(output, "utf8"));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) {
        throw new Error(parsed.errors.join("\n"));
      }

      const eventNames = parsed.session.events.map((event) => event.name);
      expect(eventNames).toContain("browser-navigation");
      expect(eventNames).toContain("browser-click");
      expect(eventNames).toContain("browser-keydown");
      expect(eventNames).toContain("browser:error");
      expect(parsed.session.http.some((entry) => entry.url.endsWith("/api/ping") && entry.status === 200)).toBe(true);
      expect(parsed.session.errors.some((entry) => entry.message.includes("browser-page-error"))).toBe(true);

      const keydown = parsed.session.events.find((event) => event.name === "browser-keydown");
      expect(keydown?.metadata).toMatchObject({
        key: "[character]",
        printable: true,
        target: {
          type: "password"
        }
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

function runCli(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["packages/cli/dist/index.js", ...args], {
      cwd: root
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}
