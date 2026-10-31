import { POPULAR_NPM, POPULAR_PYPI, POPULAR_CRATES } from './popular.js';
import type { Ecosystem } from './types.js';

/** Optimal string alignment distance (Damerau-Levenshtein with adjacent transpositions). */
export function damerauLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

function stripScope(name: string): string {
  return name.replace(/^@[^/]+\//, '');
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[-_.]/g, '');
}

export function popularFor(eco: Ecosystem): Set<string> | null {
  if (eco === 'npm') return POPULAR_NPM;
  if (eco === 'PyPI') return POPULAR_PYPI;
  if (eco === 'crates.io') return POPULAR_CRATES;
  return null; // Go module paths are too long and structured for edit distance to mean anything
}

/**
 * Returns the popular package this name looks like a typo of, or null.
 * Separator-only differences (crossenv vs cross-env) count as distance 1.
 */
export function findTyposquatTarget(name: string, eco: Ecosystem = 'npm', popular: Set<string> | null = popularFor(eco)): string | null {
  if (!popular || popular.has(name)) return null;
  const bare = stripScope(name);
  if (bare.length < 4) return null;
  const maxDist = bare.length <= 6 ? 1 : 2;
  const norm = normalize(bare);
  let best: { target: string; dist: number } | null = null;
  for (const p of popular) {
    const pb = stripScope(p);
    if (Math.abs(pb.length - bare.length) > maxDist) continue;
    const raw = damerauLevenshtein(bare, pb);
    if (raw === 0) return null; // same bare name under a different scope: not a typo
    const dist = Math.min(raw, normalize(pb) === norm ? 1 : damerauLevenshtein(norm, normalize(pb)));
    if (dist <= maxDist && (!best || dist < best.dist)) best = { target: p, dist };
  }
  return best?.target ?? null;
}
