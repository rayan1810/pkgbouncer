import semver from 'semver';
import type { OsvVuln, Severity } from './types.js';

export function isMalware(v: OsvVuln): boolean {
  return v.id.startsWith('MAL-') || (v.aliases ?? []).some((a) => a.startsWith('MAL-'));
}

function gte(a: string, b: string): boolean {
  return semver.valid(b) ? semver.gte(a, b) : true;
}

/** True if the OSV record lists `name@version` as affected (explicit versions or SEMVER/ECOSYSTEM ranges). */
export function vulnAffectsVersion(v: OsvVuln, name: string, version: string): boolean {
  const ver = semver.valid(version) ?? semver.coerce(version, { includePrerelease: true })?.version ?? version;
  if (!semver.valid(ver)) return false;
  for (const a of v.affected ?? []) {
    if (a.package?.name && a.package.name !== name) continue;
    if (a.versions?.includes(version)) return true;
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
        const lowerOk = !open ? false : introduced === '0' || introduced === null ? true : gte(ver, introduced);
        if (e.fixed !== undefined) {
          if (lowerOk && semver.valid(e.fixed) && semver.lt(ver, e.fixed)) return true;
          open = false;
        } else if (e.last_affected !== undefined) {
          if (lowerOk && semver.valid(e.last_affected) && semver.lte(ver, e.last_affected)) return true;
          open = false;
        }
      }
      if (open && (introduced === '0' || introduced === null || gte(ver, introduced))) return true;
    }
  }
  return false;
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
