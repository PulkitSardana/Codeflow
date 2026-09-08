import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { expect, test } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "../..");
const cli = path.join(root, "packages/cli/dist/index.js");

test.describe("CodeFlow viewer", () => {
  test("explores a real recorded session", async ({ page }) => {
    const session = recordSession("viewer-session", {});
    const server = await openViewer(session.file, undefined, 3951);

    try {
      await page.goto(server.url);
      await expect(page.getByRole("heading", { name: "CodeFlow" })).toBeVisible();
      await expect(page.getByText("PaymentService.charge").first()).toBeVisible();
      await expect(page.getByText("POST 127.0.0.1").first()).toBeVisible();

      await page.getByRole("button", { name: "HTTP" }).click();
      await expect(page.getByText(/payment\?access_token=%5BREDACTED%5D/).first()).toBeVisible();
      await page.getByText(/payment\?access_token=%5BREDACTED%5D/).first().click();
      await expect(page.getByText("Event Details")).toBeVisible();

      await page.getByRole("button", { name: "Errors" }).click();
      await expect(page.getByText("PromoService.validateCode").first()).toBeVisible();

      await page.getByRole("button", { name: "All" }).click();
      await page.getByText("PaymentService.charge").first().click();
      await expect(page.locator(".source-title")).toHaveText("examples/demo.js");
      await expect(page.locator(".source-view code.highlight")).toContainText("PaymentService.charge");
    } finally {
      await stopServer(server.process);
    }
  });

  test("shows an interactive comparison for two real recorded sessions", async ({ page }) => {
    const before = recordSession("viewer-before", {});
    const after = recordSession("viewer-after", { CODEFLOW_DEMO_REGRESSION: "1" });
    const server = await openViewer(after.file, before.file, 3952);

    try {
      await page.goto(server.url);
      await expect(page.getByTestId("comparison-view")).toBeVisible();
      await expect(page.getByText(/Total runtime regressed by/)).toBeVisible();
      await expect(page.getByText("InventoryRepository.lookup").first()).toBeVisible();
      await page.getByRole("button", { name: "InventoryService.reserve" }).first().click();
      await expect(page.getByPlaceholder("Search events, calls, files")).toHaveValue("InventoryService.reserve");
      await expect(page.getByText("InventoryService.reserve").first()).toBeVisible();
    } finally {
      await stopServer(server.process);
    }
  });
});

function recordSession(label: string, env: NodeJS.ProcessEnv): { file: string } {
  const file = path.join(os.tmpdir(), `codeflow-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const result = spawnSync(
    process.execPath,
    [cli, "record", "--output", file, "--", process.execPath, "examples/demo.js"],
    {
      cwd: root,
      env: { ...process.env, ...env },
      encoding: "utf8"
    }
  );

  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const session = JSON.parse(fs.readFileSync(file, "utf8")) as { calls: unknown[]; http: unknown[]; errors: unknown[] };
  expect(session.calls.length).toBeGreaterThan(10);
  expect(session.http.length).toBeGreaterThan(0);
  expect(session.errors.length).toBe(1);
  return { file };
}

async function openViewer(session: string, compare: string | undefined, port: number): Promise<{ process: ChildProcessWithoutNullStreams; url: string }> {
  const args = [cli, "open", session, "--no-open", "--port", String(port), "--threshold", "20"];
  if (compare) {
    args.splice(3, 0, "--compare", compare);
  }

  const child = spawn(process.execPath, args, {
    cwd: root,
    env: process.env
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const url = await waitForOutput(child, () => {
    const match = /CodeFlow viewer: (http:\/\/127\.0\.0\.1:\d+\/\S*)/.exec(stdout);
    return match?.[1];
  }, () => stderr);

  return { process: child, url };
}

async function waitForOutput<T>(
  child: ChildProcessWithoutNullStreams,
  read: () => T | undefined,
  readError: () => string
): Promise<T> {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const value = read();
    if (value) {
      return value;
    }
    if (child.exitCode !== null) {
      throw new Error(`Viewer exited early: ${readError()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for viewer: ${readError()}`);
}

async function stopServer(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(() => resolve(), 1000);
  });
}
