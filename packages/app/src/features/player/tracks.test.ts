import { describe, expect, it } from 'vitest';
import { pickPreferredSubtitle, sameLanguage, trackName } from './tracks.js';

const tracks = [
  { id: '1', language: 'eng', label: 'English' },
  { id: '2', language: 'dan', label: 'Danish' },
  { id: '3', language: 'swe', label: 'Swedish' },
];

describe('pickPreferredSubtitle', () => {
  it('vaelger det foretrukne sprog, ogsaa naar filen skriver det med tre bogstaver', () => {
    expect(pickPreferredSubtitle(tracks, 'da')?.id).toBe('2');
    expect(pickPreferredSubtitle(tracks, 'sv')?.id).toBe('3');
  });

  it('falder tilbage paa engelsk naar sproget mangler', () => {
    expect(pickPreferredSubtitle(tracks, 'no')?.id).toBe('1');
  });

  it('vaelger intet naar undertekster er slaaet fra, eller intet passer', () => {
    expect(pickPreferredSubtitle(tracks, 'off')).toBeNull();
    expect(pickPreferredSubtitle([{ language: 'und', label: '' }], 'da')).toBeNull();
    expect(pickPreferredSubtitle([], 'da')).toBeNull();
  });
});

describe('sameLanguage og trackName', () => {
  it('kender de to- og trebogstavede koder som samme sprog', () => {
    expect(sameLanguage('da', 'DAN')).toBe(true);
    expect(sameLanguage('nb', 'no')).toBe(false);
  });

  it('viser sproget paa dansk og navnet naar det siger mere', () => {
    expect(trackName({ language: 'dan', label: 'Danish' })).toBe('Dansk');
    expect(trackName({ language: 'da', label: 'x', name: 'CC' })).toBe('Dansk (CC)');
    expect(trackName({ language: 'xx', label: 'Mystery' })).toBe('Mystery');
  });
});
