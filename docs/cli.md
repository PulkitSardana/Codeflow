# CLI Reference

## `codeflow init`

Creates `.codeflow/config.yaml` and makes sure `.codeflow/` is ignored by Git.

## `codeflow record`

```bash
codeflow record --output .codeflow/session.json -- node examples/demo.js
```

Runs the command with the CodeFlow recorder preloaded through `NODE_OPTIONS`. The child process writes a portable session when it exits.

Fetch request/response body previews are off by default. Enable bounded, redacted previews explicitly:

```bash
codeflow record --capture-bodies --max-body-bytes 4096 -- node examples/demo.js
```

## `codeflow open`

```bash
codeflow open .codeflow/session.json
```

Starts a local static viewer server and opens the session. Use `--no-open` in CI or terminal-only environments.

Open an interactive comparison:

```bash
codeflow open .codeflow/after.json --compare .codeflow/before.json --threshold 20
```

The comparison view shows observed total runtime changes, function timing deltas, HTTP timing deltas, database-query timing/count deltas, and threshold failures. Selecting a difference focuses the matching recorded item when available.

## `codeflow inspect`

Prints a terminal summary with counts, top contributors, and call tree.

## `codeflow compare`

```bash
codeflow compare before.json after.json --threshold 20
```

Compares total runtime, function timings, call counts, HTTP timings, database-query counts, errors, and execution roots. Exits non-zero when configured thresholds fail.

## `codeflow report`

```bash
codeflow report session.json --format markdown --output report.md
codeflow report session.json --format html --output report.html
```

Supports `json`, `markdown`, and `html`.

## `codeflow validate`

Validates the session format.

## `codeflow record-browser`

```bash
codeflow record-browser http://127.0.0.1:3000 --output .codeflow/browser.json
```

Uses the optional Playwright integration when Playwright is installed.

Useful options:

- `--timeout-ms 30000` sets the page navigation timeout.
- `--settle-ms 500` waits briefly after load so immediate client-side activity is captured.
- `--headed` opens a visible browser for local debugging.
