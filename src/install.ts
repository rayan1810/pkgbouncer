import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export const CLAUDE_HOOK_CMD = 'guardian hook claude-code';
export const CURSOR_HOOK_CMD = 'guardian hook cursor';

type Json = Record<string, unknown>;

function readJson(p: string): Json {
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Json;
  } catch {
    throw new Error(`${p} is not valid JSON; fix it or remove it and retry.`);
  }
}

function writeJson(p: string, v: unknown): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
}

function arrayAt(obj: Json, key: string): unknown[] {
  if (!Array.isArray(obj[key])) obj[key] = [];
  return obj[key] as unknown[];
}

function objectAt(obj: Json, key: string): Json {
  if (typeof obj[key] !== 'object' || obj[key] === null || Array.isArray(obj[key])) obj[key] = {};
  return obj[key] as Json;
}

/**
 * Adds the Bash hook under both PreToolUse (block before install) and
 * PostToolUse (diff the lockfile after install) in `~/.claude/settings.json`.
 * Idempotent. Returns the file path.
 */
export function installClaudeCode(home: string = homedir()): string {
  const p = join(home, '.claude', 'settings.json');
  const settings = readJson(p);
  const hooks = objectAt(settings, 'hooks');
  for (const event of ['PreToolUse', 'PostToolUse']) {
    const list = arrayAt(hooks, event) as { hooks?: { command?: string }[] }[];
    const present = list.some((entry) => (entry.hooks ?? []).some((h) => h.command === CLAUDE_HOOK_CMD));
    if (!present) list.push({ matcher: 'Bash', hooks: [{ type: 'command', command: CLAUDE_HOOK_CMD, timeout: 30 }] } as never);
  }
  writeJson(p, settings);
  return p;
}

/** Adds the beforeShellExecution hook to `~/.cursor/hooks.json`. Idempotent. Returns the file path. */
export function installCursor(home: string = homedir()): string {
  const p = join(home, '.cursor', 'hooks.json');
  const settings = readJson(p);
  if (settings.version === undefined) settings.version = 1;
  const before = arrayAt(objectAt(settings, 'hooks'), 'beforeShellExecution') as { command?: string }[];
  if (!before.some((h) => h.command === CURSOR_HOOK_CMD)) before.push({ command: CURSOR_HOOK_CMD });
  writeJson(p, settings);
  return p;
}
