import { describe, expect, it } from "vitest";
import { buildCallTree, compareSessions, summarizePerformance } from "@codeflow/analyzer";
import { createEmptySession, type ExecutionSession } from "@codeflow/session";

describe("analysis", () => {
  it("builds a parented call tree and summarizes durations", () => {
    const session = sampleSession();
    const tree = buildCallTree(session, "duration");
    const summary = summarizePerformance(session);

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("request");
    expect(tree[0].children[0].name).toBe("service");
    expect(tree[0].totalDuration).toBe(100);
    expect(summary.slowestFunctions[0].name).toBe("request");
    expect(summary.repeatedOperations.find((item) => item.name === "InventoryRepository.lookup")?.count).toBe(2);
  });

  it("detects total regressions and count differences", () => {
    const before = sampleSession();
    const after = sampleSession({ total: 150, lookupCount: 4 });
    const comparison = compareSessions(before, after, { maxRegressionPercent: 20 });

    expect(comparison.thresholdFailures).toHaveLength(1);
    expect(comparison.totalPercent).toBe(50);
    expect(comparison.databaseCounts.find((entry) => entry.name === "InventoryRepository.lookup")?.delta).toBe(2);
  });
});

function sampleSession(options: { total?: number; lookupCount?: number } = {}): ExecutionSession {
  const total = options.total ?? 100;
  const lookupCount = options.lookupCount ?? 2;
  const session = createEmptySession({
    project: "sample",
    runtime: "node",
    runtimeVersion: "v24",
    timestamp: "2026-08-25T00:00:00.000Z",
    duration: total
  });

  session.calls.push(
    {
      id: "call-1",
      eventId: "call-1",
      name: "request",
      startTime: 0,
      endTime: total,
      duration: total,
      selfDuration: total - 40,
      callCount: 1,
      errorIds: []
    },
    {
      id: "call-2",
      eventId: "call-2",
      parentId: "call-1",
      name: "service",
      startTime: 10,
      endTime: 50,
      duration: 40,
      selfDuration: 40,
      callCount: 1,
      errorIds: []
    }
  );

  for (let index = 0; index < lookupCount; index += 1) {
    session.events.push({
      id: `event-db-${index}`,
      type: "database-query",
      name: "InventoryRepository.lookup",
      timestamp: "2026-08-25T00:00:00.000Z",
      time: 20 + index,
      duration: 5
    });
  }

  return session;
}
