import semver from 'semver';
import type { Ecosystem } from './types.js';

/*
 * Per-ecosystem version semantics.
 * npm and crates.io are semver. Go is semver with a leading "v".
 * PyPI is PEP 440; we implement the subset that matters for ordering and specifiers.
 */

export function normalizeVersion(eco: Ecosystem, v: string): string {
  if (eco === 'Go') return v.replace(/^v/, '');
  if (eco === 'PyPI') return v.trim().toLowerCase();
  return v;
}

// ---------- PEP 440-lite ----------

interface Pep440 {
  release: number[];
  /** -2 dev, -1 pre, 0 final, 1 post. */
  stage: number;
  preKind: number; // a=0 b=1 rc=2
  preNum: number;
  postNum: number;
  devNum: number;
}

const PEP440_RE = /^v?(\d+(?:\.\d+)*)(?:(a|b|rc|alpha|beta|c|pre|preview)\.?(\d*))?(?:[.\-_]?(post|rev|r)\.?(\d*))?(?:[.\-_]?dev\.?(\d*))?(?:\+[a-z0-9.]+)?$/i;

export function parsePep440(v: string): Pep440 | null {
  const m = PEP440_RE.exec(v.trim());
  if (!m) return null;
  const release = m[1].split('.').map(Number);
  while (release.length > 1 && release[release.length - 1] === 0) release.pop();
  const preMap: Record<string, number> = { a: 0, alpha: 0, b: 1, beta: 1, rc: 2, c: 2, pre: 2, preview: 2 };
  const hasPre = m[2] !== undefined;
  const hasPost = m[4] !== undefined;
  const hasDev = m[6] !== undefined;
  let stage = 0;
  if (hasDev && !hasPre && !hasPost) stage = -2;
  else if (hasPre) stage = -1;
  else if (hasPost) stage = 1;
  return {
    release,
    stage,
    preKind: hasPre ? preMap[m[2].toLowerCase()] : 0,
    preNum: hasPre ? Number(m[3] || 0) : 0,
    postNum: hasPost ? Number(m[5] || 0) : 0,
    devNum: hasDev ? Number(m[7] || 0) : 0,
  };
}

function cmpNum(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePep440(a: Pep440, b: Pep440): number {
  const n = Math.max(a.release.length, b.release.length);
  for (let i = 0; i < n; i++) {
    const c = cmpNum(a.release[i] ?? 0, b.release[i] ?? 0);
    if (c !== 0) return c;
  }
  if (a.stage !== b.stage) return cmpNum(a.stage, b.stage);
  if (a.stage === -1) {
    return cmpNum(a.preKind, b.preKind) || cmpNum(a.preNum, b.preNum) || cmpNum(a.postNum, b.postNum) || cmpNum(a.devNum, b.devNum);
  }
  if (a.stage === 1) return cmpNum(a.postNum, b.postNum) || cmpNum(a.devNum, b.devNum);
  if (a.stage === -2) return cmpNum(a.devNum, b.devNum);
  return 0;
}

// ---------- public API ----------

export function isValidVersion(eco: Ecosystem, v: string): boolean {
  if (eco === 'PyPI') return parsePep440(v) !== null;
  return semver.valid(normalizeVersion(eco, v)) !== null;
}

export function isPrerelease(eco: Ecosystem, v: string): boolean {
  if (eco === 'PyPI') {
    const p = parsePep440(v);
    return p !== null && p.stage < 0;
  }
  const n = normalizeVersion(eco, v);
  return semver.valid(n) !== null && (semver.prerelease(n)?.length ?? 0) > 0;
}

/** Negative if a < b, 0 if equal, positive if a > b. Invalid versions sort first. */
export function compareVersions(eco: Ecosystem, a: string, b: string): number {
  if (eco === 'PyPI') {
    const pa = parsePep440(a);
    const pb = parsePep440(b);
    if (!pa || !pb) return cmpNum(pa ? 1 : 0, pb ? 1 : 0);
    return comparePep440(pa, pb);
  }
  const na = normalizeVersion(eco, a);
  const nb = normalizeVersion(eco, b);
  const va = semver.valid(na);
  const vb = semver.valid(nb);
  if (!va || !vb) return cmpNum(va ? 1 : 0, vb ? 1 : 0);
  return semver.compare(va, vb);
}

function satisfiesPep440(version: string, spec: string): boolean {
  const v = parsePep440(version);
  if (!v) return false;
  const clauses = spec.split(',').map((c) => c.trim()).filter(Boolean);
  for (const clause of clauses) {
    const m = /^(===|==|!=|<=|>=|<|>|~=)\s*(.+)$/.exec(clause);
    if (!m) return false;
    const [, op, rawTarget] = m;
    const wildcard = rawTarget.endsWith('.*');
    const target = parsePep440(wildcard ? rawTarget.slice(0, -2) : rawTarget);
    if (!target) return false;
    const prefixMatch = () => target.release.every((n, i) => (v.release[i] ?? 0) === n);
    const c = comparePep440(v, target);
    let ok: boolean;
    switch (op) {
      case '==':
      case '===':
        ok = wildcard ? prefixMatch() : c === 0;
        break;
      case '!=':
        ok = wildcard ? !prefixMatch() : c !== 0;
        break;
      case '>=':
        ok = c >= 0;
        break;
      case '<=':
        ok = c <= 0;
        break;
      case '>':
        ok = c > 0;
        break;
      case '<':
        ok = c < 0;
        break;
      case '~=': {
        // ~=1.4.2 means >=1.4.2, ==1.4.*
        if (c < 0) return false;
        const upper = { ...target, release: target.release.slice(0, -1), stage: 0, preKind: 0, preNum: 0, postNum: 0, devNum: 0 };
        ok = upper.release.length === 0 ? true : upper.release.every((n, i) => (v.release[i] ?? 0) === n);
        break;
      }
      default:
        ok = false;
    }
    if (!ok) return false;
  }
  return true;
}

/** Does `version` satisfy `spec` under the ecosystem's rules? Empty spec matches everything. */
export function satisfies(eco: Ecosystem, version: string, spec: string): boolean {
  if (!spec.trim()) return true;
  if (eco === 'PyPI') return satisfiesPep440(version, spec);
  const v = semver.valid(normalizeVersion(eco, version));
  if (!v) return false;
  const range = normalizeVersion(eco, spec);
  if (semver.valid(range)) return semver.eq(v, range);
  // crates: "1.0" means caret, same as cargo. semver's loose parsing handles "1.0" as ">=1.0.0 <2.0.0" via ^ when we prefix it.
  const r = eco === 'crates.io' && /^\d/.test(range) ? `^${range}` : range;
  return semver.validRange(r) !== null && semver.satisfies(v, r, { includePrerelease: true });
}

/** Highest version in `versions` satisfying `spec` (stable preferred), or null. */
export function maxSatisfying(eco: Ecosystem, versions: string[], spec: string, allowPrerelease = false): string | null {
  const ok = versions.filter((v) => isValidVersion(eco, v) && satisfies(eco, v, spec) && (allowPrerelease || !isPrerelease(eco, v)));
  if (ok.length === 0) return null;
  return ok.sort((a, b) => compareVersions(eco, b, a))[0];
}
