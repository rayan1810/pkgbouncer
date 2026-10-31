import { describe, it, expect } from 'vitest';
import { evaluate, matchesList, loadPolicy } from '../src/core/policy.js';
import { DEFAULT_POLICY, type PackageFacts } from '../src/core/types.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const day = 86_400_000;
const now = new Date('2026-10-31T00:00:00Z').getTime();
const iso = (d: number) => new Date(now - d * day).toISOString();
const base = (over: Partial<PackageFacts> = {}): PackageFacts => ({
  ref: { ecosystem: 'npm', name: 'foo' },
  exists: true,
  distTags: { latest: '1.1.0' },
  versions: [
    { version: '1.0.0', publishedAt: iso(100), hasInstallScripts: false },
    { version: '1.1.0', publishedAt: iso(50), hasInstallScripts: false },
  ],
  vulns: [],
  sourceErrors: [],
  ...over,
});
const rules = (v: ReturnType<typeof evaluate>) => v.findings.map((f) => f.rule);

describe('evaluate', () => {
  it('allows a clean package', () => {
    const v = evaluate(base(), DEFAULT_POLICY, now);
    expect(v.action).toBe('allow');
    expect(v.resolvedVersion).toBe('1.1.0');
    expect(v.findings).toEqual([]);
  });
  it('denies nonexistent packages', () => {
    const v = evaluate(base({ exists: false, versions: [], distTags: {} }), DEFAULT_POLICY, now);
    expect(v.action).toBe('deny');
    expect(rules(v)).toEqual(['nonexistent']);
  });
  it('denies malware and suggests safe version', () => {
    const v = evaluate(base({ vulns: [{ id: 'MAL-1', affected: [{ package: { name: 'foo' }, versions: ['1.1.0'] }] }] }), DEFAULT_POLICY, now);
    expect(v.action).toBe('deny');
    expect(rules(v)).toEqual(['known-malicious']);
    expect(v.safeVersion).toBe('1.0.0');
  });
  it('denies CRITICAL, warns HIGH', () => {
    const crit = { id: 'GHSA-1', affected: [{ package: { name: 'foo' }, versions: ['1.1.0'] }], database_specific: { severity: 'CRITICAL' } };
    expect(evaluate(base({ vulns: [crit] }), DEFAULT_POLICY, now).action).toBe('deny');
    const high = { ...crit, database_specific: { severity: 'HIGH' } };
    expect(evaluate(base({ vulns: [high] }), DEFAULT_POLICY, now).action).toBe('warn');
  });
  it('warns too-new, denies when strict', () => {
    const f = base({ versions: [{ version: '1.1.0', publishedAt: iso(0.5), hasInstallScripts: false }] });
    expect(evaluate(f, DEFAULT_POLICY, now).action).toBe('warn');
    expect(evaluate(f, { ...DEFAULT_POLICY, strict: true }, now).action).toBe('deny');
  });
  it('warns on install scripts and typosquats', () => {
    const f = base({ ref: { ecosystem: 'npm', name: 'lodahs' }, versions: [{ version: '1.1.0', publishedAt: iso(50), hasInstallScripts: true }] });
    expect(rules(evaluate(f, DEFAULT_POLICY, now)).sort()).toEqual(['install-scripts', 'typosquat']);
  });
  it('honors allow and deny lists', () => {
    const f = base({ vulns: [{ id: 'MAL-1', affected: [{ package: { name: 'foo' }, versions: ['1.1.0'] }] }] });
    expect(evaluate(f, { ...DEFAULT_POLICY, allow: ['foo'] }, now).action).toBe('allow');
    expect(rules(evaluate(base(), { ...DEFAULT_POLICY, deny: ['foo@<2'] }, now))).toEqual(['denylist']);
  });
  it('warns on source errors, denies when failClosed', () => {
    const f = base({ sourceErrors: ['osv: ECONNREFUSED'] });
    expect(evaluate(f, DEFAULT_POLICY, now).action).toBe('warn');
    expect(evaluate(f, { ...DEFAULT_POLICY, failClosed: true }, now).action).toBe('deny');
  });
  it('denies when requested spec cannot be resolved', () => {
    expect(evaluate(base({ ref: { ecosystem: 'npm', name: 'foo', spec: '9.0.0' } }), DEFAULT_POLICY, now).action).toBe('deny');
  });
});

describe('matchesList', () => {
  it('matches by name and by range', () => {
    expect(matchesList(['foo'], 'foo', '1.0.0')).toBe(true);
    expect(matchesList(['foo@<2'], 'foo', '1.0.0')).toBe(true);
    expect(matchesList(['foo@<2'], 'foo', '2.0.0')).toBe(false);
    expect(matchesList(['@scope/*'], '@scope/x', '1.0.0')).toBe(true);
    expect(matchesList(['bar'], 'foo', '1.0.0')).toBe(false);
  });
});

describe('loadPolicy', () => {
  it('merges pkgbouncer.json over defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gpol-'));
    writeFileSync(join(dir, 'pkgbouncer.json'), JSON.stringify({ minAgeDays: 7, deny: ['evil'] }));
    expect(loadPolicy(dir)).toEqual({ ...DEFAULT_POLICY, minAgeDays: 7, deny: ['evil'] });
  });
  it('returns defaults when nothing is configured', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gpol-'));
    process.env.PKGBOUNCER_HOME = mkdtempSync(join(tmpdir(), 'ghome-'));
    expect(loadPolicy(dir)).toEqual(DEFAULT_POLICY);
  });
});
