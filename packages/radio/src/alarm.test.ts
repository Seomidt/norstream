import { describe, expect, it } from 'vitest';
import { parseClock } from './clock.js';

describe('parseClock', () => {
  it('forstaar de maader man skriver et klokkeslaet paa', () => {
    expect(parseClock('07.30')).toEqual({ hour: 7, minute: 30 });
    expect(parseClock('7:30')).toEqual({ hour: 7, minute: 30 });
    expect(parseClock('0645')).toEqual({ hour: 6, minute: 45 });
    expect(parseClock('645')).toEqual({ hour: 6, minute: 45 });
    expect(parseClock('23.59')).toEqual({ hour: 23, minute: 59 });
  });

  it('afviser det der ikke er en tid', () => {
    expect(parseClock('')).toBeNull();
    expect(parseClock('7')).toBeNull();
    expect(parseClock('24.00')).toBeNull();
    expect(parseClock('12.60')).toBeNull();
    expect(parseClock('12345')).toBeNull();
  });
});
