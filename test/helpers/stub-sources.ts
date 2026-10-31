import type { Sources } from '../../src/check.js';
import type { Ecosystem, OsvVuln } from '../../src/core/types.js';

export const MAL: OsvVuln = { id: 'MAL-1', summary: 'stealer', affected: [{ package: { name: 'evil' }, versions: ['1.0.0'] }] };
const PY_MAL: OsvVuln = { id: 'MAL-2', summary: 'py stealer', affected: [{ package: { ecosystem: 'PyPI', name: 'evil-py' }, versions: ['1.0.0'] }] };

function vulnsFor(name: string, eco: Ecosystem): OsvVuln[] {
  if (eco === 'npm' && name === 'evil') return [MAL];
  if (eco === 'PyPI' && name === 'evil-py') return [PY_MAL];
  return [];
}

/**
 * In-memory sources. `evil@1.0.0` (npm) and `evil-py@1.0.0` (PyPI) are malware,
 * `nope` does not exist, `flaky` throws, anything else is clean with 0.9.0 and 1.0.0.
 */
export const stubSources: Sources = {
  osv: {
    queryPackage: async (name, eco) => vulnsFor(name, eco),
    queryBatch: async (refs) => refs.map((r) => vulnsFor(r.name, r.ecosystem)),
  },
  registry: {
    getPackage: async ({ name }) => {
      if (name === 'nope' || name.endsWith('/nope')) return { exists: false, distTags: {}, versions: [] };
      if (name === 'flaky') throw new Error('ECONNRESET');
      return {
        exists: true,
        distTags: { latest: '1.0.0' },
        versions: [
          { version: '0.9.0', publishedAt: '2025-01-01T00:00:00Z', hasInstallScripts: false },
          { version: '1.0.0', publishedAt: '2026-01-01T00:00:00Z', hasInstallScripts: false },
        ],
      };
    },
    getVersionTime: async () => null,
  },
};
