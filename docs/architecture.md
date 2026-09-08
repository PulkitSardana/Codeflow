# Architecture

CodeFlow is a local-first monorepo. The first implementation targets Node.js and TypeScript, with integration seams for later Python, Go, Java, and browser expansion.

```mermaid
flowchart LR
  CLI[codeflow CLI] --> Recorder[@codeflow/recorder]
  Recorder --> Core[@codeflow/core trace API]
  Recorder --> NodeIntegration[Node integration]
  NodeIntegration --> Fetch[fetch/http/console/fs patches]
  Recorder --> Session[@codeflow/session JSON]
  Session --> Analyzer[@codeflow/analyzer]
  Analyzer --> Viewer[Local viewer]
  Analyzer --> Exporters[@codeflow/exporters]
  Playwright[Playwright integration] --> Session
```

## Package Responsibilities

- `@codeflow/session`: versioned JSON schema, validation, serialization, redaction, file hashing.
- `@codeflow/parser`: stack parsing, source-location extraction, and TypeScript source-map resolution.
- `@codeflow/core`: public `trace()` API and runtime bridge.
- `@codeflow/instrumentation`: generic instrumentation patches.
- `@codeflow/integration-node`: Node-specific automatic capture for HTTP, fetch, console, selected file operations, Express, and Fastify.
- `@codeflow/recorder`: session lifecycle, event/call/error/HTTP assembly, source snapshots, flush.
- `@codeflow/analyzer`: call tree, timing summaries, regression comparison.
- `@codeflow/exporters`: JSON, Markdown, and HTML reports.
- `codeflow`: CLI commands.
- `apps/viewer`: local React viewer.
- `@codeflow/integration-playwright`: optional browser recording through Playwright.

## Design Boundaries

CodeFlow does not claim instruction-level tracing. Reliable function spans come from explicit `trace()` calls. Automatic instrumentation captures stable runtime surfaces and attaches them to the active span when possible.

Express and Fastify instrumentation wraps route handlers when those framework modules are imported or required after the recorder preload. It records route-level spans such as `Express GET /checkout/:id` and `Fastify GET /checkout/:id`.
