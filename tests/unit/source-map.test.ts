import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { clearSourceMapCache, mapSourceLocation, sourceContentFromMap } from "@codeflow/parser";

describe("source-map resolution", () => {
  it("maps generated JavaScript frames back to TypeScript source", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeflow-sourcemap-"));
    const sourceFile = path.join(dir, "sample.ts");
    const generatedFile = path.join(dir, "sample.js");
    const mapFile = `${generatedFile}.map`;
    const source = [
      "export function checkout() {",
      "  const amount = 42;",
      "  throw new Error(`bad checkout ${amount}`);",
      "}",
      "checkout();",
      ""
    ].join("\n");

    const transpiled = ts.transpileModule(source, {
      fileName: sourceFile,
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
        sourceMap: true
      }
    });

    fs.writeFileSync(sourceFile, source, "utf8");
    fs.writeFileSync(generatedFile, `${transpiled.outputText}\n//# sourceMappingURL=${path.basename(mapFile)}\n`, "utf8");
    fs.writeFileSync(mapFile, transpiled.sourceMapText ?? "", "utf8");
    clearSourceMapCache();

    const generatedLines = transpiled.outputText.split(/\r?\n/);
    const generatedLine = generatedLines.findIndex((line) => line.includes("throw new Error")) + 1;
    const generatedColumn = generatedLines[generatedLine - 1].indexOf("throw") + 1;

    const mapped = mapSourceLocation({
      file: generatedFile,
      line: generatedLine,
      column: generatedColumn,
      functionName: "checkout"
    }, { projectRoot: dir });

    expect(mapped?.mapped).toBe(true);
    expect(mapped?.file).toBe(sourceFile);
    expect(mapped?.line).toBe(3);
    expect(mapped?.original?.file).toBe(generatedFile);

    const content = sourceContentFromMap(mapped, { projectRoot: dir });
    expect(content?.content).toContain("bad checkout");
  });
});
