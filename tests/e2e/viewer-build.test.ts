import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("viewer build", () => {
  it("emits static assets that codeflow open can serve", () => {
    const index = path.resolve("apps/viewer/dist/index.html");
    expect(fs.existsSync(index)).toBe(true);
    expect(fs.readFileSync(index, "utf8")).toContain("CodeFlow Viewer");
  });
});
