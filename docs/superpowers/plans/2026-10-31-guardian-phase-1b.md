# Guardian Phase 1b: everyday-use gaps

Date: 2026-10-31. Approved by Rohit: close gaps 1, 2, 3, 5, 6 from the readiness review; skip Cursor verification (4).

**Goal:** Make the gate safe for daily use in Claude Code: bare installs are gated, transitive hits are caught at install time, four ecosystems are covered, the binary is globally installed, and the hook is proven in a live session.

## Tasks

1. **Multi-ecosystem core.** `Ecosystem = 'npm' | 'PyPI' | 'crates.io' | 'Go'`. New `core/versions.ts` with per-ecosystem compare/satisfies (semver for npm/crates/Go, PEP 440-lite for PyPI). `osv-match`, `resolve`, `policy` take the ecosystem from the ref. Per-ecosystem popular lists for typosquat (npm, PyPI, crates). Install-scripts rule stays npm-only.
2. **Command parsing.** pip/pip3/python -m pip install, uv add, uv pip install, poetry add, pipx install, cargo add/install, go get/install. Bare-install detection: npm install/ci, pnpm install, yarn [install], bun install, pip install -r, uv sync, poetry install, cargo build/fetch, go mod download/tidy. Leading `cd <dir> &&` sets the project dir.
3. **Registry clients.** One `RegistryClient` facade: npm (existing), PyPI JSON API, crates.io API (User-Agent required), Go module proxy (`@v/list`, `@latest`, `@v/<v>.info` for the resolved version only).
4. **Lockfiles.** Add requirements.txt, uv.lock, poetry.lock, Cargo.lock, go.sum. `findLockfiles(dir)` returns all present; scan unions them. OSV batch carries ecosystem per ref.
5. **Bare install pre-check.** On a bare npm/pnpm/yarn/bun install, read package.json declared deps, find ones the lockfile does not already satisfy, and check those (this is the "agent edited package.json then ran npm install" path). Always snapshot current lockfile refs to `$GUARDIAN_HOME/snapshots/<sha1(dir)>.json` before any install.
6. **Post-install transitive check.** Claude Code PostToolUse on Bash: if the command was an install, diff current lockfile refs against the snapshot, OSV-batch the new refs, exit 2 with removal instructions on malware/critical. `guardian install claude-code` registers the same command under PreToolUse and PostToolUse; the handler branches on `hook_event_name`.
7. **Global install and live proof.** `npm install -g .`, `guardian install claude-code`, then `claude -p` in a scratch project runs `npm i lodahs` and must report the block; `npm i lodash` must pass; a post-install diff on a real install must run clean.

Tests: extend existing suites; new fixtures for each lockfile; stub registry per ecosystem; hook tests for bare install and post-install diff.
