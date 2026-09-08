import type { ExecutionEvent, ExecutionSession, HttpRecord, SourceLocation } from "@codeflow/session";

export interface TimedContributor {
  id: string;
  kind: "function" | "http" | "database" | "event";
  name: string;
  duration: number;
  selfDuration?: number;
  count?: number;
  source?: SourceLocation;
}

export interface RepeatedOperation {
  name: string;
  count: number;
  totalDuration: number;
  averageDuration: number;
  kind: "function" | "http" | "database";
}

export interface PerformanceSummary {
  totalDuration: number;
  functionTime: number;
  httpTime: number;
  databaseTime: number;
  errorCount: number;
  slowestFunctions: TimedContributor[];
  slowestHttpRequests: TimedContributor[];
  slowestDatabaseQueries: TimedContributor[];
  topContributors: TimedContributor[];
  repeatedOperations: RepeatedOperation[];
}

export function summarizePerformance(session: ExecutionSession): PerformanceSummary {
  const totalDuration = session.metadata.duration ?? inferTotalDuration(session);
  const functionContributors = session.calls.map((call) => ({
    id: call.id,
    kind: "function" as const,
    name: call.name,
    duration: call.duration ?? 0,
    selfDuration: call.selfDuration,
    count: call.callCount,
    source: call.source
  }));
  const httpContributors = session.http.map((entry) => httpToContributor(entry));
  const databaseContributors = session.events
    .filter((event) => event.type === "database-query")
    .map((event) => eventToContributor(event, "database" as const));

  const topContributors = [...functionContributors, ...httpContributors, ...databaseContributors]
    .filter((entry) => entry.duration > 0)
    .sort((left, right) => right.duration - left.duration)
    .slice(0, 15);

  return {
    totalDuration,
    functionTime: sum(functionContributors.map((entry) => entry.duration)),
    httpTime: sum(httpContributors.map((entry) => entry.duration)),
    databaseTime: sum(databaseContributors.map((entry) => entry.duration)),
    errorCount: session.errors.length,
    slowestFunctions: functionContributors.sort(descDuration).slice(0, 10),
    slowestHttpRequests: httpContributors.sort(descDuration).slice(0, 10),
    slowestDatabaseQueries: databaseContributors.sort(descDuration).slice(0, 10),
    topContributors,
    repeatedOperations: repeatedOperations(session)
  };
}

export function inferTotalDuration(session: ExecutionSession): number {
  const processEnd = [...session.events].reverse().find((event) => event.type === "process-end");
  if (processEnd?.duration) {
    return processEnd.duration;
  }
  return Math.max(0, ...session.events.map((event) => event.time + (event.duration ?? 0)), ...session.calls.map((call) => call.endTime ?? call.startTime));
}

function httpToContributor(entry: HttpRecord): TimedContributor {
  return {
    id: entry.id,
    kind: "http",
    name: `${entry.method} ${entry.url}`,
    duration: entry.duration ?? 0,
    source: entry.source
  };
}

function eventToContributor(event: ExecutionEvent, kind: "database" | "event"): TimedContributor {
  return {
    id: event.id,
    kind,
    name: event.name ?? event.type,
    duration: event.duration ?? 0,
    source: event.source
  };
}

function repeatedOperations(session: ExecutionSession): RepeatedOperation[] {
  const groups = new Map<string, { kind: RepeatedOperation["kind"]; count: number; totalDuration: number }>();

  for (const call of session.calls) {
    add(groups, `function:${call.name}`, "function", call.duration ?? 0);
  }

  for (const entry of session.http) {
    add(groups, `http:${entry.method} ${entry.url}`, "http", entry.duration ?? 0);
  }

  for (const event of session.events) {
    if (event.type === "database-query") {
      add(groups, `database:${event.name ?? "query"}`, "database", event.duration ?? 0);
    }
  }

  return Array.from(groups.entries())
    .filter(([, group]) => group.count > 1)
    .map(([key, group]) => ({
      name: key.replace(/^(function|http|database):/, ""),
      kind: group.kind,
      count: group.count,
      totalDuration: group.totalDuration,
      averageDuration: group.totalDuration / group.count
    }))
    .sort((left, right) => right.totalDuration - left.totalDuration);
}

function add(
  groups: Map<string, { kind: RepeatedOperation["kind"]; count: number; totalDuration: number }>,
  key: string,
  kind: RepeatedOperation["kind"],
  duration: number
): void {
  const group = groups.get(key) ?? { kind, count: 0, totalDuration: 0 };
  group.count += 1;
  group.totalDuration += duration;
  groups.set(key, group);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function descDuration(left: TimedContributor, right: TimedContributor): number {
  return right.duration - left.duration;
}
