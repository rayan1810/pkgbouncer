import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileCache } from '../src/sources/cache.js';
import { RegistryClient, escapeGoModule } from '../src/sources/registry.js';

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '';
    res.setHeader('content-type', 'application/json');
    if (url === '/pypi/requests/json') {
      return res.end(JSON.stringify({ info: { version: '2.31.0' }, releases: { '2.30.0': [{ upload_time_iso_8601: '2023-05-03T00:00:00Z' }], '2.31.0': [{ upload_time_iso_8601: '2023-05-22T00:00:00Z' }], '2.32.0': [{ upload_time_iso_8601: '2024-05-20T00:00:00Z', yanked: true }], '3.0.0': [] } }));
    }
    if (url === '/api/v1/crates/serde') {
      return res.end(JSON.stringify({ crate: { max_stable_version: '1.0.210', max_version: '1.0.210' }, versions: [{ num: '1.0.210', created_at: '2024-09-01T00:00:00Z' }, { num: '1.0.209', created_at: '2024-08-01T00:00:00Z', yanked: true }, { num: '1.0.208', created_at: '2024-07-01T00:00:00Z' }] }));
    }
    if (url === '/github.com/!burnt!sushi/toml/@v/list') { res.setHeader('content-type', 'text/plain'); return res.end('v1.0.0\nv1.1.0\n'); }
    if (url === '/github.com/!burnt!sushi/toml/@latest') return res.end(JSON.stringify({ Version: 'v1.1.0', Time: '2023-01-01T00:00:00Z' }));
    if (url === '/github.com/!burnt!sushi/toml/@v/v1.0.0.info') return res.end(JSON.stringify({ Version: 'v1.0.0', Time: '2022-01-01T00:00:00Z' }));
    if (url === '/lodash') return res.end(JSON.stringify({ 'dist-tags': { latest: '4.17.21' }, versions: { '4.17.21': {} }, time: { '4.17.21': '2021-02-20T00:00:00Z' } }));
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

const client = () => new RegistryClient(new FileCache(mkdtempSync(join(tmpdir(), 'greg-'))), { npm: base, PyPI: base, 'crates.io': base, Go: base });

describe('RegistryClient', () => {
  it('delegates npm', async () => {
    expect((await client().getPackage({ ecosystem: 'npm', name: 'lodash' })).distTags.latest).toBe('4.17.21');
  });
  it('reads PyPI releases, skipping yanked and empty', async () => {
    const m = await client().getPackage({ ecosystem: 'PyPI', name: 'requests' });
    expect(m.exists).toBe(true);
    expect(m.distTags.latest).toBe('2.31.0');
    expect(m.versions.map((v) => v.version).sort()).toEqual(['2.30.0', '2.31.0']);
    expect(m.versions.find((v) => v.version === '2.31.0')?.publishedAt).toBe('2023-05-22T00:00:00Z');
    expect((await client().getPackage({ ecosystem: 'PyPI', name: 'nope' })).exists).toBe(false);
  });
  it('reads crates.io versions, skipping yanked', async () => {
    const m = await client().getPackage({ ecosystem: 'crates.io', name: 'serde' });
    expect(m.distTags.latest).toBe('1.0.210');
    expect(m.versions.map((v) => v.version)).toEqual(['1.0.210', '1.0.208']);
  });
  it('reads Go module list, latest, and per-version time', async () => {
    const c = client();
    const m = await c.getPackage({ ecosystem: 'Go', name: 'github.com/BurntSushi/toml' });
    expect(m.exists).toBe(true);
    expect(m.distTags.latest).toBe('v1.1.0');
    expect(m.versions.find((v) => v.version === 'v1.1.0')?.publishedAt).toBe('2023-01-01T00:00:00Z');
    expect(m.versions.find((v) => v.version === 'v1.0.0')?.publishedAt).toBeNull();
    expect(await c.getVersionTime({ ecosystem: 'Go', name: 'github.com/BurntSushi/toml' }, 'v1.0.0')).toBe('2022-01-01T00:00:00Z');
    expect((await c.getPackage({ ecosystem: 'Go', name: 'example.com/missing' })).exists).toBe(false);
  });
  it('escapes Go module paths', () => {
    expect(escapeGoModule('github.com/BurntSushi/toml')).toBe('github.com/!burnt!sushi/toml');
  });
});
