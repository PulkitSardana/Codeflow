import { buildCallTree, compareSessions, formatPercent, summarizePerformance, type CallTreeNode } from "@codeflow/analyzer";
import { serializeSession, type ExecutionSession } from "@codeflow/session";

export type ExportFormat = "json" | "markdown" | "html";

export function exportSession(session: ExecutionSession, format: ExportFormat): string {
  switch (format) {
    case "json":
      return serializeSession(session);
    case "markdown":
      return exportMarkdown(session);
    case "html":
      return exportHtml(session);
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
}

export function exportComparisonMarkdown(before: ExecutionSession, after: ExecutionSession): string {
  const comparison = compareSessions(before, after);
  const lines = [
    "# CodeFlow Comparison",
    "",
    `Before: ${comparison.beforeTotal.toFixed(1)}ms`,
    `After: ${comparison.afterTotal.toFixed(1)}ms`,
    `Observed change: ${comparison.totalDelta.toFixed(1)}ms (${formatPercent(comparison.totalPercent)})`,
    "",
    "## Primary Observed Differences",
    "",
    "| Area | Before | After | Delta |",
    "| --- | ---: | ---: | ---: |"
  ];

  for (const entry of comparison.regressions.slice(0, 10)) {
    lines.push(`| ${escapeMarkdown(entry.name)} | ${entry.before.toFixed(1)} | ${entry.after.toFixed(1)} | ${entry.delta.toFixed(1)} (${formatPercent(entry.percent)}) |`);
  }

  return `${lines.join("\n")}\n`;
}

function exportMarkdown(session: ExecutionSession): string {
  const performance = summarizePerformance(session);
  const tree = buildCallTree(session);
  const lines = [
    "# CodeFlow Session Report",
    "",
    `Project: ${session.metadata.project}`,
    `Runtime: ${session.metadata.runtime} ${session.metadata.runtimeVersion}`,
    `Recorded: ${session.metadata.timestamp}`,
    `Total: ${performance.totalDuration.toFixed(1)}ms`,
    "",
    "## Performance Summary",
    "",
    "| Contributor | Kind | Duration |",
    "| --- | --- | ---: |"
  ];

  for (const item of performance.topContributors.slice(0, 10)) {
    lines.push(`| ${escapeMarkdown(item.name)} | ${item.kind} | ${item.duration.toFixed(1)}ms |`);
  }

  lines.push("", "## HTTP Activity", "", "| Request | Status | Duration |", "| --- | ---: | ---: |");
  for (const item of session.http) {
    lines.push(`| ${escapeMarkdown(`${item.method} ${item.url}`)} | ${item.status ?? "n/a"} | ${(item.duration ?? 0).toFixed(1)}ms |`);
  }

  lines.push("", "## Errors", "");
  if (session.errors.length === 0) {
    lines.push("No errors recorded.");
  } else {
    for (const error of session.errors) {
      lines.push(`- ${escapeMarkdown(error.type)}: ${escapeMarkdown(error.message)} (${error.contextPath.join(" > ") || "process"})`);
    }
  }

  lines.push("", "## Call Tree", "");
  for (const node of tree) {
    appendTreeMarkdown(lines, node, 0);
  }

  return `${lines.join("\n")}\n`;
}

function exportHtml(session: ExecutionSession): string {
  const markdown = exportMarkdown(session);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CodeFlow Report</title>
    <style>
      body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f7f5; color: #1f2328; }
      main { max-width: 1100px; margin: 0 auto; padding: 32px; }
      pre { white-space: pre-wrap; background: #fff; border: 1px solid #d8d8d2; border-radius: 8px; padding: 20px; }
    </style>
  </head>
  <body>
    <main>
      <pre>${escapeHtml(markdown)}</pre>
    </main>
  </body>
</html>
`;
}

function appendTreeMarkdown(lines: string[], node: CallTreeNode, depth: number): void {
  lines.push(`${"  ".repeat(depth)}- ${escapeMarkdown(node.name)} (${node.totalDuration.toFixed(1)}ms, self ${node.selfDuration.toFixed(1)}ms, errors ${node.errorCount})`);
  for (const child of node.children) {
    appendTreeMarkdown(lines, child, depth + 1);
  }
}

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
