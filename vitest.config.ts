import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@codeflow/session": path.join(root, "packages/session/src/index.ts"),
      "@codeflow/parser": path.join(root, "packages/parser/src/index.ts"),
      "@codeflow/core": path.join(root, "packages/core/src/index.ts"),
      "@codeflow/analyzer": path.join(root, "packages/analyzer/src/index.ts"),
      "@codeflow/exporters": path.join(root, "packages/exporters/src/index.ts")
    }
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
    fileParallelism: true
  }
});
