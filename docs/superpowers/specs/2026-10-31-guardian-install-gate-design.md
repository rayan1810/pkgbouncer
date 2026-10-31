# Guardian MCP: agent-native dependency install gate — design

Date: 2026-10-31
Status: approved direction (Rohit, 2026-10-31); phase 1 scoped here

## Problem

AI coding agents (Claude Code, Cursor, Codex, CI agents) add and install packages
without a human reviewing the name or version. Existing tools (Socket `sfw`,
Aikido Safe Chain, Dependabot malware alerts, GitHub Package Firewall) protect
humans typing `npm install` or enterprise registries, not the agent's tool call.
A compromised or hallucinated package added by an agent lands in the lockfile
unchallenged.

## Goal

A single install that puts a policy check in front of every dependency change an
agent makes, across every agent, and tells the agent why a package was denied so
it self-corrects. Everything else (hosted watcher, alerts, fix PRs) is phase 2
and builds on the same core.

## Non-goals (phase 1)

- Own malware analysis. We consume public feeds only.
- Hosted service, accounts, billing, dashboard.
- Alerts to Slack/email, auto fix PRs. (Phase 2.)
- Ecosystems other than npm. Core is ecosystem-agnostic; only the npm adapter ships.

## Architecture

One TypeScript package, `guardian-mcp`, publishing three entry points over one
core library:

```
src/
  core/
    types.ts          Verdict, Finding, Policy, PackageRef
    policy.ts         evaluate(ref, facts, policy) -> Verdict  (pure)
    resolve.ts        suggestSafeVersion(ref, facts) -> version | null (pure)
    typosquat.ts      distance to popular-package list (pure)
    parse-command.ts  extract PackageRefs from install command strings (pure)
  sources/
    osv.ts            OSV querybatch client (MAL-*, GHSA-*), cached
    npm-registry.ts   package metadata: exists, versions, publish times, maintainers
    popular.ts        bundled top-N npm names list
  adapters/
    npm-lockfile.ts   package-lock / pnpm-lock / yarn.lock -> PackageRef[]
  cli.ts              guardian check | scan | hook | mcp
  mcp.ts              MCP server: check_package, scan_project, suggest_safe_version
  hooks/
    claude-code.ts    PreToolUse handler: reads tool input JSON on stdin, exits 2 to block
```

Data flow for the gate: agent emits a Bash tool call -> hook receives
`{tool_name, tool_input}` on stdin -> `parse-command` extracts package refs
(`npm i foo@1.2.3`, `pnpm add`, `yarn add`, `npx foo`) -> `sources` fetch facts
(parallel, cached in `~/.guardian/cache` with TTL) -> `policy.evaluate` -> on
`deny` print reasons to stderr and exit 2 (Claude Code blocks and shows reason to
the model); on `warn` print to stderr and exit 0; on `allow` exit 0.

MCP server exposes the same checks as tools, so an agent can ask before editing
package.json directly. Tool descriptions instruct the agent to call
`check_package` before adding any dependency.

## Policy rules (phase 1, all deterministic)

| Rule | Facts | Default action |
|---|---|---|
| known-malicious | OSV record with id prefix `MAL-` for name@version | deny |
| critical-advisory | OSV GHSA with severity CRITICAL/HIGH for name@version | deny (HIGH -> warn) |
| nonexistent | npm registry 404 | deny (hallucination/slopsquat signal) |
| too-new | version published < `minAgeDays` (default 3) ago | warn (deny if `strict`) |
| typosquat | Levenshtein/Damerau distance <= 2 to a bundled popular-name list and not itself popular | warn |
| install-scripts | version has preinstall/install/postinstall | warn |

Policy is read from `guardian.json` at repo root, else `~/.guardian/policy.json`,
else defaults. Allowlist/denylist by name or `name@range`.

Verdict: `{ action: 'allow'|'warn'|'deny', findings: Finding[], safeVersion?: string }`.
`safeVersion` = highest version with no deny-level finding and age >= minAgeDays.

## Error handling

- Network failure to OSV or registry: fail open with a `warn` finding
  `source-unavailable` unless policy `failClosed: true`. Never silently allow.
- Unparseable command: exit 0, no output (not our concern).
- Cache: JSON files keyed by `name@version`, TTL 1h for OSV, 6h for registry
  metadata, nonexistent results TTL 10m.

## Testing

- Pure modules (`policy`, `resolve`, `typosquat`, `parse-command`,
  `npm-lockfile`) get unit tests with fixtures, TDD, vitest.
- Sources get tests against recorded fixtures (no live network in CI).
- One end-to-end test runs the hook binary with a fake PreToolUse payload and
  asserts exit code and stderr, with sources stubbed via env var pointing at a
  local fixture server.
- Live smoke test (manual): `guardian check safe-chain-test` style known-bad
  package; `guardian check lodash` allows.

## Distribution

- `npm i -g guardian-mcp` gives `guardian` CLI.
- `guardian install claude-code` writes the PreToolUse hook into
  `~/.claude/settings.json` (merging, idempotent). `guardian install cursor`
  writes the equivalent for Cursor hooks. Codex adapter later.
- MCP: `guardian mcp` on stdio; documented `claude mcp add` / Cursor config snippet.

## Phase 2 (not in this spec's plan)

Hosted watcher (lockfile SBOM upload, OSV polling, diff), Slack/email/webhook
alerts, GitHub App that opens downgrade/override PRs, policy dashboard, billing
(Free / Pro $12 / Team $29 per dev per month).
