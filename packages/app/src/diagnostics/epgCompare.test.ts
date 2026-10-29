import { describe, expect, it } from 'vitest';
import type { Programme } from '@norstream/core';
import { describeShortAgainstTable, describeTableNow, weekRepeat } from './epgCompare.js';

const p = (day: number, hour: number, title: string, minutes = 60): Programme => ({
  channelId: 'x', title, description: null,
  start: new Date(2026, 9, day, hour, 0), stop: new Date(2026, 9, day, hour, minutes),
});
const todayStart = new Date(2026, 9, 29).getTime();
const now = new Date(2026, 9, 29, 17, 30).getTime();

describe('epgCompare v429', () => {
  it('finder at i dag er en kopi af samme dag i sidste uge', () => {
    const table = [p(22, 17, 'A'), p(22, 18, 'B'), p(29, 17, 'A'), p(29, 18, 'B'), p(29, 19, 'C')];
    expect(weekRepeat(table, todayStart)).toEqual({ today: 3, lastWeek: 2, same: 2 });
    const line = describeTableNow(table, now, todayStart);
    expect(line).toContain('2 programmer efter nu');
    expect(line).toContain('i dag 2 af 3 med samme titel');
    expect(line).not.toContain('A');
  });

  it('sammenligner panelets nu/naeste med tabellen uden at skrive titler', () => {
    const table = [p(22, 18, 'Gammel'), p(29, 17, 'Gammel nu')];
    const short = [p(29, 17, 'Rigtig nu'), p(29, 18, 'Gammel')];
    const line = describeShortAgainstTable(short, table, now);
    expect(line).toContain('panelet har 2 (1 kommende');
    expect(line).toContain('samme titel som tabellen nej');
    expect(line).toContain('samme start ja');
    expect(line).toContain('1 har titel og tid som 7 dage foer');
    expect(line).not.toMatch(/Rigtig|Gammel/);
  });
});
