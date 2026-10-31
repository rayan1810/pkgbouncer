import type { Verdict } from './core/types.js';

const LABEL = { allow: 'OK', warn: 'WARN', deny: 'BLOCKED' } as const;

export function formatVerdict(v: Verdict): string {
  const version = v.resolvedVersion ?? v.ref.spec;
  const head = `[pkgbouncer] ${LABEL[v.action]} ${v.ref.name}${version ? '@' + version : ''}`;
  if (v.findings.length === 0) return head;
  const lines = v.findings.map((f) => `  - (${f.rule}) ${f.message}`);
  if (v.action === 'deny' && v.source !== 'scan') {
    if (v.safeVersion) lines.push(`  -> Suggested safe version: ${v.ref.name}@${v.safeVersion}`);
    else if (v.findings.some((f) => f.rule !== 'nonexistent')) lines.push('  -> No safe version found; pick a different package.');
  }
  return [head, ...lines].join('\n');
}

export function formatVerdicts(vs: Verdict[]): string {
  return vs.map(formatVerdict).join('\n');
}
