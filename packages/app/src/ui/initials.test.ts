import { describe, expect, it } from 'vitest';
import { bareName, initials, tileColour } from './initials.js';

describe('initials', () => {
  it('tager forbogstaverne fra de to foerste ord', () => {
    expect(initials('TV 2 Charlie')).toBe('T2');
    expect(initials('Kanal 5')).toBe('K5');
  });

  it('springer landepraefikset over', () => {
    // Praefikset er ens for hele listen og siger intet om hvilken kanal det er.
    expect(initials('DNK| DR1 HD')).toBe('DH');
    expect(initials('SWE: SVT1 Sport')).toBe('SS');
  });

  it('klarer et enkelt ord', () => {
    expect(initials('Ekstrakanalen')).toBe('E');
  });

  it('giver altid noget at tegne', () => {
    expect(initials('')).toBe('?');
    expect(initials('   ')).toBe('?');
  });
});

describe('bareName og tileColour', () => {
  it('tager pynten af og giver initialer fra selve navnet', () => {
    expect(bareName('SWE| [Radio][SE] Bandit Metal HD')).toBe('Bandit Metal HD');
    expect(initials('SWE| [Radio][SE] Bandit Metal HD')).toBe('BM');
    expect(initials('DK: DR P3 (RADIO)')).toBe('DP');
  });

  it('giver samme farve for samme navn, uanset pynt', () => {
    expect(tileColour('SWE| [Radio][SE] Bandit Metal')).toBe(tileColour('Bandit Metal'));
    expect(tileColour('Bandit Metal')).toMatch(/^hsl\(\d+, 45%, 38%\)$/);
    expect(tileColour('DR1')).not.toBe(tileColour('DR2'));
  });
});
