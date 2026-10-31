import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { checkPackage, scanRefs, defaultSources, type Sources } from './check.js';
import { loadPolicy } from './core/policy.js';
import { dedupeRefs, findLockfiles, parseLockfile } from './core/lockfile.js';
import { normalizePyPiName } from './core/parse-command.js';
import { ECOSYSTEMS, type Ecosystem } from './core/types.js';
import { formatVerdict, formatVerdicts } from './format.js';

const ecosystemSchema = z.enum(ECOSYSTEMS as [Ecosystem, ...Ecosystem[]]).optional().describe('npm (default), PyPI, crates.io, or Go');

function normalizeName(eco: Ecosystem, name: string): string {
  return eco === 'PyPI' ? normalizePyPiName(name) : name;
}

export function createServer(sources: Sources = defaultSources()): McpServer {
  const server = new McpServer({ name: 'pkgbouncer', version: '0.1.0' });

  server.tool(
    'check_package',
    'ALWAYS call this before adding, installing, or recommending any package (npm, PyPI, crates.io, Go). Returns allow/warn/deny with reasons (known malware, nonexistent or hallucinated name, too-new release, typosquat, install scripts) and a suggested safe version. Never install a package that returns deny; use the suggested safe version or pick another package.',
    {
      name: z.string().describe('package name, e.g. lodash, @types/node, requests, serde, github.com/gin-gonic/gin'),
      version: z.string().optional().describe('version, range, specifier or dist-tag; defaults to latest'),
      ecosystem: ecosystemSchema,
    },
    async ({ name, version, ecosystem }) => {
      const eco = ecosystem ?? 'npm';
      const v = await checkPackage({ ecosystem: eco, name: normalizeName(eco, name), spec: version }, loadPolicy(), sources);
      return { content: [{ type: 'text', text: formatVerdict(v) }], isError: v.action === 'deny' };
    },
  );

  server.tool(
    'scan_project',
    'Scan every lockfile in a project (package-lock.json, pnpm-lock.yaml, yarn.lock, bun.lock, uv.lock, poetry.lock, requirements.txt, Cargo.lock, go.sum) for known-malicious packages and critical advisories. Call after dependency changes or when asked about supply-chain safety.',
    { path: z.string().optional().describe('project directory; defaults to the current working directory') },
    async ({ path }) => {
      const dir = path ?? process.cwd();
      const files = findLockfiles(dir);
      if (files.length === 0) return { content: [{ type: 'text', text: `No lockfile found in ${dir}.` }] };
      const refs = dedupeRefs(files.flatMap((f) => parseLockfile(f, readFileSync(f, 'utf8'))));
      const hits = await scanRefs(refs, sources);
      const text = hits.length ? formatVerdicts(hits) : `[pkgbouncer] OK ${refs.length} packages scanned (${files.map((f) => f.replace(/.*[\\/]/, '')).join(', ')}), no known-malicious or critical advisories.`;
      return { content: [{ type: 'text', text }], isError: hits.some((h) => h.action === 'deny') };
    },
  );

  server.tool(
    'suggest_safe_version',
    'Return the newest version of a package that has no known malware or critical advisory and is older than the policy minimum age.',
    { name: z.string().describe('package name'), ecosystem: ecosystemSchema },
    async ({ name, ecosystem }) => {
      const eco = ecosystem ?? 'npm';
      const v = await checkPackage({ ecosystem: eco, name: normalizeName(eco, name) }, loadPolicy(), sources);
      return { content: [{ type: 'text', text: v.safeVersion ? `${name}@${v.safeVersion}` : `No safe version of ${name} found.` }] };
    },
  );

  return server;
}

export async function serveStdio(): Promise<void> {
  await createServer().connect(new StdioServerTransport());
}
