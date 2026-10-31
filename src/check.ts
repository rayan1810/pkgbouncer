import type { RegistryMetadata } from './sources/registry.js';
import type { Ecosystem, Finding, OsvVuln, PackageFacts, PackageRef, Policy, Verdict } from './core/types.js';
import { evaluate } from './core/policy.js';
import { isMalware, vulnSeverity } from './core/osv-match.js';
import { resolveVersion } from './core/resolve.js';
import { OsvClient } from './sources/osv.js';
import { RegistryClient } from './sources/registry.js';

/** Injectable data sources so tests and alternative backends can replace the network clients. */
export interface Sources {
  osv: {
    queryPackage(name: string, ecosystem: Ecosystem): Promise<OsvVuln[]>;
    queryBatch(refs: { name: string; version: string; ecosystem: Ecosystem }[]): Promise<OsvVuln[][]>;
  };
  registry: {
    getPackage(ref: Pick<PackageRef, 'ecosystem' | 'name'>): Promise<RegistryMetadata>;
    getVersionTime(ref: Pick<PackageRef, 'ecosystem' | 'name'>, version: string): Promise<string | null>;
  };
}

export function defaultSources(): Sources {
  return { osv: new OsvClient(), registry: new RegistryClient() };
}

/** Fetch registry metadata and advisories in parallel. Never throws; failures land in `sourceErrors`. */
export async function gatherFacts(ref: PackageRef, sources: Sources): Promise<PackageFacts> {
  const sourceErrors: string[] = [];
  const [meta, vulns] = await Promise.all([
    sources.registry.getPackage(ref).catch((e: Error): RegistryMetadata => {
      sourceErrors.push(`registry: ${e.message}`);
      return { exists: true, distTags: {}, versions: [] };
    }),
    sources.osv.queryPackage(ref.name, ref.ecosystem).catch((e: Error): OsvVuln[] => {
      sourceErrors.push(`osv: ${e.message}`);
      return [];
    }),
  ]);
  const facts: PackageFacts = { ref, exists: meta.exists, distTags: meta.distTags, versions: meta.versions, vulns, sourceErrors };

  // Go publish times come one request per version; fetch only for the version we are about to judge.
  if (ref.ecosystem === 'Go' && facts.exists) {
    const resolved = resolveVersion(ref.spec, facts);
    const vf = resolved ? facts.versions.find((v) => v.version === resolved) : undefined;
    if (vf && vf.publishedAt === null) {
      vf.publishedAt = await sources.registry.getVersionTime(ref, vf.version).catch(() => null);
    }
  }
  return facts;
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
  if (pinned.length === 0) return [];
  const results = await sources.osv.queryBatch(pinned.map((r) => ({ name: r.name, version: r.spec, ecosystem: r.ecosystem })));
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
