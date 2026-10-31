import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let server: Server;
let base: string;

const META = { 'dist-tags': { latest: '1.0.0' }, versions: { '0.9.0': {}, '1.0.0': {} }, time: { '0.9.0': '2025-01-01T00:00:00Z', '1.0.0': '2026-01-01T00:00:00Z' } };
const MAL = { id: 'MAL-2026-1', summary: 'stealer', affected: [{ package: { name: 'evil' }, versions: ['1.0.0'] }] };

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/query') {
        const name = JSON.parse(body).package.name;
        return res.end(JSON.stringify({ vulns: name === 'evil' ? [MAL] : [] }));
      }
      if (req.url === '/v1/querybatch') {
        const queries = JSON.parse(body).queries as { package: { name: string } }[];
        return res.end(JSON.stringify({ results: queries.map((q) => ({ vulns: q.package.name === 'evil' ? [{ id: MAL.id }] : [] })) }));
      }
      if (req.url === `/v1/vulns/${MAL.id}`) return res.end(JSON.stringify(MAL));
      if (req.url === '/evil' || req.url === '/lodash') return res.end(JSON.stringify(META));
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

interface Result { status: number | null; stdout: string; stderr: string }

/** Async spawn so the in-process fixture server can answer while the child runs. */
function run(args: string[], input?: string): Promise<Result> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [join(process.cwd(), 'dist', 'cli.js'), ...args], {
      env: { ...process.env, PKGBOUNCER_OSV_URL: base, PKGBOUNCER_NPM_REGISTRY: base, PKGBOUNCER_CACHE_DIR: mkdtempSync(join(tmpdir(), 'gc-')), PKGBOUNCER_HOME: mkdtempSync(join(tmpdir(), 'gh-')) },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (status) => resolvePromise({ status, stdout, stderr }));
    child.stdin.end(input ?? '');
  });
}

describe('cli', () => {
  it('check blocks malware with exit 1 and allows clean', async () => {
    const r = await run(['check', 'evil']);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('BLOCKED evil@1.0.0');
    expect(r.stdout).toContain('evil@0.9.0');
    expect((await run(['check', 'lodash'])).status).toBe(0);
    expect((await run(['check', 'ghost-package'])).status).toBe(1);
  });
  it('check --json emits verdict array', async () => {
    const r = await run(['check', '--json', 'lodash']);
    expect(JSON.parse(r.stdout)[0].action).toBe('allow');
  });
  it('scan reports hits from a lockfile', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gproj-'));
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/evil': { version: '1.0.0' }, 'node_modules/lodash': { version: '1.0.0' } } }));
    const r = await run(['scan', dir]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('MAL-2026-1');
    expect((await run(['scan', mkdtempSync(join(tmpdir(), 'gempty-'))])).status).toBe(2);
  });
  it('hook claude-code exits 2 with stderr on deny', async () => {
    const r = await run(['hook', 'claude-code'], JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm i evil' } }));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('MAL-2026-1');
    expect((await run(['hook', 'claude-code'], JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm i lodash' } }))).status).toBe(0);
    expect((await run(['hook', 'claude-code'], '')).status).toBe(0);
  });
  it('hook cursor prints permission json', async () => {
    const r = await run(['hook', 'cursor'], JSON.stringify({ command: 'npm i evil' }));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).permission).toBe('deny');
  });
  it('prints usage for no args and errors for unknown commands', async () => {
    expect((await run([])).status).toBe(0);
    expect((await run(['bogus'])).status).toBe(2);
  });
});
