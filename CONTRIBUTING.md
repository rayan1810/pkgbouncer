# Contributing to pkgbouncer

Thanks for helping. pkgbouncer is small on purpose, so most changes are easy to review. This page covers how to get set up, where things live, and what a good pull request looks like.

## Quick start

```bash
git clone https://github.com/rayan1810/pkgbouncer.git
cd pkgbouncer
npm install
npm run build
npm test
```

Requires Node 20 or newer. Tests run without network access. They use in-process fixture servers in place of OSV and the package registries.

Run the CLI from source with `node dist/cli.js check lodash` after `npm run build`. The CLI tests spawn `dist/cli.js`, so build before you run `npm test`.

## Where things live

| Path | What it does |
|---|---|
| `src/core/parse-command.ts` | Turns a shell command into the packages it would install |
| `src/core/policy.ts` | The rules that produce allow, warn, or deny, and policy file loading |
| `src/core/versions.ts`, `resolve.ts` | Version matching per ecosystem (semver and PEP 440) |
| `src/core/lockfile.ts` | Lockfile parsers used by `scan` and the post-install diff |
| `src/core/typosquat.ts`, `popular.ts` | Typosquat detection and the bundled popular-package lists |
| `src/sources/` | OSV client, registry clients (npm, PyPI, crates.io, Go), and the file cache |
| `src/hooks/` | Claude Code and Cursor hooks, the install gate, and the lockfile snapshot diff |
| `src/mcp.ts` | The MCP server tools |
| `src/cli.ts`, `src/install.ts` | The `pkgbouncer` command and the hook installer |
| `test/` | One test file per area, with shared stubs in `test/helpers/` |

## Ground rules

- **Write the test first.** Fix a bug by adding a failing test, then the fix. New rules and parsers need tests that cover both the blocked and the allowed case.
- **Never wedge the agent.** A hook must not crash an agent session. If pkgbouncer itself fails, it exits 0 and lets the command through. Keep it that way.
- **Fail open on missing data.** If OSV or a registry is unreachable, the result is a warning, not a false "package does not exist" denial. Strict behavior is opt-in through `failClosed`.
- **Minimize false positives.** Every needless block teaches people to disable the tool. A new deny rule needs a strong signal. Weaker signals should warn.
- **Keep it local and keyless.** No API keys, accounts, or telemetry. Network calls go only to OSV and the public registries, and only carry package names.

## Common contributions

**A new rule.** Add it to `evaluate` in `src/core/policy.ts`, add a row to the Rules table in the README, and test it in `test/policy.test.ts`.

**A new lockfile format.** Add a parser case to `src/core/lockfile.ts` with a small fixture in `test/lockfile.test.ts`.

**A new install command form.** Extend `src/core/parse-command.ts`. Include tests for the exact commands people type, including flags that take a value.

**A new agent integration.** Add a hook adapter under `src/hooks/` and an installer in `src/install.ts`. Please verify it against the real agent and say how in the pull request. The Cursor adapter is still unverified, and a confirmation or fix there would be very welcome.

**Updating the popular-package lists.** Edit `src/core/popular.ts`. Keep entries to genuinely popular packages, since every entry is a typosquat target.

## Pull requests

1. Open an issue first for anything larger than a small fix, so we can agree on the approach.
2. Branch from `main` and keep the change focused. One concern per pull request.
3. Run `npm run typecheck && npm run build && npm test` before you push. CI runs the same on Linux and Windows across Node 20, 22, and 24.
4. Use a clear commit message that says what changed and why.
5. Describe how you tested it. For hook changes, a real or fixture package you tried it against helps a lot.

## Reporting bugs and false positives

Open an issue with the command, the `[pkgbouncer]` output, and your versions. `pkgbouncer check --json <package>` gives us the full verdict. If a legitimate package was blocked, say so plainly. Those reports are the most valuable ones.

## Security issues

Do not open a public issue for a vulnerability in pkgbouncer itself. Follow [SECURITY.md](SECURITY.md).

## Conduct

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Contributions are released under the project's [MIT license](LICENSE).
