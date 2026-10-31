# Guardian Install Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `guardian-mcp`, an npm package whose `guardian` CLI, MCP server, and Claude Code / Cursor hooks block or warn on malicious, nonexistent, too-new, typosquatted, or script-running npm packages before an AI agent installs them.

**Architecture:** One TypeScript ESM package. Pure core (`parse-command`, `policy`, `resolve`, `typosquat`, lockfile parsing) is tested with fixtures and no network. Thin `sources` fetch facts from OSV and the npm registry with a file cache and are injectable so tests use fixture servers. Three entry points (CLI, MCP stdio server, hook handlers) all call one `checkPackage()` function.

**Tech Stack:** Node 24, TypeScript, vitest, `@modelcontextprotocol/sdk`, `zod`, `semver`, `yaml`.

Spec: `docs/superpowers/specs/2026-10-31-guardian-install-gate-design.md`

---

## File structure

```
package.json, tsconfig.json, vitest.config.ts
src/core/types.ts           shared types
src/core/parse-command.ts   shell command -> PackageRef[]
src/core/typosquat.ts       distance check against bundled popular list
src/core/popular.ts         bundled list of popular npm names
src/core/osv-match.ts       does an OSV vuln affect a version? severity
src/core/policy.ts          evaluate(facts, policy) -> Verdict, loadPolicy()
src/core/resolve.ts         resolveVersion(spec), suggestSafeVersion()
src/core/lockfile.ts        package-lock / pnpm-lock / yarn.lock -> PackageRef[]
src/sources/cache.ts        file cache with TTL
src/sources/osv.ts          OSV client
src/sources/npm-registry.ts npm registry client
src/check.ts                checkPackage(ref, policy, sources); scanRefs()
src/format.ts               verdict -> text
src/hooks/run-gate.ts       command -> gate result (shared by hooks)
src/hooks/claude-code.ts    PreToolUse handler
src/hooks/cursor.ts         beforeShellExecution handler
src/install.ts              write hook config into Claude Code / Cursor settings
src/mcp.ts                  MCP server
src/cli.ts                  argument dispatch
test/*.test.ts, test/fixtures/
```

Contracts relied on:
- Claude Code PreToolUse hook: JSON on stdin `{tool_name, tool_input:{command}}`; exit 2 + stderr blocks and feeds stderr to the model; exit 0 allows.
- Cursor `beforeShellExecution` hook: JSON on stdin `{command}`; stdout JSON `{permission:'allow'|'deny', userMessage?, agentMessage?}`.
- OSV: `POST /v1/query {package:{name,ecosystem}}` returns all vulns for the package; `POST /v1/querybatch` returns ids per query; `GET /v1/vulns/{id}` details. No auth, no rate limit.
- npm registry: `GET https://registry.npmjs.org/<name>` full doc has `dist-tags`, `versions[v].scripts`, `time[v]`.

---

### Task 1: Scaffold + types
Files: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/core/types.ts`.
Types: `PackageRef{ecosystem,name,spec?}`, `Finding{rule,action,message,data?}`, `Verdict{ref,resolvedVersion,action,findings,safeVersion}`, `Policy{minAgeDays,strict,failClosed,allow,deny}` + `DEFAULT_POLICY`, `OsvVuln`, `VersionFacts{version,publishedAt,hasInstallScripts}`, `PackageFacts{ref,exists,versions,distTags,vulns,sourceErrors}`, `maxAction()`.
- [ ] write files, `npm install`, `npm run typecheck` clean, commit.

### Task 2: parse-command (TDD)
`parseInstallCommand(cmd): PackageRef[]` handles npm/pnpm/yarn/bun install|i|add, npx/pnpx/bunx, chained commands (`&&`, `;`, `|`), flags, scopes, `name@spec`, skips paths/urls/git. Exports `splitNameSpec`.
- [ ] failing test → impl → pass → commit.

### Task 3: typosquat (TDD)
`damerauLevenshtein`, `findTyposquatTarget(name)` against `POPULAR_NPM` set (bundled ~400 names). Max distance 1 for len<=6 else 2; ignore names shorter than 4; separator-only differences count (crossenv → cross-env); popular names themselves return null.
- [ ] failing test → impl → pass → commit.

### Task 4: osv-match (TDD)
`isMalware(v)` (id or alias `MAL-`), `vulnAffectsVersion(v,name,version)` (explicit versions, SEMVER/ECOSYSTEM ranges with introduced/fixed/last_affected, `introduced:'0'` = all), `vulnSeverity(v)` from `database_specific.severity` else CVSS vector heuristic.
- [ ] failing test → impl → pass → commit.

### Task 5: resolve (TDD)
`resolveVersion(spec, facts)` (undefined/latest/tag/exact/range), `ageDays`, `suggestSafeVersion(facts, minAgeDays, now)` = newest stable version with no malware, no CRITICAL/HIGH, age >= min.
- [ ] failing test → impl → pass → commit.

### Task 6: policy (TDD)
`matchesList(list,name,version)` (`name`, `name@range`, `@scope/*`), `evaluate(facts, policy, now)` implementing: source-unavailable (warn / deny if failClosed), denylist (deny), allowlist (allow, short-circuit), nonexistent (deny), unresolvable spec (deny), known-malicious (deny), critical-advisory (CRITICAL deny, HIGH warn), too-new (warn / deny if strict), typosquat (warn), install-scripts (warn). `loadPolicy(cwd)` reads `guardian.json` then `$GUARDIAN_HOME|~/.guardian/policy.json`.
- [ ] failing test → impl → pass → commit.

### Task 7: lockfile (TDD, fixtures)
`findLockfile(dir)`, `parseLockfile(path,text)` for package-lock v2/v3 (`packages` map; fallback `dependencies` tree), pnpm-lock (`packages` keys `name@version`, strip leading `/` and `(...)` peer suffix), yarn.lock v1 (block parse). Dedupe + sort.
- [ ] fixtures + failing test → impl → pass → commit.

### Task 8: cache + sources (fixture HTTP server test)
`FileCache(dir)` with `get/set/remember`, dir from `GUARDIAN_CACHE_DIR` | `$GUARDIAN_HOME/cache` | `~/.guardian/cache`. `OsvClient(baseUrl=GUARDIAN_OSV_URL)`: `queryPackage` (1h TTL), `getVuln` (24h), `queryBatch` (chunks of 1000, resolves details). `NpmRegistryClient(baseUrl=GUARDIAN_NPM_REGISTRY)`: `getPackage` → `{exists,distTags,versions}` (6h TTL, 404 cached 10m). 8s timeouts.
- [ ] failing test → impl → pass → commit.

### Task 9: check + format
`Sources` interface; `defaultSources()`; `gatherFacts(ref, sources)` (parallel, errors → `sourceErrors`, never throws); `checkPackage(ref, policy, sources)`; `scanRefs(refs, sources)` (OSV batch only, returns verdicts with findings). `formatVerdict/formatVerdicts` with `[guardian] OK|WARN|BLOCKED name@version`, per-finding lines, suggested safe version. `src/index.ts` re-exports.
- [ ] failing test → impl → pass → commit.

### Task 10: hooks
`runGate(command, policy, sources) → {action,text,verdicts}`; `readStdinJson()`. `claudeCodeHook(input, policy, sources) → {exitCode 0|2, stderr}` (Bash only). `cursorHook(input, policy, sources) → {permission,userMessage?,agentMessage?}`.
- [ ] failing test → impl → pass → commit.

### Task 11: install
`installClaudeCode(home)` merges `{matcher:'Bash', hooks:[{type:'command', command:'guardian hook claude-code', timeout:30}]}` into `~/.claude/settings.json` `hooks.PreToolUse`, idempotent, preserves other settings. `installCursor(home)` merges `{command:'guardian hook cursor'}` into `~/.cursor/hooks.json` `hooks.beforeShellExecution`, `version:1`.
- [ ] failing test → impl → pass → commit.

### Task 12: MCP server
`createServer()` with tools `check_package{name,version?}`, `scan_project{path?}`, `suggest_safe_version{name}`; descriptions instruct the agent to call `check_package` before any install. `serveStdio()`.
- [ ] impl, typecheck, commit.

### Task 13: CLI + e2e
`guardian check <pkg>[@spec]... [--json]` (exit 1 on deny), `guardian scan [dir] [--json]`, `guardian install claude-code|cursor`, `guardian hook claude-code|cursor`, `guardian mcp`. E2E test spawns `dist/cli.js` against a fixture server via env overrides, asserts exit codes and output for check and both hooks.
- [ ] failing test → impl → build → pass → full `npm test` → commit.

### Task 14: README + live smoke
README: what it is, install, MCP config for Claude Code and Cursor, policy file, detection limits (feed-based, no zero-days), exit codes. Live smoke: `check lodash` OK, `check this-package-does-not-exist-xyz` BLOCKED nonexistent, `scan .` OK.
- [ ] write, smoke, commit.

## Self-review
Spec coverage: gate (2-10, 13), MCP (12), all policy rules + lists + source-unavailable (6), cache TTLs (8), fail-open/closed (6, 9), lockfiles (7), install writer (11), README (14). Phase 2 excluded by design. Spec amended: popular list is bundled, not top-5000.
