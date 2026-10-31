import type { Sources } from '../../src/check.js';

export const MAL = { id: 'MAL-1', summary: 'stealer', affected: [{ package: { name: 'evil' }, versions: ['1.0.0'] }] };

/** In-memory sources: `evil@1.0.0` is malware, `nope` does not exist, `flaky` throws, anything else is clean. */
export const stubSources: Sources = {
  osv: {
    queryPackage: async (name) => (name === 'evil' ? [MAL] : []),
    queryBatch: async (refs) => refs.map((r) => (r.name === 'evil' ? [MAL] : [])),
  },
  npm: {
    getPackage: async (name) => {
      if (name === 'nope') return { exists: false, distTags: {}, versions: [] };
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
  },
};
