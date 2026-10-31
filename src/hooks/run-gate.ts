import { checkPackage, defaultSources, scanRefs, type Sources } from '../check.js';
import { detectBareInstall, parseInstallCommand, projectDirFromCommand } from '../core/parse-command.js';
import { maxAction, refKey, type Action, type Policy, type Verdict } from '../core/types.js';
import { formatVerdicts } from '../format.js';
import { diffSinceSnapshot, pendingDirectDeps, takeSnapshot } from './install-watch.js';

export interface GateResult {
  action: Action;
  text: string;
  verdicts: Verdict[];
}

export interface GateOptions {
  /** Directory the command runs in. Defaults to process.cwd(). */
  cwd?: string;
  /** Skip lockfile snapshots (unit tests). */
  noSnapshot?: boolean;
}

const ALLOW: GateResult = { action: 'allow', text: '', verdicts: [] };

/**
 * Pre-install gate. Checks every package the command names, plus, for a bare
 * npm-family install, every package.json dependency the lockfile does not yet
 * satisfy. Snapshots the lockfile so the post-install diff can run.
 */
export async function runGate(command: string, policy: Policy, sources: Sources = defaultSources(), opts: GateOptions = {}): Promise<GateResult> {
  const refs = parseInstallCommand(command);
  const bare = detectBareInstall(command);
  if (refs.length === 0 && !bare) return ALLOW;

  const dir = projectDirFromCommand(command, opts.cwd ?? process.cwd());
  if (!opts.noSnapshot) takeSnapshot(dir);

  let pendingCount = 0;
  if (bare === 'npm') {
    const pending = pendingDirectDeps(dir);
    pendingCount = pending.length;
    const seen = new Set(refs.map(refKey));
    for (const p of pending) if (!seen.has(refKey(p))) refs.push(p);
  }
  if (refs.length === 0) return ALLOW;

  const verdicts = await Promise.all(refs.map((r) => checkPackage(r, policy, sources)));
  const flagged = verdicts.filter((v) => v.findings.length > 0);
  const action = maxAction(verdicts.map((v) => v.action));
  let text = flagged.length ? formatVerdicts(flagged) : '';
  if (flagged.length && pendingCount) text = `[pkgbouncer] ${pendingCount} package.json dependenc${pendingCount === 1 ? 'y is' : 'ies are'} not yet in the lockfile; checked before install.\n` + text;
  if (action === 'deny') text += '\nInstall blocked by pkgbouncer. Use the suggested safe version or a different package, then retry.';
  return { action, text, verdicts };
}

/**
 * Post-install check. Diffs the lockfile against the pre-install snapshot and
 * scans only what the install added, which covers transitive dependencies.
 */
export async function runPostGate(command: string, _policy: Policy, sources: Sources = defaultSources(), opts: GateOptions = {}): Promise<GateResult> {
  const refs = parseInstallCommand(command);
  const bare = detectBareInstall(command);
  if (refs.length === 0 && !bare) return ALLOW;

  const dir = projectDirFromCommand(command, opts.cwd ?? process.cwd());
  const added = diffSinceSnapshot(dir);
  if (!added || added.length === 0) return ALLOW;

  const hits = await scanRefs(added, sources);
  if (hits.length === 0) return ALLOW;

  const action = maxAction(hits.map((h) => h.action));
  const names = hits.map((h) => `${h.ref.name}@${h.ref.spec}`).join(', ');
  let text = `[pkgbouncer] The install added ${added.length} package(s); ${hits.length} flagged:\n` + formatVerdicts(hits);
  if (action === 'deny') {
    text += `\nThese came in as dependencies and are now in the lockfile. Remove or pin them before continuing (e.g. uninstall the package that pulled in ${names}, or add an override to a safe version), then rerun pkgbouncer scan.`;
  }
  return { action, text, verdicts: hits };
}

export async function readStdinJson<T>(): Promise<T | null> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
