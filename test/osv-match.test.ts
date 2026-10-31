import { describe, it, expect } from 'vitest';
import { vulnAffectsVersion, vulnSeverity, isMalware } from '../src/core/osv-match.js';
import type { OsvVuln } from '../src/core/types.js';

const mal: OsvVuln = { id: 'MAL-2026-1', affected: [{ package: { ecosystem: 'npm', name: 'foo' }, versions: ['1.2.3', '1.2.4'] }] };
const ranged: OsvVuln = {
  id: 'GHSA-x',
  affected: [{ package: { ecosystem: 'npm', name: 'foo' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '1.0.0' }, { fixed: '1.5.0' }] }] }],
  database_specific: { severity: 'HIGH' },
};
const cvss: OsvVuln = { id: 'GHSA-y', severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }] };

describe('osv-match', () => {
  it('matches explicit versions', () => {
    expect(vulnAffectsVersion(mal, 'foo', '1.2.3')).toBe(true);
    expect(vulnAffectsVersion(mal, 'foo', '1.2.5')).toBe(false);
  });
  it('matches semver ranges', () => {
    expect(vulnAffectsVersion(ranged, 'foo', '1.4.9')).toBe(true);
    expect(vulnAffectsVersion(ranged, 'foo', '1.5.0')).toBe(false);
    expect(vulnAffectsVersion(ranged, 'foo', '0.9.0')).toBe(false);
  });
  it('ignores affected entries for other packages', () => {
    expect(vulnAffectsVersion(mal, 'bar', '1.2.3')).toBe(false);
  });
  it('treats introduced=0 with no fixed as all versions', () => {
    const all: OsvVuln = { id: 'MAL-2', affected: [{ package: { name: 'foo' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }] }] }] };
    expect(vulnAffectsVersion(all, 'foo', '9.9.9')).toBe(true);
  });
  it('handles last_affected', () => {
    const la: OsvVuln = { id: 'GHSA-z', affected: [{ package: { name: 'foo' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '2.0.0' }, { last_affected: '2.3.0' }] }] }] };
    expect(vulnAffectsVersion(la, 'foo', '2.3.0')).toBe(true);
    expect(vulnAffectsVersion(la, 'foo', '2.3.1')).toBe(false);
  });
  it('derives severity', () => {
    expect(vulnSeverity(ranged)).toBe('HIGH');
    expect(vulnSeverity(cvss)).toBe('CRITICAL');
    expect(vulnSeverity(mal)).toBe('UNKNOWN');
    expect(vulnSeverity({ id: 'x', database_specific: { severity: 'MEDIUM' } })).toBe('MODERATE');
  });
  it('detects malware records', () => {
    expect(isMalware(mal)).toBe(true);
    expect(isMalware(ranged)).toBe(false);
    expect(isMalware({ id: 'GHSA-q', aliases: ['MAL-2026-9'] })).toBe(true);
  });
});
