import { runGate, runPostGate, type GateOptions } from './run-gate.js';
import type { Sources } from '../check.js';
import type { Policy } from '../core/types.js';

/** Shape of the PreToolUse / PostToolUse payload Claude Code writes to the hook's stdin. */
export interface ClaudeHookInput {
  hook_event_name?: 'PreToolUse' | 'PostToolUse' | string;
  tool_name?: string;
  tool_input?: { command?: string };
  cwd?: string;
}

/** Exit 2 blocks the tool call (Pre) or feeds stderr back to the model (Post); exit 0 allows. */
export interface HookOutcome {
  exitCode: 0 | 2;
  stderr: string;
}

export async function claudeCodeHook(input: ClaudeHookInput, policy: Policy, sources?: Sources, opts: GateOptions = {}): Promise<HookOutcome> {
  if (input.tool_name !== 'Bash' || !input.tool_input?.command) return { exitCode: 0, stderr: '' };
  const gateOpts: GateOptions = { cwd: input.cwd, ...opts };
  const post = input.hook_event_name === 'PostToolUse';
  const r = post ? await runPostGate(input.tool_input.command, policy, sources, gateOpts) : await runGate(input.tool_input.command, policy, sources, gateOpts);
  return { exitCode: r.action === 'deny' ? 2 : 0, stderr: r.text };
}
