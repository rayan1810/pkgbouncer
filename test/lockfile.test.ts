import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseLockfile, findLockfile } from '../src/core/lockfile.js';

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
  it('rejects unknown files', () => {
    expect(() => parseLockfile('Cargo.lock', '')).toThrow(/Unsupported/);
  });
  it('findLockfile returns path or null', () => {
    const dir = fileURLToPath(new URL('./fixtures/', import.meta.url));
    expect(findLockfile(dir)).toMatch(/package-lock\.json$/);
    expect(findLockfile(fileURLToPath(new URL('./fixtures/empty/', import.meta.url)))).toBeNull();
  });
});
