import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGate, runPostGate } from '../src/hooks/run-gate.js';
import { claudeCodeHook } from '../src/hooks/claude-code.js';
import { cursorHook } from '../src/hooks/cursor.js';
import { pendingDirectDeps, takeSnapshot, diffSinceSnapshot, readLockRefs } from '../src/hooks/install-watch.js';
import { DEFAULT_POLICY } from '../src/core/types.js';
import { stubSources } from './helpers/stub-sources.js';

const P = DEFAULT_POLICY;
const quiet = { noSnapshot: true };

beforeEach(() => {
  process.env.PKGBOUNCER_HOME = mkdtempSync(join(tmpdir(), 'ghome-'));
});

function project(pkg: object, lock?: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'gproj-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  if (lock) writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
  return dir;
}
const lockWith = (entries: Record<string, string>) => ({ lockfileVersion: 3, packages: Object.fromEntries(Object.entries(entries).map(([n, v]) => [`node_modules/${n}`, { version: v }])) });

describe('runGate', () => {
  it('returns deny with text for malicious installs', async () => {
    const r = await runGate('npm i evil', P, stubSources, quiet);
    expect(r.action).toBe('deny');
    expect(r.text).toContain('MAL-1');
    expect(r.text).toContain('blocked');
  });
  it('returns allow with empty text for clean or unrelated commands', async () => {
    expect(await runGate('ls', P, stubSources, quiet)).toEqual({ action: 'allow', text: '', verdicts: [] });
    const r = await runGate('npm i fine', P, stubSources, quiet);
    expect(r.action).toBe('allow');
    expect(r.text).toBe('');
  });
  it('only reports flagged packages in mixed installs', async () => {
    const r = await runGate('npm i fine evil', P, stubSources, quiet);
    expect(r.action).toBe('deny');
    expect(r.verdicts).toHaveLength(2);
    expect(r.text).not.toContain('OK fine');
  });
  it('gates other ecosystems', async () => {
    expect((await runGate('pip install evil-py', P, stubSources, quiet)).action).toBe('deny');
    expect((await runGate('cargo add fine', P, stubSources, quiet)).action).toBe('allow');
    expect((await runGate('go get github.com/x/nope', P, stubSources, quiet)).action).toBe('deny');
  });
  it('checks package.json deps missing from the lockfile on a bare npm install', async () => {
    const dir = project({ dependencies: { fine: '^1.0.0', evil: '^1.0.0' } }, lockWith({ fine: '1.0.0' }));
    const r = await runGate('npm install', P, stubSources, { cwd: dir, noSnapshot: true });
    expect(r.action).toBe('deny');
    expect(r.verdicts.map((v) => v.ref.name)).toEqual(['evil']);
    expect(r.text).toContain('not yet in the lockfile');
  });
  it('allows a bare install when the lockfile already satisfies package.json', async () => {
    const dir = project({ dependencies: { evil: '^1.0.0' } }, lockWith({ evil: '1.0.0' }));
    expect((await runGate('npm ci', P, stubSources, { cwd: dir, noSnapshot: true })).action).toBe('allow');
  });
  it('follows a leading cd', async () => {
    const dir = project({ dependencies: { evil: '*' } });
    const parent = join(dir, '..');
    const r = await runGate(`cd ${dir.slice(dir.lastIndexOf('\\') + 1).replace(/^.*\//, '')} && npm install`, P, stubSources, { cwd: parent, noSnapshot: true });
    expect(r.action).toBe('deny');
  });
});

describe('install-watch', () => {
  it('pendingDirectDeps ignores satisfied, non-registry and bad ranges', () => {
    const dir = project({ dependencies: { a: '^1.0.0', b: 'file:../b', c: 'workspace:*', d: '~2.0.0' }, devDependencies: { e: '' } }, lockWith({ a: '1.2.0', d: '1.0.0' }));
    expect(pendingDirectDeps(dir).map((r) => `${r.name}@${r.spec}`)).toEqual(['d@~2.0.0', 'e@undefined']);
  });
  it('snapshot + diff reports only new refs and consumes the snapshot', () => {
    const dir = project({}, lockWith({ a: '1.0.0' }));
    takeSnapshot(dir);
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lockWith({ a: '1.0.0', b: '2.0.0', evil: '1.0.0' })));
    expect(diffSinceSnapshot(dir)?.map((r) => r.name)).toEqual(['b', 'evil']);
    expect(diffSinceSnapshot(dir)).toBeNull();
  });
  it('readLockRefs unions all lockfiles', () => {
    const dir = project({}, lockWith({ a: '1.0.0' }));
    writeFileSync(join(dir, 'requirements.txt'), 'requests==2.31.0\n');
    expect(readLockRefs(dir).map((r) => r.ecosystem)).toEqual(['npm', 'PyPI']);
  });
});

describe('runPostGate', () => {
  it('flags transitive malware added by an install', async () => {
    const dir = project({}, lockWith({ fine: '1.0.0' }));
    await runGate('npm i fine', P, stubSources, { cwd: dir });
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lockWith({ fine: '1.0.0', evil: '1.0.0', ok: '3.0.0' })));
    const r = await runPostGate('npm i fine', P, stubSources, { cwd: dir });
    expect(r.action).toBe('deny');
    expect(r.text).toContain('added 2 package(s)');
    expect(r.text).toContain('MAL-1');
    expect(r.text).toContain('Remove or pin');
  });
  it('is silent when nothing new is flagged or no snapshot exists', async () => {
    const dir = project({}, lockWith({ fine: '1.0.0' }));
    expect(await runPostGate('npm install', P, stubSources, { cwd: dir })).toEqual({ action: 'allow', text: '', verdicts: [] });
    await runGate('npm install', P, stubSources, { cwd: dir });
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lockWith({ fine: '1.0.0', ok: '3.0.0' })));
    expect((await runPostGate('npm install', P, stubSources, { cwd: dir })).action).toBe('allow');
    expect(await runPostGate('ls', P, stubSources, { cwd: dir })).toEqual({ action: 'allow', text: '', verdicts: [] });
  });
});

describe('claudeCodeHook', () => {
  it('exits 2 for deny, 0 otherwise, ignores non-Bash tools', async () => {
    const deny = await claudeCodeHook({ tool_name: 'Bash', tool_input: { command: 'npm i evil' } }, P, stubSources, quiet);
    expect(deny.exitCode).toBe(2);
    expect(deny.stderr).toContain('MAL-1');
    expect((await claudeCodeHook({ tool_name: 'Bash', tool_input: { command: 'npm i fine' } }, P, stubSources, quiet)).exitCode).toBe(0);
    expect((await claudeCodeHook({ tool_name: 'Read', tool_input: {} }, P, stubSources, quiet)).exitCode).toBe(0);
  });
  it('gates the PowerShell tool too', async () => {
    const r = await claudeCodeHook({ tool_name: 'PowerShell', tool_input: { command: 'npm install evil; echo done' } }, P, stubSources, quiet);
    expect(r.exitCode).toBe(2);
  });
  it('routes PostToolUse to the post-install diff using the hook cwd', async () => {
    const dir = project({}, lockWith({ fine: '1.0.0' }));
    await claudeCodeHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm i fine' }, cwd: dir }, P, stubSources);
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lockWith({ fine: '1.0.0', evil: '1.0.0' })));
    const r = await claudeCodeHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm i fine' }, cwd: dir }, P, stubSources);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('evil@1.0.0');
  });
});

describe('cursorHook', () => {
  it('returns permission JSON', async () => {
    const r = await cursorHook({ command: 'npm i evil' }, P, stubSources, quiet);
    expect(r.permission).toBe('deny');
    expect(r.agentMessage).toContain('MAL-1');
    expect(await cursorHook({ command: 'npm i fine' }, P, stubSources, quiet)).toEqual({ permission: 'allow' });
    expect(await cursorHook({}, P, stubSources, quiet)).toEqual({ permission: 'allow' });
  });
});
