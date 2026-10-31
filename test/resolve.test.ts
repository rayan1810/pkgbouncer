import { describe, it, expect } from 'vitest';
import { resolveVersion, suggestSafeVersion } from '../src/core/resolve.js';
import type { PackageFacts } from '../src/core/types.js';

const day = 86_400_000;
const now = new Date('2026-10-31T00:00:00Z').getTime();
const iso = (daysAgo: number) => new Date(now - daysAgo * day).toISOString();

const facts: PackageFacts = {
  ref: { ecosystem: 'npm', name: 'foo' },
  exists: true,
  distTags: { latest: '2.0.0', next: '3.0.0-beta.1' },
  versions: [
    { version: '1.0.0', publishedAt: iso(400), hasInstallScripts: false },
    { version: '1.1.0', publishedAt: iso(200), hasInstallScripts: false },
    { version: '1.2.0', publishedAt: iso(30), hasInstallScripts: false },
    { version: '2.0.0', publishedAt: iso(1), hasInstallScripts: false },
    { version: '3.0.0-beta.1', publishedAt: iso(0), hasInstallScripts: false },
  ],
  vulns: [{ id: 'MAL-1', affected: [{ package: { name: 'foo' }, versions: ['1.2.0'] }] }],
  sourceErrors: [],
};

describe('resolveVersion', () => {
  it('resolves undefined and tags via dist-tags', () => {
    expect(resolveVersion(undefined, facts)).toBe('2.0.0');
    expect(resolveVersion('latest', facts)).toBe('2.0.0');
    expect(resolveVersion('next', facts)).toBe('3.0.0-beta.1');
  });
  it('resolves exact and ranges', () => {
    expect(resolveVersion('1.1.0', facts)).toBe('1.1.0');
    expect(resolveVersion('^1.0.0', facts)).toBe('1.2.0');
    expect(resolveVersion('9.x', facts)).toBeNull();
    expect(resolveVersion('not a version', facts)).toBeNull();
  });
  it('falls back to prerelease when a range matches nothing stable', () => {
    const f = { ...facts, distTags: {}, versions: [{ version: '0.0.1-security', publishedAt: null, hasInstallScripts: false }] };
    expect(resolveVersion('*', f)).toBe('0.0.1-security');
    expect(resolveVersion('^0.0.1', f)).toBe('0.0.1-security');
  });
});

describe('suggestSafeVersion', () => {
  it('skips malicious and too-new versions, prefers newest', () => {
    expect(suggestSafeVersion(facts, 3, now)).toBe('1.1.0');
  });
  it('returns null if nothing qualifies', () => {
    expect(suggestSafeVersion({ ...facts, versions: facts.versions.filter((v) => v.version === '1.2.0') }, 3, now)).toBeNull();
  });
});
