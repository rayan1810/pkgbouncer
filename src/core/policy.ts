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
    findings.push({
      rule: 'nonexistent',
      action: 'deny',
      message: `${ref.name} does not exist on the npm registry. It may be a hallucinated name (slopsquatting target). Verify the package name before installing.`,
    });
    return done();
  }
  if (!resolved) {
    findings.push({ rule: 'nonexistent', action: 'deny', message: `${ref.name}@${ref.spec} matches no published version.` });
    return done();
  }

  const vf = facts.versions.find((v) => v.version === resolved);
  for (const vuln of facts.vulns) {
    if (!vulnAffectsVersion(vuln, ref.name, resolved)) continue;
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

  const target = findTyposquatTarget(ref.name);
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

export function guardianHome(): string {
  return process.env.GUARDIAN_HOME ?? join(homedir(), '.guardian');
}

/** Reads `guardian.json` in cwd, else `$GUARDIAN_HOME/policy.json`, else defaults. */
export function loadPolicy(cwd: string = process.cwd()): Policy {
  const candidates = [join(cwd, 'guardian.json'), join(guardianHome(), 'policy.json')];
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
