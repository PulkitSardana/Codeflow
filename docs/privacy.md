# Privacy Model

CodeFlow is local-first. Recorded sessions are written to local JSON files and are not uploaded by the tool.

## Captured By Default

- Process start/end metadata.
- Explicit `trace()` function spans.
- Timing information.
- HTTP method, redacted URL, status, and duration.
- Console event level and sanitized values.
- Error type, message, stack, and source location.
- File read/write paths inside the project root.
- Source snapshots for referenced project files, subject to size limits.

## Not Captured By Default

- Passwords.
- Cookies.
- Authorization headers.
- Request bodies.
- Response bodies.
- Files outside the project root.
- `node_modules`, `.git`, `.codeflow`, and build output contents.
- Sensitive source files such as `.env`, credentials files, private-key files, and package-manager credential files.
- Absolute project paths in session metadata and source snapshots.

## Opt-In Body Capture

Fetch request and response body previews can be enabled explicitly:

```bash
codeflow record --capture-bodies --max-body-bytes 4096 -- node examples/demo.js
```

When enabled, CodeFlow records previews only, not unbounded streams. Previews are truncated to the configured byte limit and passed through the same secret-key redaction used for metadata. JSON and URL-encoded forms are parsed before redaction when possible; other text is stored as sanitized text. Node HTTP and browser network capture still record metadata only.

## Redaction

CodeFlow redacts obvious secret keys and common token formats in URLs, headers, command arguments, metadata, errors, console output, opt-in body previews, and saved source snapshots. This includes authorization headers, cookies, passwords, secrets, API keys, access tokens, refresh tokens, ID tokens, JWTs, and credentials.

Redaction is a safety layer, not a proof. Treat session files as development artifacts and review them before sharing outside your team.
