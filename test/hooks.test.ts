import { describe, it, expect } from 'vitest';
import { runGate } from '../src/hooks/run-gate.js';
import { claudeCodeHook } from '../src/hooks/claude-code.js';
import { cursorHook } from '../src/hooks/cursor.js';
import { DEFAULT_POLICY } from '../src/core/types.js';
import { stubSources } from './helpers/stub-sources.js';

describe('runGate', () => {
  it('returns deny with text for malicious installs', async () => {
    const r = await runGate('npm i evil', DEFAULT_POLICY, stubSources);
    expect(r.action).toBe('deny');
    expect(r.text).toContain('MAL-1');
    expect(r.text).toContain('blocked');
  });
  it('returns allow with empty text for clean or unrelated commands', async () => {
    expect(await runGate('ls', DEFAULT_POLICY, stubSources)).toEqual({ action: 'allow', text: '', verdicts: [] });
    const r = await runGate('npm i fine', DEFAULT_POLICY, stubSources);
    expect(r.action).toBe('allow');
    expect(r.text).toBe('');
  });
  it('only reports flagged packages in mixed installs', async () => {
    const r = await runGate('npm i fine evil', DEFAULT_POLICY, stubSources);
    expect(r.action).toBe('deny');
    expect(r.verdicts).toHaveLength(2);
    expect(r.text).not.toContain('OK fine');
  });
});

describe('claudeCodeHook', () => {
  it('exits 2 for deny, 0 otherwise, ignores non-Bash tools', async () => {
    const deny = await claudeCodeHook({ tool_name: 'Bash', tool_input: { command: 'npm i evil' } }, DEFAULT_POLICY, stubSources);
    expect(deny.exitCode).toBe(2);
    expect(deny.stderr).toContain('MAL-1');
    expect((await claudeCodeHook({ tool_name: 'Bash', tool_input: { command: 'npm i fine' } }, DEFAULT_POLICY, stubSources)).exitCode).toBe(0);
    expect((await claudeCodeHook({ tool_name: 'Read', tool_input: {} }, DEFAULT_POLICY, stubSources)).exitCode).toBe(0);
  });
});

describe('cursorHook', () => {
  it('returns permission JSON', async () => {
    const r = await cursorHook({ command: 'npm i evil' }, DEFAULT_POLICY, stubSources);
    expect(r.permission).toBe('deny');
    expect(r.agentMessage).toContain('MAL-1');
    expect(await cursorHook({ command: 'npm i fine' }, DEFAULT_POLICY, stubSources)).toEqual({ permission: 'allow' });
    expect(await cursorHook({}, DEFAULT_POLICY, stubSources)).toEqual({ permission: 'allow' });
  });
});
