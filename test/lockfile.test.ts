import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseLockfile, findLockfile, findLockfiles } from '../src/core/lockfile.js';

const fx = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const want = [
  { ecosystem: 'npm', name: '@types/node', spec: '22.0.0' },
  { ecosystem: 'npm', name: 'lodash', spec: '4.17.20' },
  { ecosystem: 'npm', name: 'lodash', spec: '4.17.21' },
];

describe('parseLockfile', () => {
  it('parses package-lock v3 (dedup by name@version)', () => {
    expect(parseLockfile('package-lock.json', fx('package-lock.json'))).toEqual(want);
  });
  it('parses package-lock v1 dependencies tree', () => {
    const v1 = JSON.stringify({ lockfileVersion: 1, dependencies: { lodash: { version: '4.17.21', dependencies: { '@types/node': { version: '22.0.0' } } } } });
    expect(parseLockfile('package-lock.json', v1)).toEqual(want.filter((w) => w.spec !== '4.17.20'));
  });
  it('parses pnpm-lock', () => {
    expect(parseLockfile('pnpm-lock.yaml', fx('pnpm-lock.yaml'))).toEqual(want.filter((w) => w.spec !== '4.17.20'));
  });
  it('parses pnpm-lock v6 keys with leading slash and peer suffix', () => {
    const v6 = `lockfileVersion: '6.0'\npackages:\n  /lodash@4.17.21:\n    resolution: {}\n  /@types/node@22.0.0(typescript@5.0.0):\n    resolution: {}\n`;
    expect(parseLockfile('pnpm-lock.yaml', v6)).toEqual(want.filter((w) => w.spec !== '4.17.20'));
  });
  it('parses yarn.lock v1', () => {
    expect(parseLockfile('yarn.lock', fx('yarn.lock'))).toEqual(want.filter((w) => w.spec !== '4.17.20'));
  });
  it('parses bun.lock (JSONC)', () => {
    expect(parseLockfile('bun.lock', fx('bun.lock'))).toEqual(want.filter((w) => w.spec !== '4.17.20'));
  });
  it('parses uv.lock / poetry.lock with PEP 503 names', () => {
    expect(parseLockfile('uv.lock', fx('uv.lock'))).toEqual([
      { ecosystem: 'PyPI', name: 'requests', spec: '2.31.0' },
      { ecosystem: 'PyPI', name: 'typing-extensions', spec: '4.12.2' },
    ]);
  });
  it('parses pinned requirements.txt only', () => {
    expect(parseLockfile('requirements.txt', fx('requirements.txt'))).toEqual([
      { ecosystem: 'PyPI', name: 'flask', spec: '3.0.0' },
      { ecosystem: 'PyPI', name: 'pandas', spec: '2.2.0' },
      { ecosystem: 'PyPI', name: 'requests', spec: '2.31.0' },
    ]);
  });
  it('parses Cargo.lock', () => {
    expect(parseLockfile('Cargo.lock', fx('Cargo.lock'))).toEqual([
      { ecosystem: 'crates.io', name: 'my-app', spec: '0.1.0' },
      { ecosystem: 'crates.io', name: 'serde', spec: '1.0.210' },
    ]);
  });
  it('parses go.sum, skipping /go.mod lines', () => {
    expect(parseLockfile('go.sum', fx('go.sum'))).toEqual([
      { ecosystem: 'Go', name: 'github.com/BurntSushi/toml', spec: 'v1.3.2' },
      { ecosystem: 'Go', name: 'golang.org/x/sys', spec: 'v0.15.0' },
    ]);
  });
  it('findLockfiles lists every lockfile present', () => {
    const dir = fileURLToPath(new URL('./fixtures/', import.meta.url));
    expect(findLockfiles(dir).map((p) => p.replace(/.*[\\/]/, '')).sort()).toEqual(['Cargo.lock', 'bun.lock', 'go.sum', 'package-lock.json', 'pnpm-lock.yaml', 'requirements.txt', 'uv.lock', 'yarn.lock']);
    expect(findLockfile(dir, 'Go')).toMatch(/go\.sum$/);
  });
  it('rejects unknown files', () => {
    expect(() => parseLockfile('Gemfile.lock', '')).toThrow(/Unsupported/);
  });
  it('findLockfile returns path or null', () => {
    const dir = fileURLToPath(new URL('./fixtures/', import.meta.url));
    expect(findLockfile(dir)).toMatch(/package-lock\.json$/);
    expect(findLockfile(fileURLToPath(new URL('./fixtures/empty/', import.meta.url)))).toBeNull();
  });
});
