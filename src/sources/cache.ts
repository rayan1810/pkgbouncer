import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { guardianHome } from '../core/policy.js';

export function defaultCacheDir(): string {
  return process.env.GUARDIAN_CACHE_DIR ?? join(guardianHome(), 'cache');
}

/** Tiny JSON file cache with per-entry TTL. One file per key. */
export class FileCache {
  constructor(private dir: string = defaultCacheDir()) {
    mkdirSync(dir, { recursive: true });
  }

  private path(key: string): string {
    return join(this.dir, createHash('sha1').update(key).digest('hex') + '.json');
  }

  get<T>(key: string): T | undefined {
    const p = this.path(key);
    if (!existsSync(p)) return undefined;
    try {
      const { expires, value } = JSON.parse(readFileSync(p, 'utf8')) as { expires: number; value: T };
      return expires > Date.now() ? value : undefined;
    } catch {
      return undefined;
    }
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    try {
      writeFileSync(this.path(key), JSON.stringify({ expires: Date.now() + ttlMs, value }));
    } catch {
      // cache is best-effort
    }
  }

  async remember<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;
    const v = await fn();
    this.set(key, v, ttlMs);
    return v;
  }
}
