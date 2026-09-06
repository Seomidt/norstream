import { describe, expect, it } from 'vitest';
import { initials } from './initials.js';

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
