# CodeFlow Session Format

CodeFlow sessions are portable JSON files. Version `1` is the first public format.

```json
{
  "version": 1,
  "metadata": {
    "project": "example",
    "runtime": "node",
    "runtimeVersion": "v24.11.1",
    "timestamp": "2026-08-25T00:00:00.000Z"
  },
  "events": [],
  "calls": [],
  "http": [],
  "errors": [],
  "files": []
}
```

## Metadata

`metadata` records the project name, runtime, runtime version, timestamp, optional command, root directory, platform, architecture, total observed duration, and exit code.

## Events

Every event includes:

- `id`: stable session-local identifier.
- `type`: one of `process-start`, `process-end`, `function-enter`, `function-exit`, `http-request`, `http-response`, `database-query`, `error`, `console`, `file-read`, `file-write`, or `custom`.
- `timestamp`: wall-clock ISO timestamp.
- `time`: milliseconds since recorder start.
- `duration`: observed duration when available.
- `parentId`: active function span when available.
- `context`: process/runtime context.
- `source`: file, line, column, function, and module when discoverable.
- `metadata`: sanitized JSON metadata.

## Calls

`calls` are derived from explicit `trace()` spans. Each call includes total duration, self duration, parent call id, error ids, call count, and source location.

## HTTP

`http` pairs request and response events. CodeFlow records method, redacted URL, status, timing, retry attempt when available, and source location. Request and response bodies are not captured by default.

## Errors

`errors` store error type, message, stack, source location, and the preceding execution context path.

## Files

`files` contains source snapshots for files referenced by recorded source locations when those files are inside the project root and below the configured size limit. This makes sessions portable enough for source navigation in the viewer.

When generated JavaScript has source maps, CodeFlow resolves stack frames back to original TypeScript locations. The mapped location is stored in `source.file`, `source.line`, and `source.column`; the generated location is retained in `source.original`.

## Migration

Readers must check `version` before processing. Future versions should migrate older sessions into the current in-memory model before analysis. The current implementation rejects unsupported versions rather than guessing.
