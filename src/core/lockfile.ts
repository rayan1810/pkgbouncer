import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import YAML from 'yaml';
import type { Ecosystem, PackageRef } from './types.js';
import { normalizePyPiName } from './parse-command.js';

/*
 * Lockfile and manifest parsers. Each returns exact (name, version) refs.
 * Only pinned entries are returned; scans need exact versions.
 */

export const LOCKFILES: { file: string; ecosystem: Ecosystem }[] = [
  { file: 'package-lock.json', ecosystem: 'npm' },
  { file: 'npm-shrinkwrap.json', ecosystem: 'npm' },
  { file: 'pnpm-lock.yaml', ecosystem: 'npm' },
  { file: 'yarn.lock', ecosystem: 'npm' },
  { file: 'bun.lock', ecosystem: 'npm' },
  { file: 'uv.lock', ecosystem: 'PyPI' },
  { file: 'poetry.lock', ecosystem: 'PyPI' },
  { file: 'requirements.txt', ecosystem: 'PyPI' },
  { file: 'Cargo.lock', ecosystem: 'crates.io' },
  { file: 'go.sum', ecosystem: 'Go' },
];

/** First lockfile found for the given ecosystem (or any), or null. */
export function findLockfile(dir: string, ecosystem?: Ecosystem): string | null {
  for (const { file, ecosystem: eco } of LOCKFILES) {
    if (ecosystem && eco !== ecosystem) continue;
    const p = join(dir, file);
    if (existsSync(p)) return p;
  }
  return null;
}

/** All lockfiles present in the directory. */
export function findLockfiles(dir: string): string[] {
  return LOCKFILES.map(({ file }) => join(dir, file)).filter((p) => existsSync(p));
}

export function dedupeRefs(refs: PackageRef[]): PackageRef[] {
  const seen = new Map<string, PackageRef>();
  for (const r of refs) seen.set(`${r.ecosystem}:${r.name}@${r.spec}`, r);
  return [...seen.values()].sort((a, b) => a.ecosystem.localeCompare(b.ecosystem) || a.name.localeCompare(b.name) || (a.spec ?? '').localeCompare(b.spec ?? ''));
}

// ---------- npm ----------

interface LockDep { version?: string; dependencies?: Record<string, LockDep> }

function parsePackageLock(text: string): PackageRef[] {
  const json = JSON.parse(text) as { packages?: Record<string, { version?: string }>; dependencies?: Record<string, LockDep> };
  const refs: PackageRef[] = [];
  if (json.packages) {
    for (const [key, val] of Object.entries(json.packages)) {
      const idx = key.lastIndexOf('node_modules/');
      if (idx === -1 || !val.version) continue;
      refs.push({ ecosystem: 'npm', name: key.slice(idx + 'node_modules/'.length), spec: val.version });
    }
  } else if (json.dependencies) {
    const walk = (deps: Record<string, LockDep>) => {
      for (const [name, d] of Object.entries(deps)) {
        if (d.version) refs.push({ ecosystem: 'npm', name, spec: d.version });
        if (d.dependencies) walk(d.dependencies);
      }
    };
    walk(json.dependencies);
  }
  return refs;
}

function parsePnpmLock(text: string): PackageRef[] {
  const doc = YAML.parse(text) as { packages?: Record<string, unknown> } | null;
  const refs: PackageRef[] = [];
  for (const key of Object.keys(doc?.packages ?? {})) {
    const k = key.replace(/^\//, '').replace(/\(.*$/, '');
    const at = k.lastIndexOf('@');
    if (at <= 0) continue;
    refs.push({ ecosystem: 'npm', name: k.slice(0, at), spec: k.slice(at + 1) });
  }
  return refs;
}

function parseYarnLock(text: string): PackageRef[] {
  const refs: PackageRef[] = [];
  for (const block of text.split(/\r?\n(?=\S)/)) {
    const header = block.split(/\r?\n/)[0];
    if (!header || header.startsWith('#')) continue;
    const verMatch = /^\s+version:?\s+"?([^"\s]+)"?/m.exec(block);
    if (!verMatch) continue;
    const firstKey = header.replace(/:\s*$/, '').split(',')[0].trim().replace(/^"|"$/g, '');
    const at = firstKey.lastIndexOf('@');
    const name = at > 0 ? firstKey.slice(0, at) : firstKey;
    refs.push({ ecosystem: 'npm', name, spec: verMatch[1] });
  }
  return refs;
}

/** bun.lock is JSONC: packages: { "name": ["name@version", ...] } */
function parseBunLock(text: string): PackageRef[] {
  const json = JSON.parse(text.replace(/,(\s*[}\]])/g, '$1')) as { packages?: Record<string, unknown[]> };
  const refs: PackageRef[] = [];
  for (const entry of Object.values(json.packages ?? {})) {
    const spec = entry[0];
    if (typeof spec !== 'string') continue;
    const at = spec.lastIndexOf('@');
    if (at <= 0) continue;
    refs.push({ ecosystem: 'npm', name: spec.slice(0, at), spec: spec.slice(at + 1) });
  }
  return refs;
}

// ---------- PyPI ----------

/** TOML `[[package]]` tables with name/version (uv.lock, poetry.lock, Cargo.lock). */
function parseTomlPackages(text: string, ecosystem: Ecosystem, normalize: (n: string) => string = (n) => n): PackageRef[] {
  const refs: PackageRef[] = [];
  for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = /^name\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const version = /^version\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    if (name && version) refs.push({ ecosystem, name: normalize(name), spec: version });
  }
  return refs;
}

function parseRequirements(text: string): PackageRef[] {
  const refs: PackageRef[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').replace(/\\$/, '').trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) continue;
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*==\s*([^\s;,]+)/.exec(line);
    if (m) refs.push({ ecosystem: 'PyPI', name: normalizePyPiName(m[1]), spec: m[2] });
  }
  return refs;
}

// ---------- Go ----------

function parseGoSum(text: string): PackageRef[] {
  const refs: PackageRef[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\S+)\s+(v\S+?)(\/go\.mod)?\s+h1:/.exec(line.trim());
    if (m && !m[3]) refs.push({ ecosystem: 'Go', name: m[1], spec: m[2] });
  }
  return refs;
}

export function parseLockfile(path: string, text: string): PackageRef[] {
  const file = basename(path);
  switch (file) {
    case 'package-lock.json':
    case 'npm-shrinkwrap.json':
      return dedupeRefs(parsePackageLock(text));
    case 'pnpm-lock.yaml':
      return dedupeRefs(parsePnpmLock(text));
    case 'yarn.lock':
      return dedupeRefs(parseYarnLock(text));
    case 'bun.lock':
      return dedupeRefs(parseBunLock(text));
    case 'uv.lock':
    case 'poetry.lock':
      return dedupeRefs(parseTomlPackages(text, 'PyPI', normalizePyPiName));
    case 'requirements.txt':
      return dedupeRefs(parseRequirements(text));
    case 'Cargo.lock':
      return dedupeRefs(parseTomlPackages(text, 'crates.io'));
    case 'go.sum':
      return dedupeRefs(parseGoSum(text));
    default:
      throw new Error(`Unsupported lockfile: ${file}`);
  }
}
