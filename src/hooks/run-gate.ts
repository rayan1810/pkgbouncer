import { checkPackage, defaultSources, type Sources } from '../check.js';
import { parseInstallCommand } from '../core/parse-command.js';
import { maxAction, type Action, type Policy, type Verdict } from '../core/types.js';
import { formatVerdicts } from '../format.js';

export interface GateResult {
  action: Action;
  text: string;
  verdicts: Verdict[];
}

/** Gate a shell command: parse package refs, check each, summarize flagged ones. */
export async function runGate(command: string, policy: Policy, sources: Sources = defaultSources()): Promise<GateResult> {
  const refs = parseInstallCommand(command);
  if (refs.length === 0) return { action: 'allow', text: '', verdicts: [] };
  const verdicts = await Promise.all(refs.map((r) => checkPackage(r, policy, sources)));
  const flagged = verdicts.filter((v) => v.findings.length > 0);
  const action = maxAction(verdicts.map((v) => v.action));
  let text = flagged.length ? formatVerdicts(flagged) : '';
  if (action === 'deny') text += '\nInstall blocked by Guardian. Use the suggested safe version or a different package, then retry.';
  return { action, text, verdicts };
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
