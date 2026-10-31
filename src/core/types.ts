export type Ecosystem = 'npm';
export type Action = 'allow' | 'warn' | 'deny';

export interface PackageRef {
  ecosystem: Ecosystem;
  name: string;
  /** Raw spec as written: "1.2.3", "^1.0.0", "latest", or undefined. */
  spec?: string;
}

export type Rule =
  | 'known-malicious'
  | 'critical-advisory'
  | 'nonexistent'
  | 'too-new'
  | 'typosquat'
  | 'install-scripts'
  | 'denylist'
  | 'source-unavailable';

export interface Finding {
  rule: Rule;
  action: Action;
  message: string;
  data?: Record<string, unknown>;
}

export interface Verdict {
  ref: PackageRef;
  resolvedVersion: string | null;
  action: Action;
  findings: Finding[];
  safeVersion: string | null;
}

export interface Policy {
  minAgeDays: number;
  strict: boolean;
  failClosed: boolean;
  allow: string[];
  deny: string[];
}

export const DEFAULT_POLICY: Policy = { minAgeDays: 3, strict: false, failClosed: false, allow: [], deny: [] };

export type Severity = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' | 'UNKNOWN';

export interface OsvEvent { introduced?: string; fixed?: string; last_affected?: string }
export interface OsvAffected {
  package?: { ecosystem?: string; name?: string };
  versions?: string[];
  ranges?: { type: string; events: OsvEvent[] }[];
}
export interface OsvVuln {
  id: string;
  summary?: string;
  aliases?: string[];
  affected?: OsvAffected[];
  database_specific?: { severity?: string };
  severity?: { type: string; score: string }[];
}

export interface VersionFacts {
  version: string;
  publishedAt: string | null;
  hasInstallScripts: boolean;
}

export interface PackageFacts {
  ref: PackageRef;
  exists: boolean;
  versions: VersionFacts[];
  distTags: Record<string, string>;
  vulns: OsvVuln[];
  sourceErrors: string[];
}

export const ACTION_RANK: Record<Action, number> = { allow: 0, warn: 1, deny: 2 };
export function maxAction(actions: Action[]): Action {
  return actions.reduce<Action>((m, a) => (ACTION_RANK[a] > ACTION_RANK[m] ? a : m), 'allow');
}
