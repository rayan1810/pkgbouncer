import semver from 'semver';
import type { PackageFacts } from './types.js';
import { vulnAffectsVersion, isMalware, vulnSeverity } from './osv-match.js';
import { compareVersions, isPrerelease, isValidVersion, maxSatisfying, satisfies } from './versions.js';

/** Translate poetry-style ^ and ~ specs into PEP 440 clauses. */
function poetryToPep440(spec: string): string {
  const m = /^([\^~])(\d+(?:\.\d+)*)$/.exec(spec.trim());
  if (!m) return spec;
  const parts = m[2].split('.').map(Number);
  if (m[1] === '^') {
    const idx = parts.findIndex((n) => n !== 0);
    const bump = idx === -1 ? 0 : idx;
    const upper = parts.slice(0, bump + 1);
    upper[bump] += 1;
    return `>=${m[2]},<${upper.join('.')}`;
  }
  const upper = parts.length === 1 ? [parts[0] + 1] : [...parts.slice(0, -1)];
  upper[upper.length - 1] += 1;
  return `>=${m[2]},<${upper.join('.')}`;
}

/** Resolve a spec (undefined, tag, exact version, or range) to a published version, or null. */
export function resolveVersion(spec: string | undefined, facts: PackageFacts): string | null {
  const eco = facts.ref.ecosystem;
  const versions = facts.versions.map((v) => v.version);
  if (!spec || spec === 'latest') return facts.distTags.latest ?? maxSatisfying(eco, versions, '') ?? null;
  if (facts.distTags[spec]) return facts.distTags[spec];

  if (eco === 'PyPI') {
    const s = poetryToPep440(spec);
    const exact = /^==\s*([^*,\s]+)$/.exec(s);
    if (exact) return versions.find((v) => satisfies(eco, v, `==${exact[1]}`)) ?? null;
    if (isValidVersion(eco, s)) return versions.find((v) => compareVersions(eco, v, s) === 0) ?? null;
    return maxSatisfying(eco, versions, s);
  }

  if (isValidVersion(eco, spec)) return versions.find((v) => compareVersions(eco, v, spec) === 0) ?? null;
  // Prefer stable; if the range only matches prereleases (typical for 0.0.1-security placeholder
  // versions that npm publishes over removed malware), fall back so the malware rule can see it.
  if (eco === 'npm' && semver.validRange(spec)) {
    return semver.maxSatisfying(versions, spec, { includePrerelease: false }) ?? semver.maxSatisfying(versions, spec, { includePrerelease: true });
  }
  return maxSatisfying(eco, versions, spec) ?? maxSatisfying(eco, versions, spec, true);
}

export function ageDays(publishedAt: string | null, now: number): number | null {
  if (!publishedAt) return null;
  const t = new Date(publishedAt).getTime();
  if (Number.isNaN(t)) return null;
  return (now - t) / 86_400_000;
}

/** Highest stable version with no malware, no CRITICAL/HIGH advisory, and age >= minAgeDays. */
export function suggestSafeVersion(facts: PackageFacts, minAgeDays: number, now: number = Date.now()): string | null {
  const eco = facts.ref.ecosystem;
  const candidates = facts.versions
    .filter((v) => isValidVersion(eco, v.version) && !isPrerelease(eco, v.version))
    .filter((v) => {
      const a = ageDays(v.publishedAt, now);
      return a !== null && a >= minAgeDays;
    })
    .filter(
      (v) =>
        !facts.vulns.some(
          (vuln) => vulnAffectsVersion(vuln, facts.ref.name, v.version, eco) && (isMalware(vuln) || ['CRITICAL', 'HIGH'].includes(vulnSeverity(vuln))),
        ),
    )
    .map((v) => v.version)
    .sort((a, b) => compareVersions(eco, b, a));
  return candidates[0] ?? null;
}
