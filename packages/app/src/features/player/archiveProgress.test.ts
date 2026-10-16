import { describe, expect, it } from 'vitest';
import { archiveProgressTime, archiveTimeLabel } from './archiveProgress.js';

const start = new Date('2026-10-12T06:00:00Z');
const programme = { start, stop: new Date('2026-10-12T07:00:00Z') };

describe('tidsvisning for hele start-forfra-udsendelsen', () => {
  it('viser set, samlet tid og rest for en udsendelse der stadig sendes', () => {
    expect(archiveProgressTime(programme, start.getTime(), 754.8)).toEqual({ elapsed: 754, duration: 3600, remaining: 2846 });
  });
  it('uret fortsaetter over et skift til naeste arkivstykke', () => {
    const before = archiveProgressTime(programme, start.getTime(), 1980.253);
    const after = archiveProgressTime(programme, start.getTime() + 1980_000, 0.253);
    expect(after).toEqual(before);
    expect(after?.remaining).toBe(1620);
  });
  it('tager hoejde for minut-overlap og resume', () => {
    expect(archiveProgressTime(programme, start.getTime() + 300_000, 20.268)?.elapsed).toBe(320);
    expect(archiveProgressTime(programme, start.getTime() - 20_000, 20)?.elapsed).toBe(0);
  });
  it('spoling tilbage saenker uret uden at aendre hele laengden', () => {
    expect(archiveProgressTime(programme, start.getTime() + 600_000, 10)).toEqual({ elapsed: 610, duration: 3600, remaining: 2990 });
  });
  it('viser aldrig negativ resttid eller fremdrift udenfor udsendelsen', () => {
    expect(archiveProgressTime(programme, start.getTime(), 4000)).toEqual({ elapsed: 3600, duration: 3600, remaining: 0 });
    expect(archiveProgressTime(programme, start.getTime(), -2)?.elapsed).toBe(0);
  });
  it('ignorerer ugyldige tider fremfor at vise NaN eller en falsk varighed', () => {
    expect(archiveProgressTime(programme, start.getTime(), NaN)).toBe(null);
    expect(archiveProgressTime({ start, stop: start }, start.getTime(), 0)).toBe(null);
    expect(archiveProgressTime({ start: new Date(NaN), stop: programme.stop }, start.getTime(), 0)).toBe(null);
  });
  it('taeller videre efter EPG-slut og medregner slutmargenen i resttiden', () => {
    const stop = new Date(programme.stop.getTime() + 300_000);
    expect(archiveProgressTime(programme, programme.stop.getTime(), 42, stop))
      .toEqual({ elapsed: 3642, duration: 3900, remaining: 258, guideDuration: 3600 });
  });
  it.each([[0, '0:00'], [754, '12:34'], [3599, '59:59'], [3600, '1:00:00'], [7384, '2:03:04']])('formaterer %i sekunder som %s', (seconds, expected) => {
    expect(archiveTimeLabel(seconds as number)).toBe(expected);
  });
});
