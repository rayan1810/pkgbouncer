import semver from 'semver';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DEFAULT_POLICY, maxAction, type Finding, type PackageFacts, type Policy, type Verdict } from './types.js';
import { isMalware, vulnAffectsVersion, vulnSeverity } from './osv-match.js';
import { findTyposquatTarget } from './typosquat.js';
import { ageDays, resolveVersion, suggestSafeVersion } from './resolve.js';

/** Entries: `name`, `name@range`, or `@scope/*`. */
export function matchesList(list: string[], name: string, version: string | null): boolean {
  for (const entry of list) {
    const at = entry.indexOf('@', 1);
    const pat = at === -1 ? entry : entry.slice(0, at);
    const range = at === -1 ? null : entry.slice(at + 1);
    const nameOk = pat.endsWith('/*') ? name.startsWith(pat.slice(0, -1)) : pat === name;
    if (!nameOk) continue;
    if (!range) return true;
    if (version && semver.validRange(range) && semver.satisfies(version, range)) return true;
  }
  return false;
}

const REGISTRY_NAME: Record<PackageFacts['ref']['ecosystem'], string> = {
  npm: 'the npm registry',
  PyPI: 'PyPI',
  'crates.io': 'crates.io',
  Go: 'the Go module proxy',
};

function describe(id: string, summary?: string): string {
  return summary ? `${id}: ${summary}` : id;
}

export function evaluate(facts: PackageFacts, policy: Policy, now: number = Date.now()): Verdict {
  const { ref } = facts;
  const findings: Finding[] = [];
  const resolved = facts.exists ? resolveVersion(ref.spec, facts) : null;
  const done = (): Verdict => ({
    ref,
    resolvedVersion: resolved,
    action: maxAction(findings.map((f) => f.action)),
    findings,
    safeVersion: facts.exists ? suggestSafeVersion(facts, policy.minAgeDays, now) : null,
  });

  for (const err of facts.sourceErrors) {
    findings.push({
      rule: 'source-unavailable',
      action: policy.failClosed ? 'deny' : 'warn',
      message: `Could not reach a data source (${err}); verdict may be incomplete.`,
    });
  }
  if (matchesList(policy.deny, ref.name, resolved)) {
    findings.push({ rule: 'denylist', action: 'deny', message: `${ref.name} is on the policy denylist.` });
    return done();
  }
  if (matchesList(policy.allow, ref.name, resolved)) {
    return { ref, resolvedVersion: resolved, action: 'allow', findings: [], safeVersion: resolved };
  }
  if (!facts.exists) {
    const lookalike = findTyposquatTarget(ref.name, ref.ecosystem);
    findings.push({
      rule: 'nonexistent',
      action: 'deny',
      message: `${ref.name} does not exist on ${REGISTRY_NAME[ref.ecosystem]}. It may be a hallucinated name (slopsquatting target).${lookalike ? ` Did you mean "${lookalike}"?` : ' Verify the package name before installing.'}`,
      data: lookalike ? { lookalike } : undefined,
    });
    return done();
  }
  if (!resolved) {
    // Registry unreachable: we have no version data, so fail open/closed per policy rather than call it nonexistent.
    if (facts.versions.length === 0 && facts.sourceErrors.length > 0) return done();
    findings.push({ rule: 'nonexistent', action: 'deny', message: `${ref.name}@${ref.spec} matches no published version.` });
    return done();
  }

  const vf = facts.versions.find((v) => v.version === resolved);
  for (const vuln of facts.vulns) {
    if (!vulnAffectsVersion(vuln, ref.name, resolved, ref.ecosystem)) continue;
    if (isMalware(vuln)) {
      findings.push({
        rule: 'known-malicious',
        action: 'deny',
        message: `${ref.name}@${resolved} is a known malicious package (${describe(vuln.id, vuln.summary)}).`,
        data: { id: vuln.id },
      });
      continue;
    }
    const sev = vulnSeverity(vuln);
    if (sev === 'CRITICAL') {
      findings.push({
        rule: 'critical-advisory',
        action: 'deny',
        message: `${ref.name}@${resolved} has a CRITICAL advisory (${describe(vuln.id, vuln.summary)}).`,
        data: { id: vuln.id, severity: sev },
      });
    } else if (sev === 'HIGH') {
      findings.push({
        rule: 'critical-advisory',
        action: 'warn',
        message: `${ref.name}@${resolved} has a HIGH severity advisory (${describe(vuln.id, vuln.summary)}).`,
        data: { id: vuln.id, severity: sev },
      });
    }
  }

  const age = ageDays(vf?.publishedAt ?? null, now);
  if (age !== null && age < policy.minAgeDays) {
    const when = age < 1 ? 'less than a day' : `${Math.floor(age)} day(s)`;
    findings.push({
      rule: 'too-new',
      action: policy.strict ? 'deny' : 'warn',
      message: `${ref.name}@${resolved} was published ${when} ago (policy minimum ${policy.minAgeDays} days). Most malicious releases are reported within 3 days.`,
      data: { ageDays: age },
    });
  }

  const target = findTyposquatTarget(ref.name, ref.ecosystem);
  if (target) {
    findings.push({
      rule: 'typosquat',
      action: 'warn',
      message: `${ref.name} looks like a typo of the popular package "${target}". Confirm you meant ${ref.name}.`,
      data: { target },
    });
  }

  if (vf?.hasInstallScripts) {
    findings.push({
      rule: 'install-scripts',
      action: 'warn',
      message: `${ref.name}@${resolved} runs install scripts (preinstall/install/postinstall), the mechanism used by npm worms. Consider --ignore-scripts.`,
    });
  }
  return done();
}

export function pkgbouncerHome(): string {
  return process.env.PKGBOUNCER_HOME ?? join(homedir(), '.pkgbouncer');
}

/** Reads `pkgbouncer.json` in cwd, else `$PKGBOUNCER_HOME/policy.json`, else defaults. */
export function loadPolicy(cwd: string = process.cwd()): Policy {
  const candidates = [join(cwd, 'pkgbouncer.json'), join(pkgbouncerHome(), 'policy.json')];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      return { ...DEFAULT_POLICY, ...(JSON.parse(readFileSync(p, 'utf8')) as Partial<Policy>) };
    } catch {
      // ignore unreadable policy, fall through
    }
  }
  return { ...DEFAULT_POLICY };
}
