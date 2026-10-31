import type { Ecosystem, PackageRef, VersionFacts } from '../core/types.js';
import { FileCache } from './cache.js';
import { NpmRegistryClient, drain, type NpmMetadata } from './npm-registry.js';

export type RegistryMetadata = NpmMetadata;

const HOUR = 3_600_000;
const MISS_TTL = 10 * 60_000;
const USER_AGENT = 'pkgbouncer/0.1 (+https://github.com/rohit/pkgbouncer)';

/**
 * One facade over the four package registries. Each returns the same shape:
 * exists, dist-tags (at least `latest`), and per-version publish time.
 */
export class RegistryClient {
  private npm: NpmRegistryClient;

  constructor(
    private cache: FileCache = new FileCache(),
    private urls: Partial<Record<Ecosystem, string>> = {},
    private timeoutMs = 8000,
  ) {
    this.npm = new NpmRegistryClient(urls.npm, cache, timeoutMs);
  }

  private base(eco: Ecosystem): string {
    const env: Record<Ecosystem, string | undefined> = {
      npm: undefined,
      PyPI: process.env.PKGBOUNCER_PYPI_URL,
      'crates.io': process.env.PKGBOUNCER_CRATES_URL,
      Go: process.env.PKGBOUNCER_GOPROXY_URL,
    };
    const defaults: Record<Ecosystem, string> = { npm: '', PyPI: 'https://pypi.org', 'crates.io': 'https://crates.io', Go: 'https://proxy.golang.org' };
    return (this.urls[eco] ?? env[eco] ?? defaults[eco]).replace(/\/$/, '');
  }

  private async fetchJson(url: string): Promise<{ status: number; json: unknown }> {
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(this.timeoutMs) });
    if (res.status === 404 || res.status === 410) {
      await drain(res);
      return { status: 404, json: null };
    }
    if (!res.ok) {
      await drain(res);
      throw new Error(`${new URL(url).host} ${res.status}`);
    }
    return { status: res.status, json: await res.json() };
  }

  async getPackage(ref: Pick<PackageRef, 'ecosystem' | 'name'>): Promise<RegistryMetadata> {
    if (ref.ecosystem === 'npm') return this.npm.getPackage(ref.name);
    const key = `reg:${ref.ecosystem}:${ref.name}`;
    const cached = this.cache.get<RegistryMetadata>(key);
    if (cached) return cached;
    const meta = await (ref.ecosystem === 'PyPI' ? this.pypi(ref.name) : ref.ecosystem === 'crates.io' ? this.crates(ref.name) : this.go(ref.name));
    this.cache.set(key, meta, meta.exists ? 6 * HOUR : MISS_TTL);
    return meta;
  }

  /** Go version times are per-request; fetch for one version only when needed. */
  async getVersionTime(ref: Pick<PackageRef, 'ecosystem' | 'name'>, version: string): Promise<string | null> {
    if (ref.ecosystem !== 'Go') return null;
    const key = `reg:Go:${ref.name}@${version}:info`;
    return this.cache.remember(key, 24 * HOUR, async () => {
      const { status, json } = await this.fetchJson(`${this.base('Go')}/${escapeGoModule(ref.name)}/@v/${version}.info`);
      if (status === 404) return null;
      return (json as { Time?: string }).Time ?? null;
    });
  }

  private async pypi(name: string): Promise<RegistryMetadata> {
    const { status, json } = await this.fetchJson(`${this.base('PyPI')}/pypi/${encodeURIComponent(name)}/json`);
    if (status === 404) return { exists: false, distTags: {}, versions: [] };
    const doc = json as { info?: { version?: string }; releases?: Record<string, { upload_time_iso_8601?: string; upload_time?: string; yanked?: boolean }[]> };
    const versions: VersionFacts[] = [];
    for (const [version, files] of Object.entries(doc.releases ?? {})) {
      if (files.length === 0 || files.every((f) => f.yanked)) continue;
      const times = files.map((f) => f.upload_time_iso_8601 ?? f.upload_time).filter((t): t is string => !!t).sort();
      versions.push({ version, publishedAt: times[0] ?? null, hasInstallScripts: false });
    }
    const distTags: Record<string, string> = {};
    if (doc.info?.version) distTags.latest = doc.info.version;
    return { exists: true, distTags, versions };
  }

  private async crates(name: string): Promise<RegistryMetadata> {
    const { status, json } = await this.fetchJson(`${this.base('crates.io')}/api/v1/crates/${encodeURIComponent(name)}`);
    if (status === 404) return { exists: false, distTags: {}, versions: [] };
    const doc = json as { crate?: { max_stable_version?: string | null; max_version?: string; newest_version?: string }; versions?: { num: string; created_at?: string; yanked?: boolean }[] };
    const versions: VersionFacts[] = (doc.versions ?? []).filter((v) => !v.yanked).map((v) => ({ version: v.num, publishedAt: v.created_at ?? null, hasInstallScripts: false }));
    const latest = doc.crate?.max_stable_version ?? doc.crate?.max_version ?? doc.crate?.newest_version;
    return { exists: true, distTags: latest ? { latest } : {}, versions };
  }

  private async go(name: string): Promise<RegistryMetadata> {
    const mod = escapeGoModule(name);
    const listRes = await fetch(`${this.base('Go')}/${mod}/@v/list`, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(this.timeoutMs) });
    if (listRes.status === 404 || listRes.status === 410) {
      await drain(listRes);
      return { exists: false, distTags: {}, versions: [] };
    }
    if (!listRes.ok) {
      await drain(listRes);
      throw new Error(`proxy.golang.org ${listRes.status}`);
    }
    const list = (await listRes.text()).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const versions: VersionFacts[] = list.map((version) => ({ version, publishedAt: null, hasInstallScripts: false }));
    const distTags: Record<string, string> = {};
    try {
      const { status, json } = await this.fetchJson(`${this.base('Go')}/${mod}/@latest`);
      if (status !== 404) {
        const info = json as { Version?: string; Time?: string };
        if (info.Version) {
          distTags.latest = info.Version;
          const existing = versions.find((v) => v.version === info.Version);
          if (existing) existing.publishedAt = info.Time ?? null;
          else versions.push({ version: info.Version, publishedAt: info.Time ?? null, hasInstallScripts: false });
        }
      }
    } catch {
      // @latest is optional; the version list is enough to say the module exists
    }
    return { exists: true, distTags, versions };
  }
}

/** Go module proxy escaping: uppercase letters become "!" + lowercase. */
export function escapeGoModule(path: string): string {
  return path.replace(/[A-Z]/g, (c) => '!' + c.toLowerCase());
}
