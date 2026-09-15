import { describe, expect, it } from 'vitest';
import type { Programme } from '@norstream/core';
import {
  DRAG_MAX_MINUTES,
  DRAG_MIN_MINUTES,
  WINDOW_MINUTES,
  dragMinutes,
  guideAction,
  guideWindow,
  layoutRow,
  nowRatio,
  offsetForTarget,
  programmeOptions,
  shiftedWindow,
} from './layout.js';

const WINDOW_START = new Date('2026-09-05T19:00:00.000Z');
const WINDOW_END = new Date('2026-09-05T21:00:00.000Z');

function programme(startIso: string, stopIso: string, title = 'Program'): Programme {
  return {
    channelId: '247634',
    title,
    description: null,
    start: new Date(startIso),
    stop: new Date(stopIso),
  };
}

function totalWeight(cells: { weight: number }[]): number {
  return cells.reduce((sum, cell) => sum + cell.weight, 0);
}

describe('guideWindow', () => {
  it('forankrer til naermeste halve time foer nu', () => {
    const { start, end } = guideWindow(new Date('2026-09-05T19:07:33.000Z'));
    expect(start.toISOString()).toBe('2026-09-05T19:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-05T21:00:00.000Z');
  });

  it('forankrer ogsaa naar klokken er over halv', () => {
    const { start } = guideWindow(new Date('2026-09-05T19:44:00.000Z'));
    expect(start.toISOString()).toBe('2026-09-05T19:30:00.000Z');
  });

  it('sider frem og tilbage med hele vinduer', () => {
    const now = new Date('2026-09-05T19:00:00.000Z');
    expect(guideWindow(now, 1).start.toISOString()).toBe('2026-09-05T21:00:00.000Z');
    expect(guideWindow(now, -1).start.toISOString()).toBe('2026-09-05T17:00:00.000Z');
  });

  it('bruger et to-timers vindue', () => {
    const { start, end } = guideWindow(new Date('2026-09-05T19:00:00.000Z'));
    expect((end.getTime() - start.getTime()) / 60_000).toBe(WINDOW_MINUTES);
  });
});

describe('layoutRow', () => {
  const NOW = new Date('2026-09-05T19:15:00.000Z');

  it('laegger to programmer ud efter deres laengde', () => {
    const cells = layoutRow(
      [
        programme('2026-09-05T19:00:00.000Z', '2026-09-05T20:00:00.000Z', 'TV Avisen'),
        programme('2026-09-05T20:00:00.000Z', '2026-09-05T21:00:00.000Z', 'Deadline'),
      ],
      WINDOW_START,
      WINDOW_END,
      NOW,
    );

    expect(cells.map((c) => c.programme?.title)).toEqual(['TV Avisen', 'Deadline']);
    expect(cells.map((c) => c.weight)).toEqual([60, 60]);
  });

  it('klipper et program der begyndte foer vinduet', () => {
    const cells = layoutRow(
      [programme('2026-09-05T18:30:00.000Z', '2026-09-05T19:30:00.000Z')],
      WINDOW_START,
      WINDOW_END,
      NOW,
    );

    expect(cells[0]?.weight).toBe(30);
    expect(cells[0]?.clippedStart).toBe(true);
    expect(cells[0]?.clippedEnd).toBe(false);
  });

  it('klipper et program der fortsaetter efter vinduet', () => {
    const cells = layoutRow(
      [programme('2026-09-05T20:30:00.000Z', '2026-09-05T22:00:00.000Z')],
      WINDOW_START,
      WINDOW_END,
      NOW,
    );

    const last = cells[cells.length - 1];
    expect(last?.weight).toBe(30);
    expect(last?.clippedEnd).toBe(true);
  });

  it('klipper et program der spaender hele vinduet i begge ender', () => {
    const cells = layoutRow(
      [programme('2026-09-05T17:00:00.000Z', '2026-09-05T23:00:00.000Z')],
      WINDOW_START,
      WINDOW_END,
      NOW,
    );

    expect(cells).toHaveLength(1);
    expect(cells[0]?.weight).toBe(120);
    expect(cells[0]?.clippedStart).toBe(true);
    expect(cells[0]?.clippedEnd).toBe(true);
  });

  it('fylder hul mellem to programmer med en gap-celle', () => {
    // Uden hullet ville aftenens programmer skride en time til venstre og
    // staa ud for et forkert klokkeslaet.
    const cells = layoutRow(
      [
        programme('2026-09-05T19:00:00.000Z', '2026-09-05T19:30:00.000Z', 'A'),
        programme('2026-09-05T20:30:00.000Z', '2026-09-05T21:00:00.000Z', 'B'),
      ],
      WINDOW_START,
      WINDOW_END,
      NOW,
    );

    expect(cells.map((c) => c.state)).toEqual(['live', 'gap', 'future']);
    expect(cells.map((c) => c.weight)).toEqual([30, 60, 30]);
  });

  it('fylder hele vinduet med et hul naar der ingen programdata er', () => {
    const cells = layoutRow([], WINDOW_START, WINDOW_END, NOW);
    expect(cells).toHaveLength(1);
    expect(cells[0]?.state).toBe('gap');
    expect(cells[0]?.weight).toBe(120);
  });

  it('summen af vaegte er altid vinduets laengde', () => {
    // Den egenskab er hele grunden til at gap-celler findes: skrider den,
    // staar hver eneste celle i raekken ud for et forkert tidspunkt.
    const cases: Programme[][] = [
      [],
      [programme('2026-09-05T19:10:00.000Z', '2026-09-05T19:20:00.000Z')],
      [
        programme('2026-09-05T18:00:00.000Z', '2026-09-05T19:45:00.000Z'),
        programme('2026-09-05T20:15:00.000Z', '2026-09-05T22:30:00.000Z'),
      ],
      [programme('2026-09-05T19:00:00.000Z', '2026-09-05T21:00:00.000Z')],
    ];
    for (const programmes of cases) {
      expect(totalWeight(layoutRow(programmes, WINDOW_START, WINDOW_END, NOW))).toBe(120);
    }
  });

  it('klipper overlappende programmer mod det foregaaende', () => {
    const cells = layoutRow(
      [
        programme('2026-09-05T19:00:00.000Z', '2026-09-05T20:00:00.000Z', 'A'),
        programme('2026-09-05T19:30:00.000Z', '2026-09-05T20:30:00.000Z', 'B'),
      ],
      WINDOW_START,
      WINDOW_END,
      NOW,
    );

    expect(cells.map((c) => c.programme?.title)).toEqual(['A', 'B', undefined]);
    expect(cells.map((c) => c.weight)).toEqual([60, 30, 30]);
    expect(totalWeight(cells)).toBe(120);
  });

  it('udelader et program der er helt daekket af det foregaaende', () => {
    const cells = layoutRow(
      [
        programme('2026-09-05T19:00:00.000Z', '2026-09-05T21:00:00.000Z', 'Lang'),
        programme('2026-09-05T19:30:00.000Z', '2026-09-05T20:00:00.000Z', 'Skjult'),
      ],
      WINDOW_START,
      WINDOW_END,
      NOW,
    );

    expect(cells.map((c) => c.programme?.title)).toEqual(['Lang']);
  });

  it('udelader programmer helt uden for vinduet', () => {
    const cells = layoutRow(
      [
        programme('2026-09-05T17:00:00.000Z', '2026-09-05T18:00:00.000Z'),
        programme('2026-09-05T22:00:00.000Z', '2026-09-05T23:00:00.000Z'),
      ],
      WINDOW_START,
      WINDOW_END,
      NOW,
    );

    expect(cells.every((c) => c.programme === null)).toBe(true);
  });

  it('markerer tilstand ud fra now, ikke ud fra vinduet', () => {
    const cells = layoutRow(
      [
        programme('2026-09-05T19:00:00.000Z', '2026-09-05T19:15:00.000Z', 'Slut'),
        programme('2026-09-05T19:15:00.000Z', '2026-09-05T19:45:00.000Z', 'Nu'),
        programme('2026-09-05T19:45:00.000Z', '2026-09-05T20:00:00.000Z', 'Senere'),
      ],
      WINDOW_START,
      WINDOW_END,
      NOW,
    );

    expect(cells.slice(0, 3).map((c) => c.state)).toEqual(['past', 'live', 'future']);
  });

  it('regner et program der lige er sluttet for slut', () => {
    const cells = layoutRow(
      [programme('2026-09-05T19:00:00.000Z', '2026-09-05T19:15:00.000Z')],
      WINDOW_START,
      WINDOW_END,
      NOW,
    );
    expect(cells[0]?.state).toBe('past');
  });

  it('giver en tom raekke for et ugyldigt vindue', () => {
    expect(layoutRow([], WINDOW_END, WINDOW_START, NOW)).toEqual([]);
  });

  it('giver hver celle en noegle der er unik i raekken', () => {
    const cells = layoutRow(
      [
        programme('2026-09-05T19:00:00.000Z', '2026-09-05T19:30:00.000Z'),
        programme('2026-09-05T20:00:00.000Z', '2026-09-05T20:30:00.000Z'),
      ],
      WINDOW_START,
      WINDOW_END,
      NOW,
    );
    expect(new Set(cells.map((c) => c.key)).size).toBe(cells.length);
  });
});

describe('guideAction', () => {
  const NOW = new Date('2026-09-05T19:15:00.000Z');
  const withArchive = { hasArchive: true };
  const withoutArchive = { hasArchive: false };

  function cellFor(startIso: string, stopIso: string) {
    const cells = layoutRow([programme(startIso, stopIso)], WINDOW_START, WINDOW_END, NOW);
    const cell = cells.find((c) => c.programme !== null);
    if (cell === undefined) throw new Error('ingen programcelle i testens opsaetning');
    return cell;
  }

  it('sendes nu: afspil kanalen', () => {
    const cell = cellFor('2026-09-05T19:00:00.000Z', '2026-09-05T19:30:00.000Z');
    expect(guideAction(cell, withArchive, true)).toBe('play');
    // Uden arkiv og uden dialekt er live stadig live.
    expect(guideAction(cell, withoutArchive, false)).toBe('play');
  });

  it('er slut, og kanalen har arkiv: start forfra', () => {
    const cell = cellFor('2026-09-05T19:00:00.000Z', '2026-09-05T19:10:00.000Z');
    expect(guideAction(cell, withArchive, true)).toBe('restart');
  });

  it('er slut, uden arkiv: ingenting', () => {
    const cell = cellFor('2026-09-05T19:00:00.000Z', '2026-09-05T19:10:00.000Z');
    expect(guideAction(cell, withoutArchive, true)).toBe('none');
  });

  it('er slut, men panelets dialekt er ukendt: ingenting', () => {
    // Uden dialekt kan der ikke bygges en arkiv-URL, uanset hvad kanalen
    // paastaar om sit arkiv.
    const cell = cellFor('2026-09-05T19:00:00.000Z', '2026-09-05T19:10:00.000Z');
    expect(guideAction(cell, withArchive, false)).toBe('none');
  });

  it('kommer senere: ingenting, ogsaa med arkiv', () => {
    const cell = cellFor('2026-09-05T20:00:00.000Z', '2026-09-05T20:30:00.000Z');
    expect(guideAction(cell, withArchive, true)).toBe('none');
  });

  it('kommer senere, uden arkiv: ingenting', () => {
    // Der findes ingen vej til udsendelsen bagefter, saa der er intet at love.
    const cell = cellFor('2026-09-05T20:00:00.000Z', '2026-09-05T20:30:00.000Z');
    expect(guideAction(cell, withoutArchive, true)).toBe('none');
  });

  it('kommer senere, men dialekten er ukendt: ingenting', () => {
    const cell = cellFor('2026-09-05T20:00:00.000Z', '2026-09-05T20:30:00.000Z');
    expect(guideAction(cell, withArchive, false)).toBe('none');
  });


  it('hul: ingenting', () => {
    const [gap] = layoutRow([], WINDOW_START, WINDOW_END, NOW);
    expect(gap).toBeDefined();
    expect(guideAction(gap as NonNullable<typeof gap>, withArchive, true)).toBe('none');
  });
});

describe('programmeOptions', () => {
  const withArchive = { hasArchive: true };
  const withoutArchive = { hasArchive: false };

  it('giver en afsluttet udsendelse kun start forfra', () => {
    // Man har rullet tilbage til noget bestemt. Kanalen live og optagelse
    // hoerer til den der sendes nu.
    expect(programmeOptions('past', withArchive, true)).toEqual({
      play: false,
      restart: true,
    });
  });

  it('giver den der sendes nu alle tre', () => {
    expect(programmeOptions('live', withArchive, true)).toEqual({
      play: true,
      restart: true,
    });
  });

  it('kan ikke starte fremtiden forfra', () => {
    expect(programmeOptions('future', withArchive, true).restart).toBe(false);
  });

  it('tilbyder kun live naar kanalen ingen arkiv har', () => {
    expect(programmeOptions('past', withoutArchive, true)).toEqual({
      play: true,
      restart: false,
    });
  });

  it('tilbyder kun live naar dialekten mangler', () => {
    expect(programmeOptions('live', withArchive, false)).toEqual({
      play: true,
      restart: false,
    });
  });

  it('tilbyder ingenting ud over live i et hul i programdata', () => {
    const options = programmeOptions('gap', withArchive, true);
    expect(options.restart).toBe(false);
  });
});

describe('shiftedWindow', () => {
  const now = new Date('2026-09-06T19:07:00');

  it('forankrer til den halve time ved nul', () => {
    const window = shiftedWindow(now, 0);
    expect(window.start.getHours()).toBe(19);
    expect(window.start.getMinutes()).toBe(0);
    expect(window.end.getHours()).toBe(21);
  });

  it('flytter sig praecis saa mange minutter som der bliver bedt om', () => {
    const window = shiftedWindow(now, 35);
    expect(window.start.getHours()).toBe(19);
    expect(window.start.getMinutes()).toBe(35);
  });

  it('flytter sig bagud paa et negativt tal', () => {
    const window = shiftedWindow(now, -120);
    expect(window.start.getHours()).toBe(17);
  });

  // Uden graensen kan man traekke ud i en tomhed hvor hverken arkiv eller
  // programoversigt naar hen, og en guide man kan blive ved med at traekke i
  // uden at der kommer noget, ligner en app der har mistet sine data.
  it('holder sig inden for en uge til hver side', () => {
    const far = shiftedWindow(now, 99 * 24 * 60);
    expect(far.start.getTime()).toBe(shiftedWindow(now, DRAG_MAX_MINUTES).start.getTime());
    const back = shiftedWindow(now, -99 * 24 * 60);
    expect(back.start.getTime()).toBe(shiftedWindow(now, DRAG_MIN_MINUTES).start.getTime());
  });
});

describe('dragMinutes', () => {
  // En finger der flytter sig en hel gitterbredde skal flytte tiden et helt
  // vindue: saa foelger programmet under fingeren med fingeren.
  it('flytter et helt vindue naar fingeren flytter sig en hel bredde', () => {
    expect(dragMinutes(-300, 300, 5)).toBe(WINDOW_MINUTES);
  });

  it('gaar modsat fingeren, som naar man skubber et stykke papir', () => {
    expect(dragMinutes(150, 300, 5)).toBe(-WINDOW_MINUTES / 2);
  });

  it('trapper til hele skridt', () => {
    // 4 px af 300 er 1,6 minutter. Uden trappen ville hver pixel tegne
    // gitteret om for et minuttal ingen kan se forskel paa.
    expect(dragMinutes(-4, 300, 5)).toBe(0);
    expect(dragMinutes(-10, 300, 5)).toBe(5);
  });

  it('giver nul foer bredden er maalt', () => {
    expect(dragMinutes(-120, 0, 5)).toBe(0);
  });
});

describe('nowRatio', () => {
  const start = new Date('2026-09-06T19:00:00');
  const end = new Date('2026-09-06T21:00:00');

  it('giver andelen af vinduet', () => {
    expect(nowRatio(new Date('2026-09-06T20:00:00'), start, end)).toBe(0.5);
    expect(nowRatio(new Date('2026-09-06T19:30:00'), start, end)).toBe(0.25);
  });

  it('rammer kanterne praecist', () => {
    expect(nowRatio(start, start, end)).toBe(0);
    expect(nowRatio(end, start, end)).toBe(1);
  });

  // Det vigtige: har man trukket guiden hen et andet sted, skal stregen
  // **vaek**. En streg klistret til kanten ville paastaa at klokken er noget
  // den ikke er.
  it('giver null naar nu ligger uden for vinduet', () => {
    expect(nowRatio(new Date('2026-09-06T18:59:00'), start, end)).toBeNull();
    expect(nowRatio(new Date('2026-09-06T21:01:00'), start, end)).toBeNull();
  });

  it('giver null paa et vindue uden laengde', () => {
    expect(nowRatio(start, start, start)).toBeNull();
  });
});

describe('offsetForTarget', () => {
  const now = new Date('2026-09-08T19:07:00');

  it('stiller vinduet paa klokkeslaettet den dag, regnet fra den halve time foer nu', () => {
    // Nu forankres til 19:00. I aften kl. 20 er 60 minutter frem.
    expect(offsetForTarget(now, 0, 20)).toBe(60);
    expect(shiftedWindow(now, offsetForTarget(now, 0, 20)).start.getHours()).toBe(20);
    // I morgen kl. 20: et doegn og en time.
    expect(offsetForTarget(now, 1, 20)).toBe(24 * 60 + 60);
    // I gaar kl. 20.
    expect(offsetForTarget(now, -1, 20)).toBe(-23 * 60);
  });

  it('holder sig inden for traekkets spaend', () => {
    expect(offsetForTarget(now, 30, 20)).toBe(DRAG_MAX_MINUTES);
    expect(offsetForTarget(now, -30, 20)).toBe(DRAG_MIN_MINUTES);
  });
});
