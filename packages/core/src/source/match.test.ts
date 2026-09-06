import { describe, expect, it } from 'vitest';
import { buildNameIndex, matchRegistryChannel, normaliseChannelName } from './match.js';
import type { RegistryChannel } from './match.js';

describe('normaliseChannelName', () => {
  it('fjerner panelets landepraefiks', () => {
    expect(normaliseChannelName('DNK| DR1 HD')).toBe('DR1');
    expect(normaliseChannelName('DK | TV 2')).toBe('TV2');
  });

  it('fjerner kvalitetsmaerker', () => {
    for (const name of ['DR1 HD', 'DR1 HEVC', 'VIP DR1 FHD', 'DR1 1080p']) {
      expect(normaliseChannelName(name)).toBe('DR1');
    }
  });

  it('behandler mellemrum og tegn som ingenting', () => {
    expect(normaliseChannelName('TV 2 Charlie')).toBe(normaliseChannelName('TV2-Charlie'));
  });

  it('beholder tallet', () => {
    // DR1 og DR2 er ikke den samme kanal. En normalisering der blandede dem
    // ville give forkerte logoer paa kanaler der ser rigtige ud.
    expect(normaliseChannelName('DR1')).not.toBe(normaliseChannelName('DR2'));
  });

  it('beholder danske bogstaver', () => {
    expect(normaliseChannelName('Kanal Ø')).toBe('KANALØ');
  });
});

const DK_TV2: RegistryChannel = { id: 'TV2.dk', name: 'TV 2', altNames: [], country: 'DK' };
const NO_TV2: RegistryChannel = { id: 'TV2.no', name: 'TV 2', altNames: [], country: 'NO' };
const DR1: RegistryChannel = { id: 'DR1.dk', name: 'DR1', altNames: ['DR Et'], country: 'DK' };

describe('matchRegistryChannel', () => {
  const index = buildNameIndex([DK_TV2, NO_TV2, DR1]);

  it('finder en entydig kanal uden at kende landet', () => {
    expect(matchRegistryChannel(index, 'DNK| DR1 HD', null)).toBe(DR1);
  });

  it('finder ogsaa paa et alternativt navn', () => {
    expect(matchRegistryChannel(index, 'DR Et HD', null)).toBe(DR1);
  });

  it('lader landet afgoere naar navnet gaar igen', () => {
    expect(matchRegistryChannel(index, 'DNK| TV 2 HD', 'DK')).toBe(DK_TV2);
    expect(matchRegistryChannel(index, 'NOR| TV 2 HD', 'NO')).toBe(NO_TV2);
  });

  it('giver op frem for at gaette', () => {
    // Et forkert logo paa en kanal der ser rigtig ud, opdager man aldrig.
    expect(matchRegistryChannel(index, 'TV 2 HD', null)).toBeNull();
    expect(matchRegistryChannel(index, 'TV 2 HD', 'SE')).toBeNull();
  });

  it('giver null for et navn registret ikke har', () => {
    expect(matchRegistryChannel(index, 'Fireplace 4K', 'DK')).toBeNull();
  });
});
