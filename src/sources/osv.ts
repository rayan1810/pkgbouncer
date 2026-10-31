import type { Ecosystem, OsvVuln } from '../core/types.js';
import { FileCache } from './cache.js';
import { drain } from './npm-registry.js';

const HOUR = 3_600_000;
const BATCH = 1000;

export class OsvClient {
  constructor(
    private baseUrl: string = process.env.PKGBOUNCER_OSV_URL ?? 'https://api.osv.dev',
    private cache: FileCache = new FileCache(),
    private timeoutMs = 8000,
  ) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      await drain(res);
      throw new Error(`osv ${path} ${res.status}`);
    }
    return (await res.json()) as T;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(this.baseUrl + path, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) {
      await drain(res);
      throw new Error(`osv ${path} ${res.status}`);
    }
    return (await res.json()) as T;
  }

  /** All vulns (any version) for a package. */
  queryPackage(name: string, ecosystem: Ecosystem = 'npm'): Promise<OsvVuln[]> {
    return this.cache.remember(`osv:pkg:${ecosystem}:${name}`, HOUR, async () => {
      const r = await this.post<{ vulns?: OsvVuln[] }>('/v1/query', { package: { name, ecosystem } });
      return r.vulns ?? [];
    });
  }

  getVuln(id: string): Promise<OsvVuln> {
    return this.cache.remember(`osv:vuln:${id}`, 24 * HOUR, () => this.get<OsvVuln>(`/v1/vulns/${encodeURIComponent(id)}`));
  }

  /** Per-version batch lookup; returns full vuln records per input, in order. */
  async queryBatch(refs: { name: string; version: string; ecosystem?: Ecosystem }[]): Promise<OsvVuln[][]> {
    const out: OsvVuln[][] = [];
    for (let i = 0; i < refs.length; i += BATCH) {
      const chunk = refs.slice(i, i + BATCH);
      const r = await this.post<{ results: { vulns?: { id: string }[] }[] }>('/v1/querybatch', {
        queries: chunk.map((c) => ({ package: { name: c.name, ecosystem: c.ecosystem ?? 'npm' }, version: c.version })),
      });
      for (const res of r.results) out.push(await Promise.all((res.vulns ?? []).map((v) => this.getVuln(v.id))));
    }
    return out;
  }
}
