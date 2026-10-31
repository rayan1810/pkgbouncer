<img src="assets/icon.svg" width="64" height="64" alt="">

# Guardian MCP

**An install gate for AI coding agents.** Guardian sits between Claude Code, Cursor, or any MCP-capable agent and the npm registry. Before a package is installed it checks the name and version against public malware and advisory feeds and blocks the install if the package is known-malicious, does not exist (hallucinated or slopsquatted), or looks like a typo of a popular package. It warns on releases younger than a few days, high-severity advisories, and install scripts. When it blocks, it tells the agent which version is safe so the agent can self-correct.

Tools like Socket, Aikido Safe Chain, and Dependabot protect a human typing `npm install`. Guardian protects the Bash tool call an agent makes on your behalf.

## 30-second install

```bash
npm install -g guardian-mcp

# Claude Code: adds a PreToolUse hook on Bash to ~/.claude/settings.json
guardian install claude-code

# Cursor: adds a beforeShellExecution hook to ~/.cursor/hooks.json
guardian install cursor
```

From then on, any `npm install`, `npm i`, `pnpm add`, `yarn add`, `bun add`, or `npx <pkg>` the agent runs is gated. A blocked install returns the reason and a suggested safe version to the model.

Example of what the agent sees:

```
[guardian] BLOCKED lodahs@0.0.1-security
  - (known-malicious) lodahs@0.0.1-security is a known malicious package (MAL-2025-25502: Malicious code in lodahs (npm)).
  - (typosquat) lodahs looks like a typo of the popular package "lodash". Confirm you meant lodahs.
  -> No safe version found; pick a different package.
Install blocked by Guardian. Use the suggested safe version or a different package, then retry.
```

## MCP server

The same checks are exposed as MCP tools so an agent can ask before it edits `package.json` directly.

Claude Code:

```bash
claude mcp add guardian -- guardian mcp
```

Cursor (`~/.cursor/mcp.json` or `.cursor/mcp.json`):

```json
{ "mcpServers": { "guardian": { "command": "guardian", "args": ["mcp"] } } }
```

Tools:

| Tool | Purpose |
|---|---|
| `check_package` | Allow / warn / deny for `name[@version]` with reasons and a suggested safe version. Tool description tells the model to call it before any install. |
| `scan_project` | Scan `package-lock.json`, `pnpm-lock.yaml`, or `yarn.lock` for known-malicious packages and critical advisories. |
| `suggest_safe_version` | Newest version with no malware, no critical advisory, and older than the policy minimum age. |

## CLI

```bash
guardian check lodash react@18 @types/node     # exit 1 if any is blocked
guardian check --json axios                     # machine-readable verdicts
guardian scan ./my-project                      # lockfile scan, exit 1 on hits
```

## Rules

| Rule | Signal | Default |
|---|---|---|
| `known-malicious` | OSV record with a `MAL-` id for this version | deny |
| `critical-advisory` | OSV / GitHub advisory for this version | CRITICAL deny, HIGH warn |
| `nonexistent` | Package or version not on the registry | deny |
| `too-new` | Published less than `minAgeDays` ago | warn (deny with `strict`) |
| `typosquat` | Edit distance 1 or 2 from a bundled popular name | warn |
| `install-scripts` | Version declares preinstall / install / postinstall | warn |
| `source-unavailable` | OSV or registry unreachable | warn (deny with `failClosed`) |

## Policy

Put `guardian.json` in the project root, or `~/.guardian/policy.json` for a user-wide default. All fields are optional.

```json
{
  "minAgeDays": 3,
  "strict": false,
  "failClosed": false,
  "allow": ["@mycompany/*", "internal-tool"],
  "deny": ["event-stream@<4", "colors@>1.4.0"]
}
```

- `allow` entries short-circuit every rule. `deny` entries always block.
- Entries are `name`, `name@semver-range`, or `@scope/*`.

Environment variables: `GUARDIAN_HOME` (default `~/.guardian`), `GUARDIAN_CACHE_DIR`, `GUARDIAN_OSV_URL`, `GUARDIAN_NPM_REGISTRY`.

## What it does and does not catch

Guardian is feed-based. It catches what has been reported to [OSV.dev](https://osv.dev) (which ingests the OpenSSF malicious-packages list and the GitHub Advisory Database) and what the npm registry metadata reveals. Most malicious packages are classified within three days of publication, and the `too-new` rule buys you that window. It does not analyze package code and will not catch a brand-new compromise before anyone reports it. Pair it with `--ignore-scripts` and a short lockfile review for defense in depth.

Results are cached under `~/.guardian/cache` (advisories 1 hour, registry metadata 6 hours, misses 10 minutes). Lookups are to OSV and the npm registry only; nothing about your project leaves your machine.

## Exit codes

| Command | 0 | 1 | 2 |
|---|---|---|---|
| `check`, `scan` | allow or warn | at least one deny | usage or no lockfile |
| `hook claude-code` | allow or warn | | deny (Claude Code's block code) |
| `hook cursor` | always; verdict is in stdout JSON | | |

## Development

```bash
npm install
npm test          # vitest, no network needed
npm run build
node dist/cli.js check lodash
```

Design and plan: `docs/superpowers/specs/` and `docs/superpowers/plans/`.
