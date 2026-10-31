# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-31

First public release.

### Added

- Install gate for AI coding agents: a Claude Code `PreToolUse` and `PostToolUse` hook on the Bash and PowerShell tools, installed with `pkgbouncer install claude-code`
- Named-install checks for npm, pnpm, yarn, bun, npx, pip, uv, poetry, pipx, cargo, and go commands
- Bare-install checks: dependencies in `package.json` that the lockfile does not yet satisfy are checked before `npm install`, `npm ci`, and equivalents
- Post-install lockfile diff that reports malware and critical advisories in newly added transitive dependencies
- Ecosystems: npm, PyPI, crates.io, and Go
- Rules: known-malicious, critical-advisory, nonexistent (slopsquatting), too-new, typosquat, install-scripts, and source-unavailable
- Safe-version suggestions returned to the agent when a package is blocked
- MCP server with `check_package`, `scan_project`, and `suggest_safe_version`
- CLI: `check`, `scan`, `install`, `hook`, and `mcp`
- Lockfile support: package-lock.json, npm-shrinkwrap.json, pnpm-lock.yaml, yarn.lock, bun.lock, uv.lock, poetry.lock, requirements.txt, Cargo.lock, and go.sum
- Project and user policy files with allow and deny lists, `minAgeDays`, `strict`, and `failClosed`
- Cursor `beforeShellExecution` hook (written to Cursor's documented format; not yet verified against a live Cursor install)

[0.1.0]: https://github.com/rayan1810/pkgbouncer/releases/tag/v0.1.0
