import type { Ecosystem, OsvVuln, Severity } from './types.js';
import { compareVersions, isValidVersion, normalizeVersion } from './versions.js';

export function isMalware(v: OsvVuln): boolean {
  return v.id.startsWith('MAL-') || (v.aliases ?? []).some((a) => a.startsWith('MAL-'));
}

function sameVersion(eco: Ecosystem, a: string, b: string): boolean {
  if (a === b) return true;
  return isValidVersion(eco, a) && isValidVersion(eco, b) && compareVersions(eco, a, b) === 0;
}

/** True if the OSV record lists `name@version` as affected (explicit versions or SEMVER/ECOSYSTEM ranges). */
export function vulnAffectsVersion(v: OsvVuln, name: string, version: string, eco: Ecosystem = 'npm'): boolean {
  if (!isValidVersion(eco, version)) return false;
  const cmp = (a: string, b: string) => compareVersions(eco, a, b);
  for (const a of v.affected ?? []) {
    if (a.package?.name && normalizeName(eco, a.package.name) !== normalizeName(eco, name)) continue;
    if (a.versions?.some((x) => sameVersion(eco, x, version))) return true;
    for (const r of a.ranges ?? []) {
      if (r.type !== 'SEMVER' && r.type !== 'ECOSYSTEM') continue;
      let introduced: string | null = null;
      let open = false;
      for (const e of r.events) {
        if (e.introduced !== undefined) {
          introduced = e.introduced;
          open = true;
          continue;
        }
        const lowerOk = open && (introduced === '0' || introduced === null || !isValidVersion(eco, introduced) || cmp(version, introduced) >= 0);
        if (e.fixed !== undefined) {
          if (lowerOk && isValidVersion(eco, e.fixed) && cmp(version, e.fixed) < 0) return true;
          open = false;
        } else if (e.last_affected !== undefined) {
          if (lowerOk && isValidVersion(eco, e.last_affected) && cmp(version, e.last_affected) <= 0) return true;
          open = false;
        }
      }
      if (open && (introduced === '0' || introduced === null || !isValidVersion(eco, introduced) || cmp(version, introduced) >= 0)) return true;
    }
  }
  return false;
}

function normalizeName(eco: Ecosystem, name: string): string {
  if (eco === 'PyPI') return name.toLowerCase().replace(/[-_.]+/g, '-');
  if (eco === 'crates.io') return name.toLowerCase().replace(/_/g, '-');
  return name;
}

export function vulnSeverity(v: OsvVuln): Severity {
  const ds = v.database_specific?.severity?.toUpperCase();
  if (ds === 'CRITICAL' || ds === 'HIGH' || ds === 'MODERATE' || ds === 'LOW') return ds;
  if (ds === 'MEDIUM') return 'MODERATE';
  const cvss = v.severity?.find((s) => s.type.startsWith('CVSS'));
  if (cvss) {
    const m = /\/C:(\w)\/I:(\w)\/A:(\w)/.exec(cvss.score);
    if (m) {
      const highs = m.slice(1).filter((x) => x === 'H').length;
      if (highs >= 2 && /AV:N/.test(cvss.score) && /PR:N/.test(cvss.score)) return 'CRITICAL';
      if (highs >= 1) return 'HIGH';
      return 'MODERATE';
    }
  }
  return 'UNKNOWN';
}

export { normalizeVersion };
