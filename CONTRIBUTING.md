# Contributing

Thanks for helping build CodeFlow.

## Development

```bash
npm install
npm run build
npm test
```

Run the local-recording integration test:

```bash
CODEFLOW_RUN_NETWORK_TESTS=1 npm test
```

## Commit Style

Use conventional commits where practical:

- `feat: add session exporter`
- `fix: preserve source location on errors`
- `docs: update privacy model`
- `test: cover regression thresholds`

## Pull Requests

Keep changes focused, include tests for behavior changes, and update docs when CLI behavior or session format changes.
