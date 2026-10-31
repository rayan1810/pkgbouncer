import { describe, it, expect } from 'vitest';
import { compareVersions, satisfies, isValidVersion, isPrerelease, normalizeVersion } from '../src/core/versions.js';

describe('npm / crates / Go (semver)', () => {
  it('compares and normalizes', () => {
    expect(compareVersions('npm', '1.2.3', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('crates.io', '2.0.0', '2.0.0')).toBe(0);
    expect(compareVersions('Go', 'v1.2.3', 'v1.2.4')).toBeLessThan(0);
    expect(normalizeVersion('Go', 'v1.2.3')).toBe('1.2.3');
    expect(isValidVersion('npm', 'not-a-version')).toBe(false);
    expect(isValidVersion('Go', 'v0.0.0-20230101000000-abcdef123456')).toBe(true);
  });
  it('satisfies ranges', () => {
    expect(satisfies('npm', '1.5.0', '^1.0.0')).toBe(true);
    expect(satisfies('npm', '2.0.0', '^1.0.0')).toBe(false);
    expect(satisfies('crates.io', '1.0.5', '1.0')).toBe(true);
    expect(satisfies('Go', 'v1.2.3', 'v1.2.3')).toBe(true);
  });
  it('detects prerelease', () => {
    expect(isPrerelease('npm', '3.0.0-beta.1')).toBe(true);
    expect(isPrerelease('npm', '3.0.0')).toBe(false);
  });
});

describe('PyPI (PEP 440-lite)', () => {
  it('compares release segments numerically', () => {
    expect(compareVersions('PyPI', '1.2', '1.10')).toBeLessThan(0);
    expect(compareVersions('PyPI', '1.2.0', '1.2')).toBe(0);
    expect(compareVersions('PyPI', '2.0.0rc1', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('PyPI', '2.0.0.post1', '2.0.0')).toBeGreaterThan(0);
    expect(compareVersions('PyPI', '2.0.0.dev1', '2.0.0a1')).toBeLessThan(0);
    expect(compareVersions('PyPI', '1.0a1', '1.0b1')).toBeLessThan(0);
  });
  it('validates and detects prerelease', () => {
    expect(isValidVersion('PyPI', '1.0.0')).toBe(true);
    expect(isValidVersion('PyPI', 'abc')).toBe(false);
    expect(isPrerelease('PyPI', '2.0.0rc1')).toBe(true);
    expect(isPrerelease('PyPI', '2.0.0.post1')).toBe(false);
  });
  it('satisfies PEP 440 specifiers', () => {
    expect(satisfies('PyPI', '2.31.0', '==2.31.0')).toBe(true);
    expect(satisfies('PyPI', '2.31.0', '>=2,<3')).toBe(true);
    expect(satisfies('PyPI', '3.0.0', '>=2,<3')).toBe(false);
    expect(satisfies('PyPI', '1.4.9', '~=1.4.2')).toBe(true);
    expect(satisfies('PyPI', '1.5.0', '~=1.4.2')).toBe(false);
    expect(satisfies('PyPI', '1.4.9', '!=1.4.9')).toBe(false);
    expect(satisfies('PyPI', '1.4.9', '==1.4.*')).toBe(true);
    expect(satisfies('PyPI', '1.4.9', '')).toBe(true);
  });
});
