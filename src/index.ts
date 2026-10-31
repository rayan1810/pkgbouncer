export * from './core/types.js';
export { checkPackage, scanRefs, defaultSources, gatherFacts, type Sources } from './check.js';
export { evaluate, loadPolicy, matchesList } from './core/policy.js';
export { parseInstallCommand, splitNameSpec } from './core/parse-command.js';
export { findLockfile, parseLockfile } from './core/lockfile.js';
export { formatVerdict, formatVerdicts } from './format.js';
export { runGate } from './hooks/run-gate.js';
