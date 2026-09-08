# CodeFlow Demo

This app exercises the initial CodeFlow recorder with login, product search, cart, checkout, database-like operations, caught errors, and local HTTP calls.

Run it through the CLI:

```bash
codeflow record --output .codeflow/demo-session.json -- node examples/demo.js
```

Record a slower execution for comparison:

```bash
CODEFLOW_DEMO_REGRESSION=1 codeflow record --output .codeflow/after.json -- node examples/demo.js
```
