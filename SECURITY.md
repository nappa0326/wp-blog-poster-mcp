# Security Policy

## Supported Versions

Only the latest minor release on the `main` branch receives security fixes.

| Version | Supported |
|---------|-----------|
| 0.2.x   | ✅        |
| < 0.2   | ❌        |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security reports.

Use **[GitHub Security Advisories](../../security/advisories/new)** to report
privately. You can expect:

- An acknowledgement within 7 days.
- A fix or mitigation plan within 30 days for confirmed issues.
- A CVE assignment will be requested if the issue is remotely exploitable.

## Scope

This project ships an MCP server that authenticates to a WordPress REST API
with Application Password (Basic auth over HTTPS). In-scope concerns include:

- Credential leakage through logs or error messages
- Request forgery against the configured WordPress site
- Input validation bypasses that could submit unintended payloads
- Dependency vulnerabilities in the packages pinned in `package.json`

Out of scope:

- Misconfiguration on the user's own WordPress site (plugin / theme / server)
- Attacks that require the attacker to already control the user's machine
