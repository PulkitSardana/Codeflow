# Benchmarks

Run:

```bash
npm run build
node benchmarks/recording-overhead.mjs
```

The benchmark measures:

- Baseline loop time.
- Traced loop time.
- Observed overhead per `trace()` span.
- Session size.
- Analysis time.

Benchmark output is machine-readable JSON. Results vary by Node version, CPU, active instrumentation, and filesystem. CodeFlow reports observed measurements only and does not claim universal overhead numbers.

## Local Baseline

Observed on 2026-08-25 with Node `v24.11.1` in this workspace:

```json
{
  "iterations": 1000,
  "baselineMs": 0.932,
  "tracedMs": 22.259,
  "observedOverheadMs": 21.326,
  "observedOverheadPerTraceUs": 21.326,
  "sessionEvents": 2002,
  "sessionCalls": 1000,
  "sessionSizeBytes": 1575524,
  "analysisMs": 1.134
}
```
