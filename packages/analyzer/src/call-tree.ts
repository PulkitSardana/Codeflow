import type { CallRecord, ExecutionSession, SourceLocation } from "@codeflow/session";

export type CallTreeSort = "duration" | "callCount" | "errors" | "startTime";

export interface CallTreeNode {
  id: string;
  callId: string;
  name: string;
  totalDuration: number;
  selfDuration: number;
  callCount: number;
  errorCount: number;
  source?: SourceLocation;
  startTime: number;
  endTime?: number;
  children: CallTreeNode[];
}

export function buildCallTree(session: ExecutionSession, sortBy: CallTreeSort = "startTime"): CallTreeNode[] {
  const nodeById = new Map<string, CallTreeNode>();
  const roots: CallTreeNode[] = [];

  for (const call of session.calls) {
    nodeById.set(call.id, toNode(call));
  }

  for (const call of session.calls) {
    const node = nodeById.get(call.id);
    if (!node) {
      continue;
    }

    if (call.parentId && nodeById.has(call.parentId)) {
      nodeById.get(call.parentId)?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  sortNodes(roots, sortBy);
  return roots;
}

export function flattenCallTree(nodes: CallTreeNode[]): CallTreeNode[] {
  const output: CallTreeNode[] = [];
  const visit = (node: CallTreeNode) => {
    output.push(node);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return output;
}

function toNode(call: CallRecord): CallTreeNode {
  return {
    id: call.id,
    callId: call.id,
    name: call.name,
    totalDuration: call.duration ?? 0,
    selfDuration: call.selfDuration ?? call.duration ?? 0,
    callCount: call.callCount,
    errorCount: call.errorIds.length,
    source: call.source,
    startTime: call.startTime,
    endTime: call.endTime,
    children: []
  };
}

function sortNodes(nodes: CallTreeNode[], sortBy: CallTreeSort): void {
  nodes.sort((left, right) => compareNodes(left, right, sortBy));
  for (const node of nodes) {
    sortNodes(node.children, sortBy);
  }
}

function compareNodes(left: CallTreeNode, right: CallTreeNode, sortBy: CallTreeSort): number {
  switch (sortBy) {
    case "duration":
      return right.totalDuration - left.totalDuration;
    case "callCount":
      return right.callCount - left.callCount;
    case "errors":
      return right.errorCount - left.errorCount;
    case "startTime":
    default:
      return left.startTime - right.startTime;
  }
}
