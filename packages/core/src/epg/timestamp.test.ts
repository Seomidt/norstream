import { describe, expect, it } from 'vitest';
import { parseXmltvTimestamp } from './timestamp.js';

describe('parseXmltvTimestamp', () => {
  it('parser med positivt offset', () => {
    const d = parseXmltvTimestamp('20260904200000 +0200');
    expect(d?.toISOString()).toBe('2026-09-04T18:00:00.000Z');
  });

  it('parser med negativt offset', () => {
    const d = parseXmltvTimestamp('20260904200000 -0430');
    expect(d?.toISOString()).toBe('2026-09-05T00:30:00.000Z');
  });

  it('fortolker manglende offset som UTC', () => {
    const d = parseXmltvTimestamp('20260904200000');
    expect(d?.toISOString()).toBe('2026-09-04T20:00:00.000Z');
  });

  it('accepterer tidsstempel uden sekunder', () => {
    const d = parseXmltvTimestamp('202609042000 +0000');
    expect(d?.toISOString()).toBe('2026-09-04T20:00:00.000Z');
  });

  it('returnerer null for vrøvl', () => {
    expect(parseXmltvTimestamp('ikke en dato')).toBeNull();
    expect(parseXmltvTimestamp('')).toBeNull();
  });

  it('returnerer null for umulig måned', () => {
    expect(parseXmltvTimestamp('20261304200000 +0000')).toBeNull();
  });

  it('returnerer null for dato der ruller over', () => {
    expect(parseXmltvTimestamp('20260231200000 +0000')).toBeNull();
  });

  it('returnerer null for offset-minutter over 59', () => {
    expect(parseXmltvTimestamp('20260904200000 +0199')).toBeNull();
  });

  it('returnerer null for offset-timer over 14', () => {
    expect(parseXmltvTimestamp('20260904200000 +1500')).toBeNull();
  });

  it('accepterer grænsetilfældet +1400', () => {
    const d = parseXmltvTimestamp('20260904200000 +1400');
    expect(d?.toISOString()).toBe('2026-09-04T06:00:00.000Z');
  });
});
