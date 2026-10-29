import { describe, expect, it } from 'vitest';
import { channelEpgSummary } from './channelEpg.js';

const channel = { name: 'DNK| V Film Hits FHD', hasArchive: false, archiveDays: 0, epgChannelId: null };

describe('channelEpgSummary', () => {
  it('skelner mellem nu/naeste og arkiv paa samme kanal', () => {
    const line = channelEpgSummary(channel, { hasDialect: true, hasCurrent: true, programmeCount: 1 });
    expect(line).toContain('VFILMHITS');
    expect(line).toContain('arkiv nej, dage 0, arkivvej ja, nu ja, fuld tabel 1');
  });
  it('viser et eksisterende arkiv selv naar det aktuelle program mangler', () => {
    expect(channelEpgSummary({ ...channel, hasArchive: true, archiveDays: 7, epgChannelId: 'privat-id' },
      { hasDialect: true, hasCurrent: false })).toContain('EPG-id ja, arkiv ja, dage 7, arkivvej ja, nu nej');
  });
  it('skriver hverken adresser, adgang eller det faktiske EPG-id', () => {
    const line = channelEpgSummary({ ...channel, name: 'https://example.invalid/private-stream password=TESTSECRET',
      epgChannelId: 'TESTPRIVATEID' }, { hasDialect: false, hasCurrent: false });
    expect(line).not.toMatch(/example|private-stream|TESTSECRET|TESTPRIVATEID|https/i);
  });
  it('begraenser kanalnavn og haandterer ugyldige arkivdage', () => {
    const line = channelEpgSummary({ ...channel, name: 'X'.repeat(2000), archiveDays: NaN }, { hasDialect: false, hasCurrent: false });
    expect(line.length).toBeLessThan(250);
    expect(line).toContain('dage 0');
  });
});
