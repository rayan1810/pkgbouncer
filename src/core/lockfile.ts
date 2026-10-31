import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import YAML from 'yaml';
import type { PackageRef } from './types.js';

const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock'];

export function findLockfile(dir: string): string | null {
  for (const f of LOCKFILES) {
    const p = join(dir, f);
    if (existsSync(p)) return p;
  }
  return null;
}

function dedupe(refs: PackageRef[]): PackageRef[] {
  const seen = new Map<string, PackageRef>();
  for (const r of refs) seen.set(`${r.name}@${r.spec}`, r);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || (a.spec ?? '').localeCompare(b.spec ?? ''));
}

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

export function parseLockfile(path: string, text: string): PackageRef[] {
  const file = basename(path);
  if (file === 'package-lock.json' || file === 'npm-shrinkwrap.json') return dedupe(parsePackageLock(text));
  if (file === 'pnpm-lock.yaml') return dedupe(parsePnpmLock(text));
  if (file === 'yarn.lock') return dedupe(parseYarnLock(text));
  throw new Error(`Unsupported lockfile: ${file}`);
}
