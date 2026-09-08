import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { trace } from "@codeflow/core";
import { CodeFlowRecorder } from "@codeflow/recorder";
import { summarizePerformance } from "@codeflow/analyzer";

const ITERATIONS = Number(process.env.CODEFLOW_BENCH_ITERATIONS ?? 1000);
const outputFile = path.join(os.tmpdir(), `codeflow-benchmark-${Date.now()}.json`);

function work() {
  let total = 0;
  for (let index = 0; index < 50; index += 1) {
    total += Math.sqrt(index);
  }
  return total;
}

function measure(label, fn) {
  const start = performance.now();
  fn();
  return { label, duration: performance.now() - start };
}

const baseline = measure("baseline", () => {
  for (let index = 0; index < ITERATIONS; index += 1) {
    work();
  }
});

const recorder = new CodeFlowRecorder({
  outputFile,
  metadata: {
    project: "benchmark",
    runtime: "node",
    runtimeVersion: process.version,
    timestamp: new Date().toISOString(),
    rootDir: process.cwd(),
    command: ["node", "benchmarks/recording-overhead.mjs"]
  }
});
recorder.installAsGlobal();
recorder.start();

const traced = measure("traced", () => {
  for (let index = 0; index < ITERATIONS; index += 1) {
    trace("benchmark.work", () => work());
  }
});

const session = recorder.stop(0);
const analysis = measure("analysis", () => summarizePerformance(session));
const sessionSize = fs.statSync(outputFile).size;

console.log(JSON.stringify({
  iterations: ITERATIONS,
  baselineMs: Number(baseline.duration.toFixed(3)),
  tracedMs: Number(traced.duration.toFixed(3)),
  observedOverheadMs: Number((traced.duration - baseline.duration).toFixed(3)),
  observedOverheadPerTraceUs: Number((((traced.duration - baseline.duration) / ITERATIONS) * 1000).toFixed(3)),
  sessionEvents: session.events.length,
  sessionCalls: session.calls.length,
  sessionSizeBytes: sessionSize,
  analysisMs: Number(analysis.duration.toFixed(3))
}, null, 2));
