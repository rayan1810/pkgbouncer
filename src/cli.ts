#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkPackage, scanRefs } from './check.js';
import { loadPolicy } from './core/policy.js';
import { splitNameSpec } from './core/parse-command.js';
import { findLockfile, parseLockfile } from './core/lockfile.js';
import { formatVerdicts } from './format.js';
import { claudeCodeHook, type ClaudeHookInput } from './hooks/claude-code.js';
import { cursorHook, type CursorHookInput } from './hooks/cursor.js';
import { readStdinJson } from './hooks/run-gate.js';
import { installClaudeCode, installCursor } from './install.js';

const USAGE = `guardian - agent-native dependency install gate

  guardian check <pkg>[@version]...    check packages (exit 1 if any is blocked)
  guardian scan [dir]                  scan lockfile for known-malicious / critical advisories
  guardian install claude-code|cursor  add the pre-install hook to the agent's settings
  guardian hook claude-code|cursor     (used by the hook) read the tool call on stdin and gate it
  guardian mcp                         run the MCP server on stdio
  --json                               machine-readable output for check/scan

Policy: guardian.json in the project root, else $GUARDIAN_HOME/policy.json (~/.guardian/policy.json).
`;

async function main(argv: string[]): Promise<number> {
  const json = argv.includes('--json');
  const [cmd, ...rest] = argv.filter((a) => a !== '--json');
  const policy = loadPolicy();

  switch (cmd) {
    case 'check': {
      if (rest.length === 0) {
        console.error(USAGE);
        return 2;
      }
      const verdicts = await Promise.all(
        rest.map((t) => {
          const { name, spec } = splitNameSpec(t);
          return checkPackage({ ecosystem: 'npm', name, spec }, policy);
        }),
      );
      console.log(json ? JSON.stringify(verdicts, null, 2) : formatVerdicts(verdicts));
      return verdicts.some((v) => v.action === 'deny') ? 1 : 0;
    }
    case 'scan': {
      const dir = resolve(rest[0] ?? '.');
      const lock = findLockfile(dir);
      if (!lock) {
        console.error(`No lockfile found in ${dir}`);
        return 2;
      }
      const refs = parseLockfile(lock, readFileSync(lock, 'utf8'));
      const hits = await scanRefs(refs);
      if (json) console.log(JSON.stringify({ lockfile: lock, scanned: refs.length, hits }, null, 2));
      else console.log(hits.length ? formatVerdicts(hits) : `[guardian] OK ${refs.length} packages scanned (${lock}), no known-malicious or critical advisories.`);
      return hits.some((h) => h.action === 'deny') ? 1 : 0;
    }
    case 'install': {
      if (rest[0] === 'claude-code') {
        console.log(`Guardian hook added to ${installClaudeCode()}. New Claude Code sessions will gate package installs.`);
        return 0;
      }
      if (rest[0] === 'cursor') {
        console.log(`Guardian hook added to ${installCursor()}. Restart Cursor to activate.`);
        return 0;
      }
      console.error(USAGE);
      return 2;
    }
    case 'hook': {
      if (rest[0] === 'claude-code') {
        const input = await readStdinJson<ClaudeHookInput>();
        if (!input) return 0;
        const r = await claudeCodeHook(input, policy);
        if (r.stderr) process.stderr.write(r.stderr + '\n');
        return r.exitCode;
      }
      if (rest[0] === 'cursor') {
        const input = await readStdinJson<CursorHookInput>();
        process.stdout.write(JSON.stringify(await cursorHook(input ?? {}, policy)) + '\n');
        return 0;
      }
      console.error(USAGE);
      return 2;
    }
    case 'mcp': {
      const { serveStdio } = await import('./mcp.js');
      await serveStdio();
      return -1; // keep the process alive for the transport
    }
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(USAGE);
      return 0;
    default:
      console.error(`Unknown command: ${cmd}\n\n${USAGE}`);
      return 2;
  }
}

/** Set the exit code and let the event loop drain; a hard exit mid-socket trips a libuv assertion on Windows. */
function finish(code: number): void {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 2000).unref();
}

main(process.argv.slice(2))
  .then((code) => {
    if (code >= 0) finish(code);
  })
  .catch((e: Error) => {
    // Hooks must never block an agent because Guardian itself crashed; fail open loudly.
    console.error(`[guardian] error: ${e.message}`);
    finish(process.argv[2] === 'hook' ? 0 : 2);
  });
