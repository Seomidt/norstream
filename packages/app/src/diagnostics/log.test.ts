import { beforeEach, describe, expect, it } from 'vitest';
import { clearLog, logEvent, recentLog, safe } from './log.js';

describe('fejlfindings-loggen', () => {
  beforeEach(() => clearLog());

  it('fjerner adresser og kodeord', () => {
    expect(safe('hentede http://panel.tld/live/bruger/kode/1.ts')).toBe('hentede [adresse]');
    expect(safe('a=1&password=hemmelig&b=2')).toBe('a=1&password=…&b=2');
  });

  it('gemmer linjer med maerke og tid, nyeste nederst', () => {
    logEvent('arkiv', 'beder om arkiv');
    logEvent('afspiller', 'klar (arkiv)');
    const lines = recentLog(2);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d\d:\d\d:\d\d arkiv: beder om arkiv$/);
    expect(lines[1]).toMatch(/afspiller: klar \(arkiv\)$/);
  });

  it('beholder kun de sidste 300 linjer', () => {
    for (let i = 0; i < 350; i += 1) logEvent('t', `linje ${i}`);
    const all = recentLog(1000);
    expect(all).toHaveLength(300);
    expect(all[0]).toMatch(/linje 50$/);
  });
});
