import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileCache } from '../src/sources/cache.js';
import { OsvClient } from '../src/sources/osv.js';
import { NpmRegistryClient } from '../src/sources/npm-registry.js';

let server: Server;
let base: string;
let hits = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    hits++;
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/query') {
        return res.end(JSON.stringify({ vulns: [{ id: 'MAL-2026-1', affected: [{ package: { name: 'evil' }, versions: ['1.0.0'] }] }] }));
      }
      if (req.url === '/v1/querybatch') {
        const q = JSON.parse(body).queries.length;
        return res.end(JSON.stringify({ results: Array.from({ length: q }, (_, i) => ({ vulns: i === 0 ? [{ id: 'MAL-2026-1' }] : [] })) }));
      }
      if (req.url === '/v1/vulns/MAL-2026-1') return res.end(JSON.stringify({ id: 'MAL-2026-1', summary: 'bad', affected: [] }));
      if (req.url === '/evil') {
        return res.end(JSON.stringify({ name: 'evil', 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { scripts: { postinstall: 'x' } } }, time: { '1.0.0': '2026-10-30T00:00:00Z' } }));
      }
      if (req.url === '/@s%2Fpkg') {
        return res.end(JSON.stringify({ name: '@s/pkg', 'dist-tags': { latest: '2.0.0' }, versions: { '2.0.0': {} }, time: { '2.0.0': '2026-01-01T00:00:00Z' } }));
      }
      if (req.url === '/boom') { res.statusCode = 500; return res.end('{}'); }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

const cache = () => new FileCache(mkdtempSync(join(tmpdir(), 'gcache-')));

describe('FileCache', () => {
  it('stores, expires and remembers', async () => {
    const c = cache();
    c.set('k', { a: 1 }, 10_000);
    expect(c.get('k')).toEqual({ a: 1 });
    c.set('old', 1, -1);
    expect(c.get('old')).toBeUndefined();
    let calls = 0;
    const fn = async () => { calls++; return 'v'; };
    expect(await c.remember('r', 10_000, fn)).toBe('v');
    expect(await c.remember('r', 10_000, fn)).toBe('v');
    expect(calls).toBe(1);
  });
});

describe('OsvClient', () => {
  it('queries by package and caches', async () => {
    const c = new OsvClient(base, cache());
    const before = hits;
    const v = await c.queryPackage('evil');
    expect(v[0].id).toBe('MAL-2026-1');
    await c.queryPackage('evil');
    expect(hits - before).toBe(1);
  });
  it('batch queries then fetches details', async () => {
    const c = new OsvClient(base, cache());
    const r = await c.queryBatch([{ name: 'evil', version: '1.0.0' }, { name: 'fine', version: '1.0.0' }]);
    expect(r[0][0].summary).toBe('bad');
    expect(r[1]).toEqual([]);
  });
  it('returns empty for no refs without a request', async () => {
    const before = hits;
    expect(await new OsvClient(base, cache()).queryBatch([])).toEqual([]);
    expect(hits).toBe(before);
  });
});

describe('NpmRegistryClient', () => {
  it('reads metadata including scripts, time and scoped names', async () => {
    const c = new NpmRegistryClient(base, cache());
    const m = await c.getPackage('evil');
    expect(m).toEqual({ exists: true, distTags: { latest: '1.0.0' }, versions: [{ version: '1.0.0', publishedAt: '2026-10-30T00:00:00Z', hasInstallScripts: true }] });
    expect((await c.getPackage('@s/pkg')).versions[0].hasInstallScripts).toBe(false);
  });
  it('reports nonexistent packages and caches the miss', async () => {
    const c = new NpmRegistryClient(base, cache());
    const before = hits;
    expect((await c.getPackage('nope')).exists).toBe(false);
    expect((await c.getPackage('nope')).exists).toBe(false);
    expect(hits - before).toBe(1);
  });
  it('throws on server errors', async () => {
    await expect(new NpmRegistryClient(base, cache()).getPackage('boom')).rejects.toThrow(/500/);
  });
});
