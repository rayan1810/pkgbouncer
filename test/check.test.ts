import { describe, it, expect } from 'vitest';
import { checkPackage, scanRefs } from '../src/check.js';
import { stubSources } from './helpers/stub-sources.js';
import { formatVerdict, formatVerdicts } from '../src/format.js';
import { DEFAULT_POLICY } from '../src/core/types.js';

describe('checkPackage', () => {
  it('denies malware with a readable message and safe version', async () => {
    const v = await checkPackage({ ecosystem: 'npm', name: 'evil' }, DEFAULT_POLICY, stubSources);
    expect(v.action).toBe('deny');
    const text = formatVerdict(v);
    expect(text).toContain('BLOCKED evil@1.0.0');
    expect(text).toContain('MAL-1');
    expect(text).toContain('evil@0.9.0');
  });
  it('allows clean packages with a one-line summary', async () => {
    const v = await checkPackage({ ecosystem: 'npm', name: 'fine' }, DEFAULT_POLICY, stubSources);
    expect(v.action).toBe('allow');
    expect(formatVerdict(v)).toBe('[guardian] OK fine@1.0.0');
  });
  it('collects source errors instead of throwing', async () => {
    const v = await checkPackage({ ecosystem: 'npm', name: 'flaky' }, DEFAULT_POLICY, stubSources);
    expect(v.findings[0].rule).toBe('source-unavailable');
    expect(v.action).toBe('warn');
  });
  it('denies nonexistent names', async () => {
    const v = await checkPackage({ ecosystem: 'npm', name: 'nope' }, DEFAULT_POLICY, stubSources);
    expect(v.action).toBe('deny');
    expect(formatVerdict(v)).toContain('does not exist');
  });
});

describe('scanRefs', () => {
  it('returns only hits', async () => {
    const hits = await scanRefs(
      [{ ecosystem: 'npm', name: 'evil', spec: '1.0.0' }, { ecosystem: 'npm', name: 'ok', spec: '1.0.0' }, { ecosystem: 'npm', name: 'nospec' }],
      stubSources,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].ref.name).toBe('evil');
    expect(hits[0].action).toBe('deny');
    expect(formatVerdicts(hits)).toContain('MAL-1');
  });
});
