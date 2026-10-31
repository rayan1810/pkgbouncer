import type { NpmMetadata } from './sources/npm-registry.js';
import type { Finding, OsvVuln, PackageFacts, PackageRef, Policy, Verdict } from './core/types.js';
import { evaluate } from './core/policy.js';
import { isMalware, vulnSeverity } from './core/osv-match.js';
import { OsvClient } from './sources/osv.js';
import { NpmRegistryClient } from './sources/npm-registry.js';

/** Injectable data sources so tests and alternative backends can replace the network clients. */
export interface Sources {
  osv: {
    queryPackage(name: string): Promise<OsvVuln[]>;
    queryBatch(refs: { name: string; version: string }[]): Promise<OsvVuln[][]>;
  };
  npm: { getPackage(name: string): Promise<NpmMetadata> };
}

export function defaultSources(): Sources {
  return { osv: new OsvClient(), npm: new NpmRegistryClient() };
}

/** Fetch registry metadata and advisories in parallel. Never throws; failures land in `sourceErrors`. */
export async function gatherFacts(ref: PackageRef, sources: Sources): Promise<PackageFacts> {
  const sourceErrors: string[] = [];
  const [meta, vulns] = await Promise.all([
    sources.npm.getPackage(ref.name).catch((e: Error): NpmMetadata => {
      sourceErrors.push(`npm: ${e.message}`);
      return { exists: true, distTags: {}, versions: [] };
    }),
    sources.osv.queryPackage(ref.name).catch((e: Error): OsvVuln[] => {
      sourceErrors.push(`osv: ${e.message}`);
      return [];
    }),
  ]);
  return { ref, exists: meta.exists, distTags: meta.distTags, versions: meta.versions, vulns, sourceErrors };
}

export async function checkPackage(ref: PackageRef, policy: Policy, sources: Sources = defaultSources()): Promise<Verdict> {
  return evaluate(await gatherFacts(ref, sources), policy);
}

function describe(v: OsvVuln): string {
  return v.summary ? `${v.id}: ${v.summary}` : v.id;
}

/** Lockfile scan: pinned versions only, OSV only. Returns verdicts that have findings. */
export async function scanRefs(refs: PackageRef[], sources: Sources = defaultSources()): Promise<Verdict[]> {
  const pinned = refs.filter((r): r is PackageRef & { spec: string } => typeof r.spec === 'string');
  const results = await sources.osv.queryBatch(pinned.map((r) => ({ name: r.name, version: r.spec })));
  const out: Verdict[] = [];
  pinned.forEach((ref, i) => {
    const findings: Finding[] = [];
    for (const v of results[i] ?? []) {
      if (isMalware(v)) {
        findings.push({ rule: 'known-malicious', action: 'deny', message: `${ref.name}@${ref.spec} is a known malicious package (${describe(v)}).`, data: { id: v.id } });
        continue;
      }
      const sev = vulnSeverity(v);
      if (sev === 'CRITICAL') findings.push({ rule: 'critical-advisory', action: 'deny', message: `${ref.name}@${ref.spec} has a CRITICAL advisory (${describe(v)}).`, data: { id: v.id, severity: sev } });
      else if (sev === 'HIGH') findings.push({ rule: 'critical-advisory', action: 'warn', message: `${ref.name}@${ref.spec} has a HIGH severity advisory (${describe(v)}).`, data: { id: v.id, severity: sev } });
    }
    if (findings.length) {
      out.push({ ref, resolvedVersion: ref.spec, action: findings.some((f) => f.action === 'deny') ? 'deny' : 'warn', findings, safeVersion: null });
    }
  });
  return out;
}
