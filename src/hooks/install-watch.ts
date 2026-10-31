import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dedupeRefs, findLockfiles, parseLockfile } from '../core/lockfile.js';
import { guardianHome } from '../core/policy.js';
import { refKey, type PackageRef } from '../core/types.js';
import { satisfies } from '../core/versions.js';

/*
 * Tracks what an install actually added. Before an install we snapshot the
 * lockfile refs; after it we diff and scan only the new ones. This is how
 * transitive dependencies get checked without resolving the graph ourselves.
 */

function snapshotPath(dir: string): string {
  const d = join(guardianHome(), 'snapshots');
  mkdirSync(d, { recursive: true });
  return join(d, createHash('sha1').update(dir.toLowerCase()).digest('hex') + '.json');
}

/** All pinned refs across every lockfile in the directory. Unparseable files are skipped. */
export function readLockRefs(dir: string): PackageRef[] {
  const refs: PackageRef[] = [];
  for (const file of findLockfiles(dir)) {
    try {
      refs.push(...parseLockfile(file, readFileSync(file, 'utf8')));
    } catch {
      // a half-written or exotic lockfile should not break the gate
    }
  }
  return dedupeRefs(refs);
}

export function takeSnapshot(dir: string): void {
  try {
    writeFileSync(snapshotPath(dir), JSON.stringify({ at: Date.now(), refs: readLockRefs(dir) }));
  } catch {
    // best effort
  }
}

/** Refs present now that were not in the snapshot, or null if there is no snapshot to compare against. */
export function diffSinceSnapshot(dir: string, consume = true): PackageRef[] | null {
  const p = snapshotPath(dir);
  if (!existsSync(p)) return null;
  let before: PackageRef[] = [];
  try {
    before = (JSON.parse(readFileSync(p, 'utf8')) as { refs: PackageRef[] }).refs;
  } catch {
    return null;
  } finally {
    if (consume) {
      try {
        unlinkSync(p);
      } catch {
        // ignore
      }
    }
  }
  const seen = new Set(before.map(refKey));
  return readLockRefs(dir).filter((r) => !seen.has(refKey(r)));
}

const NON_REGISTRY_SPEC = /^(file:|link:|workspace:|npm:|git\+|git:|github:|gitlab:|bitbucket:|https?:|\.|\/)/;

/**
 * npm only: dependencies declared in package.json that the lockfile does not
 * already satisfy. These are what a bare `npm install` is about to fetch.
 */
export function pendingDirectDeps(dir: string): PackageRef[] {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return [];
  let pkg: Record<string, Record<string, string> | undefined>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as typeof pkg;
  } catch {
    return [];
  }
  const locked = readLockRefs(dir).filter((r) => r.ecosystem === 'npm');
  const out: PackageRef[] = [];
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      if (typeof range !== 'string' || NON_REGISTRY_SPEC.test(range)) continue;
      const satisfied = locked.some((r) => r.name === name && r.spec !== undefined && satisfies('npm', r.spec, range || '*'));
      if (!satisfied) out.push({ ecosystem: 'npm', name, spec: range || undefined });
    }
  }
  return dedupeRefs(out);
}
