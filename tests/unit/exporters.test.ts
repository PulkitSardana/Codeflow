import { describe, expect, it } from "vitest";
import { exportSession } from "@codeflow/exporters";
import { createEmptySession } from "@codeflow/session";

describe("HTML reports", () => {
  it("renders recorded text as escaped content", () => {
    const session = createEmptySession({
      project: '<script>alert("unsafe")</script>',
      runtime: "node",
      runtimeVersion: "v24",
      timestamp: "2026-09-26T00:00:00.000Z"
    });

    const report = exportSession(session, "html");

    expect(report).toContain("&lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt;");
    expect(report).not.toContain('<script>alert("unsafe")</script>');
  });
});
