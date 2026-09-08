import type { ExecutionSession, RegressionThresholds } from "@codeflow/session";
import { inferTotalDuration } from "./performance.js";

export interface MetricDelta {
  name: string;
  before: number;
  after: number;
  delta: number;
  percent: number | null;
}

export interface ComparisonResult {
  beforeTotal: number;
  afterTotal: number;
  totalDelta: number;
  totalPercent: number | null;
  functions: MetricDelta[];
  callCounts: MetricDelta[];
  database: MetricDelta[];
  databaseCounts: MetricDelta[];
  http: MetricDelta[];
  errors: MetricDelta[];
  paths: {
    beforeRoots: string[];
    afterRoots: string[];
    addedRoots: string[];
    removedRoots: string[];
  };
  regressions: MetricDelta[];
  thresholdFailures: string[];
}

export function compareSessions(
  before: ExecutionSession,
  after: ExecutionSession,
  thresholds: RegressionThresholds = {}
): ComparisonResult {
  const beforeTotal = inferTotalDuration(before);
  const afterTotal = inferTotalDuration(after);
  const totalDelta = afterTotal - beforeTotal;
  const totalPercent = percentChange(beforeTotal, afterTotal);

  const functions = compareMaps(aggregateCalls(before), aggregateCalls(after));
  const callCounts = compareMaps(aggregateCallCounts(before), aggregateCallCounts(after));
  const database = compareMaps(aggregateDatabase(before), aggregateDatabase(after));
  const databaseCounts = compareMaps(aggregateDatabaseCounts(before), aggregateDatabaseCounts(after));
  const http = compareMaps(aggregateHttp(before), aggregateHttp(after));
  const errors = compareMaps(aggregateErrors(before), aggregateErrors(after));
  const regressions = [
    metric("Total runtime", beforeTotal, afterTotal),
    ...functions.filter((entry) => entry.delta > 0).slice(0, 10),
    ...database.filter((entry) => entry.delta > 0).slice(0, 10),
    ...http.filter((entry) => entry.delta > 0).slice(0, 10)
  ].filter((entry) => entry.delta > 0);

  const beforeRoots = before.calls.filter((call) => !call.parentId).map((call) => call.name);
  const afterRoots = after.calls.filter((call) => !call.parentId).map((call) => call.name);
  const thresholdFailures = evaluateThresholds({
    beforeTotal,
    afterTotal,
    totalPercent,
    beforeErrors: before.errors.length,
    afterErrors: after.errors.length,
    thresholds
  });

  return {
    beforeTotal,
    afterTotal,
    totalDelta,
    totalPercent,
    functions,
    callCounts,
    database,
    databaseCounts,
    http,
    errors,
    paths: {
      beforeRoots,
      afterRoots,
      addedRoots: afterRoots.filter((name) => !beforeRoots.includes(name)),
      removedRoots: beforeRoots.filter((name) => !afterRoots.includes(name))
    },
    regressions,
    thresholdFailures
  };
}

export function hasRegression(result: ComparisonResult): boolean {
  return result.thresholdFailures.length > 0;
}

export function formatPercent(value: number | null): string {
  if (value === null) {
    return "n/a";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function evaluateThresholds(input: {
  beforeTotal: number;
  afterTotal: number;
  totalPercent: number | null;
  beforeErrors: number;
  afterErrors: number;
  thresholds: RegressionThresholds;
}): string[] {
  const failures: string[] = [];
  if (
    typeof input.thresholds.maxRegressionPercent === "number" &&
    input.totalPercent !== null &&
    input.totalPercent > input.thresholds.maxRegressionPercent
  ) {
    failures.push(`Total runtime regressed by ${formatPercent(input.totalPercent)} (threshold ${input.thresholds.maxRegressionPercent}%).`);
  }
  if (typeof input.thresholds.maxTotalDurationMs === "number" && input.afterTotal > input.thresholds.maxTotalDurationMs) {
    failures.push(`After session total ${input.afterTotal.toFixed(1)}ms exceeds ${input.thresholds.maxTotalDurationMs}ms.`);
  }
  if (
    typeof input.thresholds.maxNewErrors === "number" &&
    input.afterErrors - input.beforeErrors > input.thresholds.maxNewErrors
  ) {
    failures.push(`After session has ${input.afterErrors - input.beforeErrors} new errors (threshold ${input.thresholds.maxNewErrors}).`);
  }
  return failures;
}

function aggregateCalls(session: ExecutionSession): Map<string, number> {
  const map = new Map<string, number>();
  for (const call of session.calls) {
    map.set(call.name, (map.get(call.name) ?? 0) + (call.duration ?? 0));
  }
  return map;
}

function aggregateCallCounts(session: ExecutionSession): Map<string, number> {
  const map = new Map<string, number>();
  for (const call of session.calls) {
    map.set(call.name, (map.get(call.name) ?? 0) + 1);
  }
  return map;
}

function aggregateDatabase(session: ExecutionSession): Map<string, number> {
  const map = new Map<string, number>();
  for (const event of session.events) {
    if (event.type !== "database-query") {
      continue;
    }
    const key = event.name ?? "database-query";
    map.set(key, (map.get(key) ?? 0) + (event.duration ?? 0));
  }
  return map;
}

function aggregateDatabaseCounts(session: ExecutionSession): Map<string, number> {
  const map = new Map<string, number>();
  for (const event of session.events) {
    if (event.type !== "database-query") {
      continue;
    }
    const key = event.name ?? "database-query";
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function aggregateHttp(session: ExecutionSession): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of session.http) {
    const key = `${entry.method} ${entry.url}`;
    map.set(key, (map.get(key) ?? 0) + (entry.duration ?? 0));
  }
  return map;
}

function aggregateErrors(session: ExecutionSession): Map<string, number> {
  const map = new Map<string, number>();
  for (const error of session.errors) {
    const key = `${error.type}: ${error.message}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function compareMaps(before: Map<string, number>, after: Map<string, number>): MetricDelta[] {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return Array.from(keys)
    .map((key) => metric(key, before.get(key) ?? 0, after.get(key) ?? 0))
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));
}

function metric(name: string, before: number, after: number): MetricDelta {
  return {
    name,
    before,
    after,
    delta: after - before,
    percent: percentChange(before, after)
  };
}

function percentChange(before: number, after: number): number | null {
  if (before === 0) {
    return after === 0 ? 0 : null;
  }
  return ((after - before) / before) * 100;
}
