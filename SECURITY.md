# Security Policy

## Reporting a Vulnerability

Please do not open public issues for suspected vulnerabilities. Use [private vulnerability reporting](https://github.com/PulkitSardana/Codeflow/security/advisories/new) so maintainers can investigate and coordinate a fix before disclosure.

Include a clear impact statement, reproduction steps, affected versions or commits, and any relevant proof of concept. Do not include credentials, customer data, or production session files in a report.

## Supported Versions

Security fixes are applied to the latest `0.1.x` release and the `main` branch.

## Security Boundaries

CodeFlow is local-first. It does not upload sessions, and it redacts common secret forms before persisting metadata, errors, HTTP details, command arguments, and source snapshots. Sensitive configuration and private-key files are excluded from source capture.

Redaction is defense in depth, not a guarantee. Session files can still reveal application structure, sanitized paths, timing, and source context. Treat them as development artifacts and review them before sharing.
