import type { PackageRef } from './types.js';

const MANAGERS: Record<string, Set<string>> = {
  npm: new Set(['install', 'i', 'add', 'in', 'ins', 'inst', 'isntall']),
  pnpm: new Set(['add', 'install', 'i']),
  yarn: new Set(['add']),
  bun: new Set(['add', 'install', 'i']),
};

function splitSegments(command: string): string[] {
  return command.split(/\s*(?:&&|\|\||;|\||\n)\s*/).filter(Boolean);
}

function tokenize(segment: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function isPackageArg(tok: string): boolean {
  if (tok.startsWith('-')) return false;
  if (/^(\.|\/|~|file:|https?:|git\+|github:|gitlab:|bitbucket:|[A-Za-z]:[\\/])/.test(tok)) return false;
  if (/\.(tgz|tar\.gz)$/.test(tok)) return false;
  return /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@.+)?$/i.test(tok);
}

export function splitNameSpec(tok: string): { name: string; spec?: string } {
  const at = tok.indexOf('@', 1);
  if (at === -1) return { name: tok };
  return { name: tok.slice(0, at), spec: tok.slice(at + 1) };
}

/** Extract package refs from a shell command that installs npm packages. */
export function parseInstallCommand(command: string): PackageRef[] {
  const refs: PackageRef[] = [];
  for (const seg of splitSegments(command)) {
    const toks = tokenize(seg);
    if (toks.length < 2) continue;
    const bin = toks[0].replace(/^.*[\\/]/, '');
    let pkgToks: string[] = [];
    if (bin === 'npx' || bin === 'pnpx' || bin === 'bunx') {
      const first = toks.slice(1).find((t) => !t.startsWith('-'));
      if (first) pkgToks = [first];
    } else if (MANAGERS[bin]?.has(toks[1])) {
      pkgToks = toks.slice(2);
    } else continue;
    for (const t of pkgToks) {
      if (!isPackageArg(t)) continue;
      const { name, spec } = splitNameSpec(t);
      refs.push({ ecosystem: 'npm', name, spec });
    }
  }
  return refs;
}
