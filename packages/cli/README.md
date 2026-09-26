# CodeFlow

Record real Node.js executions, inspect the observed runtime path, and compare sessions to catch performance regressions locally.

## Install

```bash
npm install --global @codeflow/cli
codeflow init
```

## Quick Start

```bash
codeflow record -- node examples/demo.js
codeflow open .codeflow/session.json
codeflow compare before.json after.json --threshold 20
```

CodeFlow keeps session data local by default and does not capture request or response bodies unless explicitly enabled.

For the viewer, full CLI reference, privacy model, source code, and contribution guide, visit [github.com/PulkitSardana/Codeflow](https://github.com/PulkitSardana/Codeflow).
