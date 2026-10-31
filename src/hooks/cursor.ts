import { runGate } from './run-gate.js';
import type { Sources } from '../check.js';
import type { Policy } from '../core/types.js';

/** Shape of the beforeShellExecution payload Cursor writes to the hook's stdin. */
export interface CursorHookInput {
  command?: string;
}

export interface CursorHookOutput {
  permission: 'allow' | 'deny';
  userMessage?: string;
  agentMessage?: string;
}

export async function cursorHook(input: CursorHookInput, policy: Policy, sources?: Sources): Promise<CursorHookOutput> {
  if (!input.command) return { permission: 'allow' };
  const r = await runGate(input.command, policy, sources);
  if (r.action === 'allow') return { permission: 'allow' };
  return { permission: r.action === 'deny' ? 'deny' : 'allow', userMessage: r.text, agentMessage: r.text };
}
