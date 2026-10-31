# Security policy

pkgbouncer sits in the path of commands that AI agents run, so its own security matters. Thank you for reporting problems responsibly.

## Reporting a vulnerability

Please use GitHub's private reporting: **Security tab, then "Report a vulnerability"** on [this repository](https://github.com/rayan1810/pkgbouncer/security/advisories/new). Do not open a public issue.

If you cannot use GitHub, email rohit@tria.so with "pkgbouncer security" in the subject.

Include what you found, how to reproduce it, and the version (`npm ls -g pkgbouncer`). You will get an acknowledgement within a few days. Fixes for confirmed issues are released as soon as they are ready, and you will be credited unless you prefer otherwise.

## What counts

Examples of in-scope issues:

- A way to make the install gate allow a package it should block, other than the documented limits below
- A command crafted to slip past command parsing while still installing a package
- Anything that makes pkgbouncer execute untrusted code, write outside its own directories, or leak data beyond package names
- A crash or hang in a hook that wedges the agent session

## Known limits, not vulnerabilities

These are documented and expected:

- pkgbouncer is feed-based. It catches what OSV.dev and registry metadata already know, and it does not analyze package code. A brand-new compromise that nobody has reported yet will not be caught.
- Transitive dependencies are checked after the install from the lockfile diff, not before it.
- If OSV or a registry is unreachable, pkgbouncer warns and lets the install proceed unless `failClosed` is set.
- If pkgbouncer itself crashes inside a hook, it exits 0 so the agent is not blocked.
- Only the Claude Code hook is verified live. The Cursor hook follows Cursor's documented format and is unverified.

## Supported versions

Only the latest released version receives fixes.

## Data handling

pkgbouncer sends package names and versions to OSV.dev and the public package registries to look them up. It sends nothing else and has no telemetry. Results are cached locally under `~/.pkgbouncer/cache`.
