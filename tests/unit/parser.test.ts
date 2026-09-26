import { describe, expect, it } from "vitest";
import { parseStackLine } from "@codeflow/parser";

describe("stack parsing", () => {
  it("parses function and direct Node.js stack frames without backtracking patterns", () => {
    expect(parseStackLine("at checkout (/workspace/app.ts:42:7)")).toMatchObject({
      functionName: "checkout",
      file: "/workspace/app.ts",
      line: 42,
      column: 7
    });
    expect(parseStackLine("at /workspace/app.ts:43:9")).toMatchObject({
      file: "/workspace/app.ts",
      line: 43,
      column: 9
    });
  });

  it("rejects malformed frame locations", () => {
    expect(parseStackLine("at checkout (/workspace/app.ts:line:column)")).toBeUndefined();
    expect(parseStackLine("checkout (/workspace/app.ts:42:7)")).toBeUndefined();
  });
});
