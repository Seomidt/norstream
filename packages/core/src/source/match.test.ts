import { describe, expect, it } from 'vitest';
import {
  buildNameIndex,
  matchRegistryChannel,
  normaliseChannelName,
  legacyNamesFor,
} from './match.js';
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

describe('plus og landenavne', () => {
  // Plusset blev fjernet som tegnsaetning, saa `TV3+` og `TV3` fik samme
  // noegle. Appen giver med vilje op paa en flertydig noegle, saa resultatet
  // var at **hverken** TV3 eller TV3+ fik et logo — begge findes i registret.
  it('holder TV3 og TV3+ adskilt', () => {
    expect(normaliseChannelName('DNK| TV3 HD')).toBe('TV3');
    expect(normaliseChannelName('DNK| TV3+ HD')).toBe('TV3PLUS');
  });

  // Registret skriver `TV3+`, logo-arkivets filnavne skriver `tv3-plus`.
  // Skrevet ud moedes de to skrivemaader.
  it('skriver plus ud som ordet, saa begge kilder rammer samme noegle', () => {
    expect(normaliseChannelName('TV3+')).toBe(normaliseChannelName('TV3 Plus'));
    expect(normaliseChannelName('Canal+ Sport FHD')).toBe('CANALPLUSSPORT');
  });

  it('fjerner panelets spor-maerker', () => {
    // Samme kanal, samme logo — kun lydspor og undertekster er forskellige.
    expect(normaliseChannelName('DNK| VIASAT FILM HITS HD MULTI')).toBe('VIASATFILMHITS');
    expect(normaliseChannelName('DNK| VIASAT FILM FAMILY (SUB)')).toBe('VIASATFILMFAMILY');
  });

  // Panelet skriver `TLC DANMARK`, registret `TLC` med land DK. Landet ligger
  // allerede i opslagsnoeglen, saa det er ikke information der gaar tabt.
  it('fjerner et landenavn panelet har haengt paa', () => {
    expect(normaliseChannelName('DNK| TLC DANMARK')).toBe('TLC');
    expect(normaliseChannelName('Discovery Norge HD')).toBe('DISCOVERY');
  });

  it('roerer ikke et stednavn der ikke er et land', () => {
    // TV 2 Østjylland er en kanal for sig, ikke TV 2 med et land paa.
    expect(normaliseChannelName('DNK| TV 2 / ØSTJYLLAND')).toBe('TV2ØSTJYLLAND');
  });
});

describe('legacyNamesFor', () => {
  // Ikke et gaet: Viasats nordiske film- og seriekanaler hedder V Film og
  // V Series i dag, og det er dem logo-arkiverne har. Panelerne skriver
  // stadig de gamle navne.
  it('giver det gamle navn en kanal ogsaa skal kunne findes paa', () => {
    expect(legacyNamesFor('VFILMACTION')).toEqual(['VIASATFILMACTION']);
    expect(legacyNamesFor('VSERIES')).toEqual(['VIASATSERIES']);
  });

  it('giver ingenting for navne der ikke er doebt om', () => {
    expect(legacyNamesFor('DR1')).toEqual([]);
    expect(legacyNamesFor('VIASATEXPLORE')).toEqual([]);
  });
});
