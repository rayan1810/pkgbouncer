import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { checkPackage, scanRefs, defaultSources, type Sources } from './check.js';
import { loadPolicy } from './core/policy.js';
import { findLockfile, parseLockfile } from './core/lockfile.js';
import { formatVerdict, formatVerdicts } from './format.js';

export function createServer(sources: Sources = defaultSources()): McpServer {
  const server = new McpServer({ name: 'guardian', version: '0.1.0' });

  server.tool(
    'check_package',
    'ALWAYS call this before adding, installing, or recommending any npm package. Returns allow/warn/deny with reasons (known malware, nonexistent or hallucinated name, too-new release, typosquat, install scripts) and a suggested safe version. Never install a package that returns deny; use the suggested safe version or pick another package.',
    {
      name: z.string().describe('npm package name, e.g. lodash or @types/node'),
      version: z.string().optional().describe('version, range or dist-tag; defaults to latest'),
    },
    async ({ name, version }) => {
      const v = await checkPackage({ ecosystem: 'npm', name, spec: version }, loadPolicy(), sources);
      return { content: [{ type: 'text', text: formatVerdict(v) }], isError: v.action === 'deny' };
    },
  );

  server.tool(
    'scan_project',
    'Scan the project lockfile (package-lock.json, pnpm-lock.yaml or yarn.lock) for known-malicious packages and critical advisories. Call after dependency changes or when asked about supply-chain safety.',
    { path: z.string().optional().describe('project directory; defaults to the current working directory') },
    async ({ path }) => {
      const lock = findLockfile(path ?? process.cwd());
      if (!lock) return { content: [{ type: 'text', text: 'No lockfile found (looked for package-lock.json, npm-shrinkwrap.json, pnpm-lock.yaml, yarn.lock).' }] };
      const refs = parseLockfile(lock, readFileSync(lock, 'utf8'));
      const hits = await scanRefs(refs, sources);
      const text = hits.length ? formatVerdicts(hits) : `[guardian] OK ${refs.length} packages scanned (${lock}), no known-malicious or critical advisories.`;
      return { content: [{ type: 'text', text }], isError: hits.some((h) => h.action === 'deny') };
    },
  );

  server.tool(
    'suggest_safe_version',
    'Return the newest version of an npm package that has no known malware or critical advisory and is older than the policy minimum age.',
    { name: z.string().describe('npm package name') },
    async ({ name }) => {
      const v = await checkPackage({ ecosystem: 'npm', name }, loadPolicy(), sources);
      return { content: [{ type: 'text', text: v.safeVersion ? `${name}@${v.safeVersion}` : `No safe version of ${name} found.` }] };
    },
  );

  return server;
}

export async function serveStdio(): Promise<void> {
  await createServer().connect(new StdioServerTransport());
}
