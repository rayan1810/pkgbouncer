import { resolve as resolvePath, isAbsolute } from 'node:path';
import type { Ecosystem, PackageRef } from './types.js';

/*
 * Turns a shell command into the package refs it would install, and detects
 * lockfile-driven ("bare") installs. Pure string work, no filesystem.
 */

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

function binName(tok: string): string {
  return tok.replace(/^.*[\\/]/, '').replace(/\.(exe|cmd)$/i, '');
}

const LOCAL_RE = /^(\.|\/|~|file:|https?:|git\+|github:|gitlab:|bitbucket:|[A-Za-z]:[\\/])/;

// ---------- npm ----------

const NPM_ADD: Record<string, Set<string>> = {
  npm: new Set(['install', 'i', 'add', 'in', 'ins', 'inst', 'isntall']),
  pnpm: new Set(['add', 'install', 'i']),
  yarn: new Set(['add']),
  bun: new Set(['add', 'install', 'i']),
};

function isNpmPackageArg(tok: string): boolean {
  if (tok.startsWith('-') || LOCAL_RE.test(tok) || /\.(tgz|tar\.gz)$/.test(tok)) return false;
  return /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@.+)?$/i.test(tok);
}

export function splitNameSpec(tok: string): { name: string; spec?: string } {
  const at = tok.indexOf('@', 1);
  if (at === -1) return { name: tok };
  return { name: tok.slice(0, at), spec: tok.slice(at + 1) };
}

// ---------- PyPI ----------

/** PEP 503 normalization: lowercase, runs of -_. become -. */
export function normalizePyPiName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

function parsePyPiArg(tok: string): PackageRef | null {
  if (tok.startsWith('-') || LOCAL_RE.test(tok) || /\.(whl|tar\.gz|zip)$/.test(tok) || tok.includes('://')) return null;
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*((?:===|==|!=|<=|>=|<|>|~=|@).*)?$/.exec(tok);
  if (!m) return null;
  let spec = m[3]?.trim();
  if (spec?.startsWith('@')) spec = spec.slice(1); // poetry style rich@^13
  return { ecosystem: 'PyPI', name: normalizePyPiName(m[1]), spec: spec || undefined };
}

function pipArgs(toks: string[]): string[] {
  // skip values of flags that take arguments
  const takesValue = new Set(['-r', '--requirement', '-c', '--constraint', '-e', '--editable', '-i', '--index-url', '--extra-index-url', '-f', '--find-links', '-t', '--target', '--python']);
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (takesValue.has(t)) { i++; continue; }
    if (t.startsWith('-')) continue;
    out.push(t);
  }
  return out;
}

// ---------- crates ----------

function parseCrateArg(tok: string): PackageRef | null {
  if (tok.startsWith('-') || LOCAL_RE.test(tok)) return null;
  const m = /^([A-Za-z0-9_-]+)(?:@(.+))?$/.exec(tok);
  if (!m) return null;
  return { ecosystem: 'crates.io', name: m[1], spec: m[2] };
}

// ---------- Go ----------

function parseGoArg(tok: string): PackageRef | null {
  if (tok.startsWith('-') || tok.startsWith('.') || tok.startsWith('/') || !tok.includes('.')) return null;
  const at = tok.indexOf('@');
  const name = at === -1 ? tok : tok.slice(0, at);
  const spec = at === -1 ? undefined : tok.slice(at + 1);
  if (!/^[a-z0-9.\-]+\.[a-z]+\//i.test(name)) return null; // must look like host/path
  return { ecosystem: 'Go', name: name.replace(/\/\.\.\.$/, ''), spec };
}

// ---------- dispatch ----------

interface Invocation { bin: string; sub: string | undefined; rest: string[] }

function invocation(toks: string[]): Invocation | null {
  if (toks.length === 0) return null;
  let i = 0;
  // allow env assignments and sudo prefixes
  while (i < toks.length && (/^[A-Z_][A-Z0-9_]*=/.test(toks[i]) || toks[i] === 'sudo')) i++;
  if (i >= toks.length) return null;
  let bin = binName(toks[i]);
  i++;
  // python -m pip ...
  if (/^python(3(\.\d+)?)?$/.test(bin) && toks[i] === '-m' && (toks[i + 1] === 'pip' || toks[i + 1] === 'pip3')) {
    bin = 'pip';
    i += 2;
  }
  return { bin, sub: toks[i], rest: toks.slice(i + 1) };
}

export function parseInstallCommand(command: string): PackageRef[] {
  const refs: PackageRef[] = [];
  for (const seg of splitSegments(command)) {
    const inv = invocation(tokenize(seg));
    if (!inv) continue;
    const { bin, sub, rest } = inv;

    if (bin === 'npx' || bin === 'pnpx' || bin === 'bunx') {
      const first = [sub, ...rest].find((t) => t && !t.startsWith('-'));
      if (first && isNpmPackageArg(first)) refs.push({ ecosystem: 'npm', ...splitNameSpec(first) });
      continue;
    }
    if (bin in NPM_ADD) {
      if (!sub || !NPM_ADD[bin].has(sub)) continue;
      for (const t of rest) if (isNpmPackageArg(t)) refs.push({ ecosystem: 'npm', ...splitNameSpec(t) });
      continue;
    }
    if (/^pip3?$/.test(bin) && sub === 'install') {
      for (const t of pipArgs(rest)) { const r = parsePyPiArg(t); if (r) refs.push(r); }
      continue;
    }
    if (bin === 'uv' && (sub === 'add' || (sub === 'pip' && rest[0] === 'install'))) {
      const args = sub === 'add' ? rest : rest.slice(1);
      for (const t of pipArgs(args)) { const r = parsePyPiArg(t); if (r) refs.push(r); }
      continue;
    }
    if ((bin === 'poetry' && sub === 'add') || (bin === 'pipx' && sub === 'install') || (bin === 'pipenv' && sub === 'install')) {
      for (const t of pipArgs(rest)) { const r = parsePyPiArg(t); if (r) refs.push(r); }
      continue;
    }
    if (bin === 'cargo' && (sub === 'add' || sub === 'install')) {
      if (rest.includes('--path') || rest.includes('--git')) continue;
      const takesValue = new Set(['--features', '-F', '--rename', '--registry', '--target', '--package', '-p', '--manifest-path', '--root', '--version', '--vers', '--index', '--branch', '--tag', '--rev']);
      for (let i = 0; i < rest.length; i++) {
        if (takesValue.has(rest[i])) { i++; continue; }
        const r = parseCrateArg(rest[i]);
        if (r) refs.push(r);
      }
      continue;
    }
    if (bin === 'go' && (sub === 'get' || sub === 'install')) {
      for (const t of rest) { const r = parseGoArg(t); if (r) refs.push(r); }
      continue;
    }
  }
  return refs;
}

/**
 * Detects an install driven by a manifest/lockfile rather than named packages.
 * Returns the ecosystem whose lockfile will change, or null.
 */
export function detectBareInstall(command: string): Ecosystem | null {
  for (const seg of splitSegments(command)) {
    const inv = invocation(tokenize(seg));
    if (!inv) continue;
    const { bin, sub, rest } = inv;
    const named = parseInstallCommand(seg).length > 0;
    if (named) continue;
    if (bin === 'npm' && (sub === 'install' || sub === 'i' || sub === 'ci')) return 'npm';
    if (bin === 'pnpm' && (sub === 'install' || sub === 'i')) return 'npm';
    if (bin === 'yarn' && (sub === undefined || sub === 'install' || sub.startsWith('-'))) return 'npm';
    if (bin === 'bun' && (sub === 'install' || sub === 'i')) return 'npm';
    if (/^pip3?$/.test(bin) && sub === 'install' && (rest.includes('-r') || rest.includes('--requirement'))) return 'PyPI';
    if (bin === 'uv' && (sub === 'sync' || sub === 'lock' || (sub === 'pip' && rest[0] === 'sync'))) return 'PyPI';
    if (bin === 'poetry' && (sub === 'install' || sub === 'lock' || sub === 'update')) return 'PyPI';
    if (bin === 'cargo' && (sub === 'build' || sub === 'fetch' || sub === 'update' || sub === 'generate-lockfile')) return 'crates.io';
    if (bin === 'go' && sub === 'mod' && (rest[0] === 'download' || rest[0] === 'tidy')) return 'Go';
  }
  return null;
}

/** If the command starts with `cd <dir>`, return that dir resolved against cwd; else cwd. */
export function projectDirFromCommand(command: string, cwd: string): string {
  const first = splitSegments(command)[0];
  if (!first) return cwd;
  const toks = tokenize(first);
  if (toks[0] !== 'cd' || !toks[1]) return cwd;
  const target = toks[1];
  const posixJoin = (a: string, b: string) => (a.endsWith('/') ? a + b : `${a}/${b}`);
  if (isAbsolute(target) || /^[A-Za-z]:[\\/]/.test(target)) return target;
  // keep POSIX-style joins for POSIX-style cwd so output is predictable across platforms
  return cwd.includes('\\') ? resolvePath(cwd, target) : posixJoin(cwd, target);
}
