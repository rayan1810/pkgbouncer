<img src="assets/icon.svg" width="64" height="64" alt="">

# pkgbouncer MCP

**An install gate for AI coding agents.** pkgbouncer sits between Claude Code (or any MCP-capable agent) and the package registries. Before a package is installed it checks the name and version against public malware and advisory feeds and blocks the install if the package is known-malicious, does not exist (hallucinated or slopsquatted), or looks like a typo of a popular package. It warns on releases younger than a few days, high-severity advisories, and install scripts. After an install it diffs the lockfile and flags anything risky that came in transitively. When it blocks, it tells the agent which version is safe so the agent can self-correct.

Covers **npm, PyPI, crates.io, and Go**.

Tools like Socket, Aikido Safe Chain, and Dependabot protect a human typing `npm install`. pkgbouncer protects the shell command an agent runs on your behalf.

## 30-second install

```bash
npm install -g pkgbouncer

# Claude Code: adds PreToolUse + PostToolUse hooks on Bash and PowerShell to ~/.claude/settings.json
pkgbouncer install claude-code
```

From then on, in every new Claude Code session:

- **Named installs are gated.** `npm i`, `pnpm add`, `yarn add`, `bun add`, `npx`, `pip install`, `uv add`, `poetry add`, `pipx install`, `cargo add`, `cargo install`, `go get`, `go install`. A blocked install returns the reason and a suggested safe version to the model.
- **Bare installs are gated.** On `npm install`, `npm ci`, `pnpm install`, `yarn`, or `bun install`, every package.json dependency the lockfile does not yet satisfy is checked first. This is the "agent edited package.json, then ran npm install" path.
- **Transitive hits are caught.** Before any install the lockfile is snapshotted. After it, only the newly added packages are scanned against OSV, and malware or critical advisories are reported back to the model with removal instructions. Works for all four ecosystems.

Example of what the agent sees:

```
[pkgbouncer] BLOCKED lodahs@0.0.1-security
  - (known-malicious) lodahs@0.0.1-security is a known malicious package (MAL-2025-25502: Malicious code in lodahs (npm)).
  - (typosquat) lodahs looks like a typo of the popular package "lodash". Confirm you meant lodahs.
  -> No safe version found; pick a different package.
Install blocked by pkgbouncer. Use the suggested safe version or a different package, then retry.
```

Cursor: `pkgbouncer install cursor` writes a `beforeShellExecution` hook following Cursor's documented format. It has not been verified against a live Cursor install yet.

## MCP server

The same checks are exposed as MCP tools so an agent can ask before it edits a manifest directly.

Claude Code:

```bash
claude mcp add pkgbouncer -- pkgbouncer mcp
```

Cursor (`~/.cursor/mcp.json` or `.cursor/mcp.json`):

```json
{ "mcpServers": { "pkgbouncer": { "command": "pkgbouncer", "args": ["mcp"] } } }
```

| Tool | Purpose |
|---|---|
| `check_package` | Allow / warn / deny for `name[@version]` in a given ecosystem, with reasons and a suggested safe version. The description tells the model to call it before any install. |
| `scan_project` | Scan every lockfile in a directory for known-malicious packages and critical advisories. |
| `suggest_safe_version` | Newest version with no malware, no critical advisory, and older than the policy minimum age. |

## CLI

```bash
pkgbouncer check lodash react@18 @types/node        # npm by default; exit 1 if any is blocked
pkgbouncer check pypi:requests==2.31.0 crates:serde@1 go:github.com/gin-gonic/gin@v1.9.1
pkgbouncer check --ecosystem PyPI requests numpy
pkgbouncer check --json axios                        # machine-readable verdicts
pkgbouncer scan ./my-project                         # all lockfiles in the dir, exit 1 on hits
```

Lockfiles understood: package-lock.json, npm-shrinkwrap.json, pnpm-lock.yaml, yarn.lock, bun.lock, uv.lock, poetry.lock, requirements.txt (pinned lines only), Cargo.lock, go.sum.

## Rules

| Rule | Signal | Default |
|---|---|---|
| `known-malicious` | OSV record with a `MAL-` id for this version | deny |
| `critical-advisory` | OSV / GitHub / PyPA / Go advisory for this version | CRITICAL deny, HIGH warn |
| `nonexistent` | Package or version not on the registry (hint if it resembles a popular name) | deny |
| `too-new` | Published less than `minAgeDays` ago | warn (deny with `strict`) |
| `typosquat` | Edit distance 1 or 2 from a bundled popular name (npm, PyPI, crates) | warn |
| `install-scripts` | npm version declares preinstall / install / postinstall | warn |
| `source-unavailable` | OSV or registry unreachable | warn (deny with `failClosed`) |

## Policy

Put `pkgbouncer.json` in the project root, or `~/.pkgbouncer/policy.json` for a user-wide default. All fields are optional.

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

Environment variables: `PKGBOUNCER_HOME` (default `~/.pkgbouncer`), `PKGBOUNCER_CACHE_DIR`, `PKGBOUNCER_OSV_URL`, `PKGBOUNCER_NPM_REGISTRY`, `PKGBOUNCER_PYPI_URL`, `PKGBOUNCER_CRATES_URL`, `PKGBOUNCER_GOPROXY_URL`.

## What it does and does not catch

pkgbouncer is feed-based. It catches what has been reported to [OSV.dev](https://osv.dev) (which ingests the OpenSSF malicious-packages list, the GitHub Advisory Database, PyPA advisories, RustSec, and the Go vulnerability database) and what registry metadata reveals. Most malicious packages are classified within three days of publication, and the `too-new` rule buys you that window. It does not analyze package code and will not catch a brand-new compromise before anyone reports it.

Transitive dependencies are judged after the install, from the lockfile diff, not before. A malicious transitive package will land on disk once and be reported immediately; the agent is told to remove it. Pair pkgbouncer with `--ignore-scripts` (npm 12 does this by default) for defense in depth.

Results are cached under `~/.pkgbouncer/cache` (advisories 1 hour, registry metadata 6 hours, misses 10 minutes). Lookups go to OSV and the registries only; nothing about your project leaves your machine except package names.

## Exit codes

| Command | 0 | 1 | 2 |
|---|---|---|---|
| `check`, `scan` | allow or warn | at least one deny | usage or no lockfile |
| `hook claude-code` | allow or warn | | deny (blocks in PreToolUse; reports to the model in PostToolUse) |
| `hook cursor` | always; verdict is in stdout JSON | | |

If pkgbouncer itself crashes inside a hook it exits 0 so the agent is never wedged by the gate.

## Development

```bash
npm install
npm test          # vitest, no network needed
npm run build
node dist/cli.js check lodash
```

Design and plans: `docs/superpowers/specs/` and `docs/superpowers/plans/`.
