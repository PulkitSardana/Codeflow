# CodeFlow CLI

CodeFlow records real Node.js execution and opens a local interactive viewer for the resulting portable session.

```bash
codeflow init
codeflow record -- node examples/demo.js
codeflow open .codeflow/session.json
codeflow compare before.json after.json --threshold 20
```

See the repository README for architecture, privacy, and contribution details.
