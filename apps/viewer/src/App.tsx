import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock3,
  Code2,
  FileSearch,
  Gauge,
  Globe2,
  ListTree,
  Search,
  SlidersHorizontal,
  TerminalSquare
} from "lucide-react";
import {
  buildCallTree,
  compareSessions,
  flattenCallTree,
  formatPercent,
  summarizePerformance,
  type CallTreeNode,
  type CallTreeSort,
  type ComparisonResult,
  type MetricDelta
} from "@codeflow/analyzer";
import type { ErrorRecord, ExecutionEvent, ExecutionSession, FileSnapshot, HttpRecord, SourceLocation } from "@codeflow/session";

type FilterMode = "all" | "http" | "errors" | "slow";
type SelectionKind = "call" | "event" | "http" | "error";

interface Selection {
  kind: SelectionKind;
  id: string;
}

interface TimelineItem {
  id: string;
  kind: SelectionKind;
  label: string;
  start: number;
  duration: number;
  source?: SourceLocation;
  status?: "ok" | "error";
}

const SLOW_THRESHOLD_MS = 50;

export function App(): JSX.Element {
  const [session, setSession] = useState<ExecutionSession | undefined>();
  const [compareSession, setCompareSession] = useState<ExecutionSession | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [compareError, setCompareError] = useState<string | undefined>();
  const [selection, setSelection] = useState<Selection | undefined>();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sort, setSort] = useState<CallTreeSort>("startTime");
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [threshold, setThreshold] = useState<number | undefined>();

  useEffect(() => {
    const url = new URL(window.location.href);
    const sessionUrl = url.searchParams.get("session") ?? "/api/session";
    const compareUrl = url.searchParams.get("compare");
    const thresholdParam = url.searchParams.get("threshold");
    if (thresholdParam) {
      const parsed = Number(thresholdParam);
      if (Number.isFinite(parsed)) {
        setThreshold(parsed);
      }
    }
    fetch(sessionUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((loaded: ExecutionSession) => {
        setSession(loaded);
        const firstCall = loaded.calls[0];
        const firstEvent = loaded.events[0];
        setSelection(firstCall ? { kind: "call", id: firstCall.id } : firstEvent ? { kind: "event", id: firstEvent.id } : undefined);
        setExpanded(new Set(loaded.calls.filter((call) => !call.parentId).map((call) => call.id)));
      })
      .catch((error) => setLoadError(error instanceof Error ? error.message : String(error)));

    if (compareUrl) {
      fetch(compareUrl)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return response.json();
        })
        .then((loaded: ExecutionSession) => setCompareSession(loaded))
        .catch((error) => setCompareError(error instanceof Error ? error.message : String(error)));
    }
  }, []);

  const performance = useMemo(() => (session ? summarizePerformance(session) : undefined), [session]);
  const tree = useMemo(() => (session ? buildCallTree(session, sort) : []), [session, sort]);
  const flatCalls = useMemo(() => flattenCallTree(tree), [tree]);
  const selected = useMemo(() => (session && selection ? resolveSelection(session, selection) : undefined), [session, selection]);
  const timeline = useMemo(() => (session ? buildTimeline(session) : []), [session]);
  const comparison = useMemo(
    () => (session && compareSession ? compareSessions(compareSession, session, threshold === undefined ? {} : { maxRegressionPercent: threshold }) : undefined),
    [compareSession, session, threshold]
  );

  const filteredCalls = useMemo(() => {
    const term = search.trim().toLowerCase();
    return flatCalls.filter((node) => {
      if (filter === "errors" && node.errorCount === 0) {
        return false;
      }
      if (filter === "slow" && node.totalDuration < SLOW_THRESHOLD_MS) {
        return false;
      }
      if (filter === "http") {
        return false;
      }
      return !term || node.name.toLowerCase().includes(term) || locationLabel(node.source).toLowerCase().includes(term);
    });
  }, [filter, flatCalls, search]);

  const filteredTimeline = useMemo(() => {
    const term = search.trim().toLowerCase();
    return timeline.filter((item) => {
      if (filter === "http" && item.kind !== "http") {
        return false;
      }
      if (filter === "errors" && item.status !== "error" && item.kind !== "error") {
        return false;
      }
      if (filter === "slow" && item.duration < SLOW_THRESHOLD_MS) {
        return false;
      }
      return !term || item.label.toLowerCase().includes(term) || locationLabel(item.source).toLowerCase().includes(term);
    });
  }, [filter, search, timeline]);

  if (loadError && !session) {
    return <LoadFailure message={loadError} onLoad={setSession} />;
  }

  if (!session || !performance) {
    return (
      <div className="loading-shell">
        <TerminalSquare aria-hidden="true" />
        <span>Loading CodeFlow session</span>
      </div>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Code2 aria-hidden="true" />
          <div>
            <h1>CodeFlow</h1>
            <p>{session.metadata.project}</p>
          </div>
        </div>

        <div className="summary-strip" aria-label="Execution summary">
          <Metric icon={<Clock3 />} label="Total" value={`${performance.totalDuration.toFixed(1)}ms`} />
          <Metric icon={<ListTree />} label="Calls" value={String(session.calls.length)} />
          <Metric icon={<Globe2 />} label="HTTP" value={String(session.http.length)} />
          <Metric icon={<AlertTriangle />} label="Errors" value={String(session.errors.length)} tone={session.errors.length ? "danger" : "ok"} />
        </div>

        <div className="search-box">
          <Search aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search events, calls, files" />
        </div>
      </header>

      <section className="toolbar" aria-label="Session controls">
        <div className="segmented">
          <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")} title="All events">
            <ListTree aria-hidden="true" />
            <span>All</span>
          </button>
          <button className={filter === "http" ? "active" : ""} onClick={() => setFilter("http")} title="HTTP activity">
            <Globe2 aria-hidden="true" />
            <span>HTTP</span>
          </button>
          <button className={filter === "errors" ? "active" : ""} onClick={() => setFilter("errors")} title="Errors">
            <AlertTriangle aria-hidden="true" />
            <span>Errors</span>
          </button>
          <button className={filter === "slow" ? "active" : ""} onClick={() => setFilter("slow")} title="Slow events">
            <Gauge aria-hidden="true" />
            <span>Slow</span>
          </button>
        </div>

        <label className="control">
          <SlidersHorizontal aria-hidden="true" />
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as CallTreeSort)}>
            <option value="startTime">Start time</option>
            <option value="duration">Duration</option>
            <option value="callCount">Call count</option>
            <option value="errors">Errors</option>
          </select>
        </label>

        <label className="control">
          <span>Zoom</span>
          <input type="range" min="1" max="6" step="0.25" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
          <output>{zoom.toFixed(2)}x</output>
        </label>
      </section>

      {comparison ? (
        <section className="comparison-band" data-testid="comparison-view">
          <Panel title="Comparison" icon={<Gauge />}>
            <ComparisonPanel
              before={compareSession}
              after={session}
              comparison={comparison}
              threshold={threshold}
              onSelectDifference={(entry, kind) => {
                const target = findDifferenceTarget(session, entry.name, kind);
                setSearch(entry.name);
                setFilter(kind === "http" ? "http" : kind === "database" ? "all" : "all");
                if (target) {
                  setSelection(target);
                  if (target.kind === "call") {
                    setExpanded((current) => expandAncestors(session, current, target.id));
                  }
                }
              }}
            />
          </Panel>
        </section>
      ) : compareError ? (
        <section className="comparison-band">
          <Panel title="Comparison" icon={<Gauge />}>
            <EmptyState text={`Comparison session unavailable: ${compareError}`} />
          </Panel>
        </section>
      ) : null}

      <section className="workspace">
        <Panel title="Call Tree" icon={<ListTree />}>
          {filter === "http" ? (
            <HttpList session={session} selected={selection} onSelect={(id) => setSelection({ kind: "http", id })} />
          ) : filteredCalls.length ? (
            <div className="tree-list">
              {tree.map((node) => (
                <CallNodeRow
                  key={node.id}
                  node={node}
                  depth={0}
                  visibleIds={new Set(filteredCalls.map((call) => call.id))}
                  expanded={expanded}
                  selected={selection}
                  onToggle={(id) => setExpanded((current) => toggleSet(current, id))}
                  onSelect={(id) => setSelection({ kind: "call", id })}
                />
              ))}
            </div>
          ) : (
            <EmptyState text="No calls match the current filter." />
          )}
        </Panel>

        <Panel title="Timeline" icon={<Clock3 />}>
          <Timeline items={filteredTimeline} total={performance.totalDuration} zoom={zoom} selected={selection} onSelect={setSelection} />
        </Panel>

        <Panel title="Source" icon={<FileSearch />}>
          <SourcePanel session={session} source={selected?.source} />
        </Panel>
      </section>

      <section className="lower-grid">
        <Panel title="Event Details" icon={<TerminalSquare />}>
          <Details session={session} selected={selected} />
        </Panel>
        <Panel title="Performance" icon={<Gauge />}>
          <PerformancePanel session={session} />
        </Panel>
      </section>
    </main>
  );
}

function Metric(props: { icon: JSX.Element; label: string; value: string; tone?: "ok" | "danger" }): JSX.Element {
  return (
    <div className={`metric ${props.tone ?? ""}`}>
      {props.icon}
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function Panel(props: { title: string; icon: JSX.Element; children: JSX.Element | JSX.Element[] }): JSX.Element {
  return (
    <section className="panel">
      <header>
        {props.icon}
        <h2>{props.title}</h2>
      </header>
      <div className="panel-body">{props.children}</div>
    </section>
  );
}

function CallNodeRow(props: {
  node: CallTreeNode;
  depth: number;
  visibleIds: Set<string>;
  expanded: Set<string>;
  selected: Selection | undefined;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}): JSX.Element | null {
  const { node } = props;
  if (!props.visibleIds.has(node.id) && !node.children.some((child) => props.visibleIds.has(child.id))) {
    return null;
  }

  const isOpen = props.expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const selected = props.selected?.kind === "call" && props.selected.id === node.id;

  return (
    <>
      <button className={`tree-row ${selected ? "selected" : ""}`} style={{ paddingLeft: 8 + props.depth * 16 }} onClick={() => props.onSelect(node.id)}>
        <span className="tree-toggle" onClick={(event) => {
          event.stopPropagation();
          if (hasChildren) {
            props.onToggle(node.id);
          }
        }}>
          {hasChildren ? isOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" /> : null}
        </span>
        <span className="tree-name">{node.name}</span>
        <span className="tree-location">{locationLabel(node.source)}</span>
        <span className="tree-duration">{node.totalDuration.toFixed(1)}ms</span>
        <span className={`tree-errors ${node.errorCount ? "has-errors" : ""}`}>{node.errorCount}</span>
      </button>
      {isOpen
        ? node.children.map((child) => (
            <CallNodeRow
              key={child.id}
              node={child}
              depth={props.depth + 1}
              visibleIds={props.visibleIds}
              expanded={props.expanded}
              selected={props.selected}
              onToggle={props.onToggle}
              onSelect={props.onSelect}
            />
          ))
        : null}
    </>
  );
}

function Timeline(props: {
  items: TimelineItem[];
  total: number;
  zoom: number;
  selected: Selection | undefined;
  onSelect: (selection: Selection) => void;
}): JSX.Element {
  const width = `${Math.max(100, props.zoom * 100)}%`;
  return (
    <div className="timeline-shell">
      <div className="timeline-scale" style={{ width }}>
        <span>0ms</span>
        <span>{props.total.toFixed(0)}ms</span>
      </div>
      <div className="timeline-list" style={{ width }}>
        {props.items.length ? (
          props.items.map((item) => {
            const start = props.total ? (item.start / props.total) * 100 : 0;
            const itemWidth = props.total ? Math.max((item.duration / props.total) * 100, 0.6) : 1;
            const selected = props.selected?.kind === item.kind && props.selected.id === item.id;
            return (
              <button key={`${item.kind}:${item.id}`} className={`timeline-row ${selected ? "selected" : ""}`} onClick={() => props.onSelect({ kind: item.kind, id: item.id })}>
                <span className="timeline-label">{item.label}</span>
                <span className="timeline-track">
                  <span
                    className={`timeline-bar ${item.kind} ${item.status === "error" ? "error" : ""}`}
                    style={{ left: `${start}%`, width: `${itemWidth}%` }}
                    title={`${item.label}: ${item.duration.toFixed(1)}ms`}
                  />
                </span>
                <span className="timeline-ms">{item.duration.toFixed(1)}ms</span>
              </button>
            );
          })
        ) : (
          <EmptyState text="No timeline items match the current filter." />
        )}
      </div>
    </div>
  );
}

function HttpList(props: { session: ExecutionSession; selected: Selection | undefined; onSelect: (id: string) => void }): JSX.Element {
  if (props.session.http.length === 0) {
    return <EmptyState text="No HTTP activity recorded." />;
  }

  return (
    <div className="http-list">
      {props.session.http.map((entry) => (
        <button key={entry.id} className={`http-row ${props.selected?.kind === "http" && props.selected.id === entry.id ? "selected" : ""}`} onClick={() => props.onSelect(entry.id)}>
          <span className="http-method">{entry.method}</span>
          <span className="http-url">{entry.url}</span>
          <span className={entry.status && entry.status >= 400 ? "http-status error" : "http-status"}>{entry.status ?? "..."}</span>
          <span>{(entry.duration ?? 0).toFixed(1)}ms</span>
        </button>
      ))}
    </div>
  );
}

function SourcePanel(props: { session: ExecutionSession; source?: SourceLocation }): JSX.Element {
  if (!props.source?.file) {
    return <EmptyState text="Source unavailable for this event." />;
  }

  const snapshot = findSnapshot(props.session.files, props.source.file);
  if (!snapshot?.content || !props.source.line) {
    return (
      <div className="source-unavailable">
        <strong>{shortPath(props.source.file)}</strong>
        <p>Source unavailable for this event.</p>
      </div>
    );
  }

  const lines = snapshot.content.split(/\r?\n/);
  const start = Math.max(1, props.source.line - 5);
  const end = Math.min(lines.length, props.source.line + 5);

  return (
    <div className="source-view">
      <div className="source-title">{snapshot.path}</div>
      <pre>
        {Array.from({ length: end - start + 1 }, (_, offset) => {
          const lineNumber = start + offset;
          return (
            <code key={lineNumber} className={lineNumber === props.source?.line ? "highlight" : ""}>
              <span>{lineNumber}</span>
              <b>{lines[lineNumber - 1] || " "}</b>
            </code>
          );
        })}
      </pre>
    </div>
  );
}

function Details(props: { session: ExecutionSession; selected?: ResolvedSelection }): JSX.Element {
  if (!props.selected) {
    return <EmptyState text="Select an execution item to inspect metadata." />;
  }

  return (
    <div className="details-grid">
      <div>
        <span className="detail-label">Kind</span>
        <strong>{props.selected.kind}</strong>
      </div>
      <div>
        <span className="detail-label">Name</span>
        <strong>{props.selected.name}</strong>
      </div>
      <div>
        <span className="detail-label">Duration</span>
        <strong>{props.selected.duration === undefined ? "n/a" : `${props.selected.duration.toFixed(1)}ms`}</strong>
      </div>
      <div>
        <span className="detail-label">Source</span>
        <strong>{locationLabel(props.selected.source) || "n/a"}</strong>
      </div>
      {props.selected.error ? (
        <div className="detail-wide error-detail">
          <span className="detail-label">Error Path</span>
          <strong>{props.selected.error.contextPath.join(" -> ") || "process"}</strong>
          <p>{props.selected.error.type}: {props.selected.error.message}</p>
        </div>
      ) : null}
      <div className="detail-wide">
        <span className="detail-label">Metadata</span>
        <pre>{JSON.stringify(props.selected.metadata ?? {}, null, 2)}</pre>
      </div>
    </div>
  );
}

function PerformancePanel(props: { session: ExecutionSession }): JSX.Element {
  const summary = summarizePerformance(props.session);
  return (
    <div className="perf-panel">
      <div className="perf-summary">
        <span>Total {summary.totalDuration.toFixed(1)}ms</span>
        <span>HTTP {summary.httpTime.toFixed(1)}ms</span>
        <span>DB {summary.databaseTime.toFixed(1)}ms</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Observed Contributor</th>
            <th>Kind</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          {summary.topContributors.slice(0, 8).map((item) => (
            <tr key={`${item.kind}:${item.id}`}>
              <td>{item.name}</td>
              <td>{item.kind}</td>
              <td>{item.duration.toFixed(1)}ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComparisonPanel(props: {
  before: ExecutionSession | undefined;
  after: ExecutionSession;
  comparison: ComparisonResult;
  threshold?: number;
  onSelectDifference: (entry: MetricDelta, kind: "function" | "http" | "database" | "count") => void;
}): JSX.Element {
  const countDifferences = [...props.comparison.callCounts, ...props.comparison.databaseCounts]
    .filter((entry) => entry.delta !== 0)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
    .slice(0, 8);
  const timingRows = [
    ...props.comparison.regressions,
    ...props.comparison.http.filter((entry) => entry.delta !== 0),
    ...props.comparison.database.filter((entry) => entry.delta !== 0)
  ]
    .filter((entry, index, rows) => rows.findIndex((candidate) => candidate.name === entry.name) === index)
    .slice(0, 10);

  return (
    <div className="comparison-view">
      <div className="comparison-summary">
        <div>
          <span>Before</span>
          <strong>{props.comparison.beforeTotal.toFixed(1)}ms</strong>
          <small>{props.before?.metadata.timestamp ?? "comparison"}</small>
        </div>
        <div>
          <span>After</span>
          <strong>{props.comparison.afterTotal.toFixed(1)}ms</strong>
          <small>{props.after.metadata.timestamp}</small>
        </div>
        <div className={props.comparison.totalDelta > 0 ? "delta-up" : "delta-down"}>
          <span>Observed Change</span>
          <strong>{props.comparison.totalDelta.toFixed(1)}ms</strong>
          <small>{formatPercent(props.comparison.totalPercent)}</small>
        </div>
        <div className={props.comparison.thresholdFailures.length ? "threshold-failed" : ""}>
          <span>Threshold</span>
          <strong>{props.threshold === undefined ? "none" : `${props.threshold}%`}</strong>
          <small>{props.comparison.thresholdFailures.length ? "failed" : "clear"}</small>
        </div>
      </div>

      {props.comparison.thresholdFailures.length ? (
        <div className="comparison-alert" role="status">
          {props.comparison.thresholdFailures.map((failure) => (
            <span key={failure}>{failure}</span>
          ))}
        </div>
      ) : null}

      <div className="comparison-columns">
        <div>
          <h3>Timing Differences</h3>
          <ComparisonTable rows={timingRows} kindForRow={kindForTimingRow} onSelect={props.onSelectDifference} />
        </div>
        <div>
          <h3>Count Differences</h3>
          <ComparisonTable rows={countDifferences} kindForRow={(entry) => entry.name.includes("Repository.") ? "database" : "count"} onSelect={props.onSelectDifference} countMode />
        </div>
      </div>
    </div>
  );
}

function ComparisonTable(props: {
  rows: MetricDelta[];
  kindForRow: (entry: MetricDelta) => "function" | "http" | "database" | "count";
  onSelect: (entry: MetricDelta, kind: "function" | "http" | "database" | "count") => void;
  countMode?: boolean;
}): JSX.Element {
  if (props.rows.length === 0) {
    return <EmptyState text="No differences recorded." />;
  }

  return (
    <table className="comparison-table">
      <thead>
        <tr>
          <th>Observed Area</th>
          <th>Before</th>
          <th>After</th>
          <th>Delta</th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map((entry) => (
          <tr key={entry.name}>
            <td>
              <button className="comparison-link" onClick={() => props.onSelect(entry, props.kindForRow(entry))}>
                {entry.name}
              </button>
            </td>
            <td>{formatMetric(entry.before, props.countMode)}</td>
            <td>{formatMetric(entry.after, props.countMode)}</td>
            <td className={entry.delta > 0 ? "delta-up" : "delta-down"}>
              {entry.delta > 0 ? "+" : ""}
              {formatMetric(entry.delta, props.countMode)}
              <small>{formatPercent(entry.percent)}</small>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EmptyState(props: { text: string }): JSX.Element {
  return <div className="empty-state">{props.text}</div>;
}

function LoadFailure(props: { message: string; onLoad: (session: ExecutionSession) => void }): JSX.Element {
  return (
    <div className="load-failure">
      <h1>CodeFlow</h1>
      <p>Could not load the session from the local viewer endpoint: {props.message}</p>
      <label>
        <FileSearch aria-hidden="true" />
        <span>Open session JSON</span>
        <input
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (!file) {
              return;
            }
            file.text().then((text) => props.onLoad(JSON.parse(text) as ExecutionSession));
          }}
        />
      </label>
    </div>
  );
}

interface ResolvedSelection {
  kind: SelectionKind;
  id: string;
  name: string;
  duration?: number;
  source?: SourceLocation;
  metadata?: unknown;
  error?: ErrorRecord;
}

function resolveSelection(session: ExecutionSession, selection: Selection): ResolvedSelection | undefined {
  if (selection.kind === "call") {
    const call = session.calls.find((entry) => entry.id === selection.id);
    return call
      ? {
          kind: "call",
          id: call.id,
          name: call.name,
          duration: call.duration,
          source: call.source,
          metadata: call.metadata,
          error: call.errorIds.length ? session.errors.find((error) => error.id === call.errorIds[0]) : undefined
        }
      : undefined;
  }

  if (selection.kind === "http") {
    const http = session.http.find((entry) => entry.id === selection.id);
    return http
      ? {
          kind: "http",
          id: http.id,
          name: `${http.method} ${http.url}`,
          duration: http.duration,
          source: http.source,
          metadata: http,
          error: http.errorId ? session.errors.find((error) => error.id === http.errorId) : undefined
        }
      : undefined;
  }

  if (selection.kind === "error") {
    const error = session.errors.find((entry) => entry.id === selection.id);
    return error
      ? {
          kind: "error",
          id: error.id,
          name: `${error.type}: ${error.message}`,
          source: error.source,
          metadata: error.metadata,
          error
        }
      : undefined;
  }

  const event = session.events.find((entry) => entry.id === selection.id);
  return event
    ? {
        kind: "event",
        id: event.id,
        name: event.name ?? event.type,
        duration: event.duration,
        source: event.source,
        metadata: event.metadata
      }
    : undefined;
}

function buildTimeline(session: ExecutionSession): TimelineItem[] {
  const calls = session.calls.map((call) => ({
    id: call.id,
    kind: "call" as const,
    label: call.name,
    start: call.startTime,
    duration: call.duration ?? 0,
    source: call.source,
    status: call.errorIds.length ? "error" as const : "ok" as const
  }));
  const http = session.http.map((entry) => ({
    id: entry.id,
    kind: "http" as const,
    label: `${entry.method} ${shortUrl(entry.url)}`,
    start: entry.startTime,
    duration: entry.duration ?? 0,
    source: entry.source,
    status: entry.status && entry.status >= 400 ? "error" as const : "ok" as const
  }));
  const db = session.events.filter((event) => event.type === "database-query").map((event) => ({
    id: event.id,
    kind: "event" as const,
    label: event.name ?? "database-query",
    start: event.time,
    duration: event.duration ?? 0,
    source: event.source,
    status: event.outcome === "error" ? "error" as const : "ok" as const
  }));
  const errors = session.errors.map((error) => ({
    id: error.id,
    kind: "error" as const,
    label: `${error.type}: ${error.message}`,
    start: error.time,
    duration: 1,
    source: error.source,
    status: "error" as const
  }));
  return [...calls, ...http, ...db, ...errors].sort((left, right) => left.start - right.start);
}

function findDifferenceTarget(
  session: ExecutionSession,
  name: string,
  kind: "function" | "http" | "database" | "count"
): Selection | undefined {
  if (kind === "http" || name.startsWith("GET ") || name.startsWith("POST ") || name.startsWith("PUT ") || name.startsWith("PATCH ") || name.startsWith("DELETE ")) {
    const http = session.http.find((entry) => `${entry.method} ${entry.url}` === name || name.includes(entry.url) || `${entry.method} ${entry.url}`.includes(name));
    return http ? { kind: "http", id: http.id } : undefined;
  }

  if (kind === "database") {
    const event = session.events.find((entry) => entry.type === "database-query" && entry.name === name);
    return event ? { kind: "event", id: event.id } : undefined;
  }

  const call = session.calls.find((entry) => entry.name === name);
  return call ? { kind: "call", id: call.id } : undefined;
}

function expandAncestors(session: ExecutionSession, current: Set<string>, callId: string): Set<string> {
  const next = new Set(current);
  let cursor = session.calls.find((call) => call.id === callId)?.parentId;
  while (cursor) {
    next.add(cursor);
    cursor = session.calls.find((call) => call.id === cursor)?.parentId;
  }
  next.add(callId);
  return next;
}

function kindForTimingRow(entry: MetricDelta): "function" | "http" | "database" | "count" {
  if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s/.test(entry.name)) {
    return "http";
  }
  if (entry.name.includes("Repository.") || entry.name.includes(".query")) {
    return "database";
  }
  return "function";
}

function formatMetric(value: number, countMode = false): string {
  return countMode ? value.toFixed(0) : `${value.toFixed(1)}ms`;
}

function findSnapshot(files: FileSnapshot[], sourceFile: string): FileSnapshot | undefined {
  const normalized = sourceFile.replaceAll("\\", "/");
  return files.find((file) => normalized.endsWith(file.path) || file.absolutePath === sourceFile);
}

function locationLabel(source?: SourceLocation): string {
  if (!source?.file) {
    return "";
  }
  return `${shortPath(source.file)}${source.line ? `:${source.line}` : ""}`;
}

function shortPath(file: string): string {
  const normalized = file.replaceAll("\\", "/");
  const parts = normalized.split("/");
  return parts.slice(-3).join("/");
}

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function toggleSet(current: Set<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}
