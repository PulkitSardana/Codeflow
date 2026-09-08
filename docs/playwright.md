# Playwright Integration

Browser recording is optional. Install Playwright in the consuming project:

```bash
npm install -D playwright
```

Record an already running site:

```bash
codeflow record-browser http://127.0.0.1:3000 --output .codeflow/browser.json
```

Or let CodeFlow start a command and wait for a URL:

```bash
codeflow browser --url http://127.0.0.1:3000 -- npm run dev
```

The integration captures navigation, clicks, keydown events, network requests/responses, browser console messages, and page errors. Printable keys are recorded as `[character]`, and input values are not captured.

Useful options:

- `--timeout-ms 30000` controls the page navigation timeout.
- `--settle-ms 500` captures immediate client-side events after load.
- `--headed` opens a visible browser for debugging.

It does not replace Playwright traces and does not claim full browser execution tracing.
