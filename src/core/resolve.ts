import semver from 'semver';
import type { PackageFacts } from './types.js';
import { vulnAffectsVersion, isMalware, vulnSeverity } from './osv-match.js';

/** Resolve a spec (undefined, tag, exact version, or range) to a published version, or null. */
export function resolveVersion(spec: string | undefined, facts: PackageFacts): string | null {
  const versions = facts.versions.map((v) => v.version);
  if (!spec || spec === 'latest') return facts.distTags.latest ?? semver.maxSatisfying(versions, '*') ?? null;
  if (facts.distTags[spec]) return facts.distTags[spec];
  if (semver.valid(spec)) return versions.includes(spec) ? spec : null;
  if (semver.validRange(spec)) return semver.maxSatisfying(versions, spec, { includePrerelease: false });
  return null;
}

export function ageDays(publishedAt: string | null, now: number): number | null {
  if (!publishedAt) return null;
  const t = new Date(publishedAt).getTime();
  if (Number.isNaN(t)) return null;
  return (now - t) / 86_400_000;
}

/** Highest stable version with no malware, no CRITICAL/HIGH advisory, and age >= minAgeDays. */
export function suggestSafeVersion(facts: PackageFacts, minAgeDays: number, now: number = Date.now()): string | null {
  const candidates = facts.versions
    .filter((v) => semver.valid(v.version) && !semver.prerelease(v.version))
    .filter((v) => {
      const a = ageDays(v.publishedAt, now);
      return a !== null && a >= minAgeDays;
    })
    .filter(
      (v) =>
        !facts.vulns.some(
          (vuln) => vulnAffectsVersion(vuln, facts.ref.name, v.version) && (isMalware(vuln) || ['CRITICAL', 'HIGH'].includes(vulnSeverity(vuln))),
        ),
    )
    .map((v) => v.version)
    .sort(semver.rcompare);
  return candidates[0] ?? null;
}
