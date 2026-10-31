import type { VersionFacts } from '../core/types.js';
import { FileCache } from './cache.js';

export interface NpmMetadata {
  exists: boolean;
  distTags: Record<string, string>;
  versions: VersionFacts[];
}

interface RegistryDoc {
  'dist-tags'?: Record<string, string>;
  versions?: Record<string, { scripts?: Record<string, string>; hasInstallScript?: boolean }>;
  time?: Record<string, string>;
}

const HOUR = 3_600_000;
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'];

export class NpmRegistryClient {
  constructor(
    private baseUrl: string = process.env.GUARDIAN_NPM_REGISTRY ?? 'https://registry.npmjs.org',
    private cache: FileCache = new FileCache(),
    private timeoutMs = 8000,
  ) {}

  async getPackage(name: string): Promise<NpmMetadata> {
    const key = `npm:${name}`;
    const cached = this.cache.get<NpmMetadata>(key);
    if (cached) return cached;

    const res = await fetch(`${this.baseUrl}/${name.replace('/', '%2F')}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (res.status === 404) {
      const miss: NpmMetadata = { exists: false, distTags: {}, versions: [] };
      this.cache.set(key, miss, 10 * 60_000);
      return miss;
    }
    if (!res.ok) throw new Error(`npm registry ${res.status}`);

    const doc = (await res.json()) as RegistryDoc;
    const versions: VersionFacts[] = Object.entries(doc.versions ?? {}).map(([version, v]) => ({
      version,
      publishedAt: doc.time?.[version] ?? null,
      hasInstallScripts: v.hasInstallScript === true || INSTALL_SCRIPTS.some((s) => v.scripts?.[s] !== undefined),
    }));
    const meta: NpmMetadata = { exists: true, distTags: doc['dist-tags'] ?? {}, versions };
    this.cache.set(key, meta, 6 * HOUR);
    return meta;
  }
}
