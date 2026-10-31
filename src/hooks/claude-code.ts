import { runGate } from './run-gate.js';
import type { Sources } from '../check.js';
import type { Policy } from '../core/types.js';

/** Shape of the PreToolUse payload Claude Code writes to the hook's stdin. */
export interface ClaudeHookInput {
  tool_name?: string;
  tool_input?: { command?: string };
}

/** Exit 2 blocks the tool call and shows stderr to the model; exit 0 allows. */
export interface HookOutcome {
  exitCode: 0 | 2;
  stderr: string;
}

export async function claudeCodeHook(input: ClaudeHookInput, policy: Policy, sources?: Sources): Promise<HookOutcome> {
  if (input.tool_name !== 'Bash' || !input.tool_input?.command) return { exitCode: 0, stderr: '' };
  const r = await runGate(input.tool_input.command, policy, sources);
  return { exitCode: r.action === 'deny' ? 2 : 0, stderr: r.text };
}
