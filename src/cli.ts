#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkPackage, scanRefs } from './check.js';
import { loadPolicy } from './core/policy.js';
import { normalizePyPiName, splitNameSpec } from './core/parse-command.js';
import { dedupeRefs, findLockfiles, parseLockfile } from './core/lockfile.js';
import { ECOSYSTEMS, type Ecosystem, type PackageRef } from './core/types.js';
import { formatVerdicts } from './format.js';
import { claudeCodeHook, type ClaudeHookInput } from './hooks/claude-code.js';
import { cursorHook, type CursorHookInput } from './hooks/cursor.js';
import { readStdinJson } from './hooks/run-gate.js';
import { installClaudeCode, installCursor } from './install.js';

const USAGE = `guardian - agent-native dependency install gate

  guardian check <pkg>[@version]...    check packages (exit 1 if any is blocked)
      prefixes: npm: (default) pypi: crates: go:    e.g. guardian check pypi:requests crates:serde@1
      or --ecosystem npm|PyPI|crates.io|Go for all args
  guardian scan [dir]                  scan every lockfile in dir for known-malicious / critical advisories
  guardian install claude-code|cursor  add the pre/post-install hooks to the agent's settings
  guardian hook claude-code|cursor     (used by the hook) read the tool call on stdin and gate it
  guardian mcp                         run the MCP server on stdio
  --json                               machine-readable output for check/scan

Policy: guardian.json in the project root, else $GUARDIAN_HOME/policy.json (~/.guardian/policy.json).
`;

const PREFIX: Record<string, Ecosystem> = { npm: 'npm', pypi: 'PyPI', pip: 'PyPI', crates: 'crates.io', cargo: 'crates.io', go: 'Go' };

/** `pypi:requests==2.31`, `crates:serde@1`, `go:github.com/x/y@v1`, or plain npm. */
export function parseCheckArg(arg: string, defaultEco: Ecosystem): PackageRef {
  let eco = defaultEco;
  let rest = arg;
  const m = /^([a-z]+):(.+)$/i.exec(arg);
  if (m && PREFIX[m[1].toLowerCase()]) {
    eco = PREFIX[m[1].toLowerCase()];
    rest = m[2];
  }
  if (eco === 'PyPI') {
    const pm = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(.*)$/.exec(rest);
    return { ecosystem: eco, name: normalizePyPiName(pm?.[1] ?? rest), spec: pm?.[2] || undefined };
  }
  const { name, spec } = splitNameSpec(rest);
  return { ecosystem: eco, name, spec };
}

function readLockfiles(dir: string): { files: string[]; refs: PackageRef[] } {
  const files = findLockfiles(dir);
  const refs = dedupeRefs(files.flatMap((f) => parseLockfile(f, readFileSync(f, 'utf8'))));
  return { files, refs };
}

async function main(argv: string[]): Promise<number> {
  const json = argv.includes('--json');
  let defaultEco: Ecosystem = 'npm';
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') continue;
    if (argv[i] === '--ecosystem' || argv[i] === '-e') {
      const v = argv[++i];
      const eco = ECOSYSTEMS.find((e) => e.toLowerCase() === (v ?? '').toLowerCase()) ?? PREFIX[(v ?? '').toLowerCase()];
      if (!eco) {
        console.error(`Unknown ecosystem: ${v}. Use one of ${ECOSYSTEMS.join(', ')}.`);
        return 2;
      }
      defaultEco = eco;
      continue;
    }
    args.push(argv[i]);
  }
  const [cmd, ...rest] = args;
  const policy = loadPolicy();

  switch (cmd) {
    case 'check': {
      if (rest.length === 0) {
        console.error(USAGE);
        return 2;
      }
      const verdicts = await Promise.all(rest.map((t) => checkPackage(parseCheckArg(t, defaultEco), policy)));
      console.log(json ? JSON.stringify(verdicts, null, 2) : formatVerdicts(verdicts));
      return verdicts.some((v) => v.action === 'deny') ? 1 : 0;
    }
    case 'scan': {
      const dir = resolve(rest[0] ?? '.');
      const { files, refs } = readLockfiles(dir);
      if (files.length === 0) {
        console.error(`No lockfile found in ${dir}`);
        return 2;
      }
      const hits = await scanRefs(refs);
      if (json) console.log(JSON.stringify({ lockfiles: files, scanned: refs.length, hits }, null, 2));
      else console.log(hits.length ? formatVerdicts(hits) : `[guardian] OK ${refs.length} packages scanned (${files.map((f) => f.replace(/.*[\\/]/, '')).join(', ')}), no known-malicious or critical advisories.`);
      return hits.some((h) => h.action === 'deny') ? 1 : 0;
    }
    case 'install': {
      if (rest[0] === 'claude-code') {
        console.log(`Guardian hooks added to ${installClaudeCode()}. New Claude Code sessions will gate package installs and diff the lockfile afterwards.`);
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
