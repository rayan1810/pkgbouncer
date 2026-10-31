import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installClaudeCode, installCursor, CLAUDE_HOOK_CMD, CURSOR_HOOK_CMD } from '../src/install.js';

describe('installClaudeCode', () => {
  it('creates settings with hook and is idempotent', () => {
    const home = mkdtempSync(join(tmpdir(), 'gh-'));
    const p = join(home, '.claude', 'settings.json');
    expect(installClaudeCode(home)).toBe(p);
    installClaudeCode(home);
    const s = JSON.parse(readFileSync(p, 'utf8'));
    expect(s.hooks.PreToolUse).toHaveLength(1);
    expect(s.hooks.PostToolUse).toHaveLength(1);
    const entry = { matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: CLAUDE_HOOK_CMD, timeout: 30 }] };
    expect(s.hooks.PreToolUse[0]).toEqual(entry);
    expect(s.hooks.PostToolUse[0]).toEqual(entry);
  });
  it('rewrites legacy guardian hook commands', () => {
    const home = mkdtempSync(join(tmpdir(), 'gh-'));
    mkdirSync(join(home, '.claude'));
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guardian hook claude-code', timeout: 30 }] }] } }));
    installClaudeCode(home);
    const s = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
    expect(s.hooks.PreToolUse).toHaveLength(1);
    expect(s.hooks.PreToolUse[0].hooks[0].command).toBe(CLAUDE_HOOK_CMD);
  });
  it('upgrades an older Bash-only entry to cover PowerShell', () => {
    const home = mkdtempSync(join(tmpdir(), 'gh-'));
    mkdirSync(join(home, '.claude'));
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: CLAUDE_HOOK_CMD, timeout: 30 }] }] } }));
    installClaudeCode(home);
    const s = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
    expect(s.hooks.PreToolUse).toHaveLength(1);
    expect(s.hooks.PreToolUse[0].matcher).toBe('Bash|PowerShell');
    expect(s.hooks.PostToolUse[0].matcher).toBe('Bash|PowerShell');
  });
  it('preserves existing settings and hooks', () => {
    const home = mkdtempSync(join(tmpdir(), 'gh-'));
    mkdirSync(join(home, '.claude'));
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'x', hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo' }] }] } }));
    installClaudeCode(home);
    const s = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
    expect(s.model).toBe('x');
    expect(s.hooks.PreToolUse).toHaveLength(2);
  });
  it('refuses to clobber invalid JSON', () => {
    const home = mkdtempSync(join(tmpdir(), 'gh-'));
    mkdirSync(join(home, '.claude'));
    writeFileSync(join(home, '.claude', 'settings.json'), '{ not json');
    expect(() => installClaudeCode(home)).toThrow(/not valid JSON/);
  });
});

describe('installCursor', () => {
  it('writes hooks.json idempotently', () => {
    const home = mkdtempSync(join(tmpdir(), 'gh-'));
    installCursor(home);
    installCursor(home);
    const s = JSON.parse(readFileSync(join(home, '.cursor', 'hooks.json'), 'utf8'));
    expect(s.version).toBe(1);
    expect(s.hooks.beforeShellExecution).toEqual([{ command: CURSOR_HOOK_CMD }]);
  });
});
