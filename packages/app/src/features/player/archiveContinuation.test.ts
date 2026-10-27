import { describe, expect, it } from 'vitest';
import { archiveComplete, archiveCompleteAt, archiveContinuation, archivePlaybackBounds, archiveWindow, LIVE_EDGE_LAG_MS, RESTART_SETTLE_MS } from './archiveContinuation.js';

const at = (hhmm: string): number => new Date(`2026-09-24T${hhmm}:00.000Z`).getTime();
const show = { start: new Date(at('20:00')), stop: new Date(at('21:00')) };

describe('archiveContinuation', () => {
  it('fortsaetter fra det punkt man naaede, naar arkivet sluttede midt i', () => {
    // Startet forfra kl. 20:30: arkivet gik til 20:30. Nu er klokken 21:10.
    const next = archiveContinuation(show, at('20:00'), 30 * 60, at('21:10'));
    expect(next).toEqual({ kind: 'continue', from: new Date(at('20:30')), seekSeconds: 0, minutes: 30 });
  });

  it('runder ned til hele minutter og spoler resten frem', () => {
    const next = archiveContinuation(show, at('20:00'), 30 * 60 + 42, at('21:10'));
    expect(next).toEqual({ kind: 'continue', from: new Date(at('20:30')), seekSeconds: 42, minutes: 30 });
  });

  it('starter naeste minut ved 120 s uden et helt minuts overlap fra en millisekunds afrunding', () => {
    for (const seconds of [120, 119.999, 119.999999, 120.000001]) {
      expect(archiveContinuation(show, at('20:00'), seconds, at('20:06')))
        .toEqual({ kind: 'continue', from: new Date(at('20:02')), seekSeconds: 0, minutes: 2 });
    }
  });

  it('et stykke der slutter op til 5 s foer minuttet fortsaetter fra minuttet uden overlap (v424)', () => {
    // v419-loggen: 8 min bestilt fra 20:00, stroemmen sluttede ved 478,290 s.
    // Foer: fra 20:07 med 58,290 s spoling og et helt minut hentet igen.
    expect(archiveContinuation(show, at('20:00'), 478.29, at('20:18') + 20_000))
      .toEqual({ kind: 'continue', from: new Date(at('20:08')), seekSeconds: 0, minutes: 8 });
    for (const seconds of [119.75, 119, 115, 120, 119.999, 120.000001]) {
      expect(archiveContinuation(show, at('20:00'), seconds, at('20:06')))
        .toEqual({ kind: 'continue', from: new Date(at('20:02')), seekSeconds: 0, minutes: 2 });
    }
    // TV2-loggen: 179,340 s af 3 min -> 20:06 uden spoling; 596 s af 10 min -> 20:10.
    expect(archiveContinuation(show, at('20:03'), 179.34, at('20:10')))
      .toMatchObject({ kind: 'continue', from: new Date(at('20:06')), seekSeconds: 0 });
    expect(archiveContinuation(show, at('20:00'), 596, at('20:22')))
      .toMatchObject({ kind: 'continue', from: new Date(at('20:10')), seekSeconds: 0 });
  });

  it('bevarer reelle sekunder naar stykket sluttede mere end 5 s foer minuttet', () => {
    expect(archiveContinuation(show, at('20:00'), 114.9, at('20:06')))
      .toMatchObject({ kind: 'continue', from: new Date(at('20:01')), seekSeconds: 54.9 });
    expect(archiveContinuation(show, at('20:01'), 154, at('20:08')))
      .toMatchObject({ kind: 'continue', from: new Date(at('20:03')), seekSeconds: 34 });
    expect(archiveContinuation(show, at('20:00'), 30 * 60 + 42, at('21:10')))
      .toMatchObject({ kind: 'continue', from: new Date(at('20:30')), seekSeconds: 42 });
  });

  it('beder aldrig om arkiv ud i fremtiden paa en udsendelse der stadig sendes (v347)', () => {
    // Kl. 20:30: arkivet gik til 20:10 (hentet kl. 20:11). Naeste stykke gaar
    // kun til lidt foer nu (20:28:30), ikke til udsendelsens slutning 21:00.
    const next = archiveContinuation(show, at('20:00'), 10 * 60, at('20:30'));
    expect(next).toEqual({ kind: 'continue', from: new Date(at('20:10')), seekSeconds: 0, minutes: 18 });
  });

  it('regner fra det nye stykke, naar der allerede er fortsat én gang', () => {
    const next = archiveContinuation(show, at('20:30'), 10 * 60, at('21:10'));
    expect(next).toMatchObject({ kind: 'continue', from: new Date(at('20:40')), minutes: 20 });
  });

  it('skifter til live, naar live er indhentet og udsendelsen stadig sendes', () => {
    expect(archiveContinuation(show, at('20:00'), 40 * 60, at('20:40'))).toEqual({ kind: 'live' });
  });

  it('goer intet, naar udsendelsen er set til ende', () => {
    expect(archiveContinuation(show, at('20:00'), 59 * 60 + 59, at('22:00'))).toEqual({ kind: 'done' });
  });

  it('afspiller de sidste 25 sekunder i stedet for at regne dem som faerdige', () => {
    expect(archiveContinuation(show, at('20:00'), 59 * 60 + 35, at('22:00')))
      .toEqual({ kind: 'continue', from: new Date(at('20:59')), seekSeconds: 35, minutes: 1 });
  });

  it('venter paa den sidste del af et program der sluttede for 30 sekunder siden', () => {
    expect(archiveContinuation(show, at('20:00'), 59 * 60, at('21:00') + 30_000)).toEqual({ kind: 'wait' });
    expect(archiveContinuation(show, at('20:00'), 59 * 60, at('21:00') + 90_000))
      .toEqual({ kind: 'continue', from: new Date(at('20:59')), seekSeconds: 0, minutes: 1 });
  });

  it('venter paa det naeste arkivminut i stedet for at gentage det samme eller springe til live', () => {
    expect(archiveContinuation(show, at('20:00'), 28 * 60 + 40, at('20:30'))).toEqual({ kind: 'wait' });
    expect(archiveContinuation(show, at('20:00'), 28 * 60 + 40, at('20:31')))
      .toEqual({ kind: 'continue', from: new Date(at('20:28')), seekSeconds: 40, minutes: 1 });
  });

  it('holder 90 s afstand efter afrunding, ogsaa i hver af minutternes 60 sekunder', () => {
    for (let second = 0; second < 60; second += 1) {
      const now = at('20:30') + second * 1000;
      const window = archiveWindow(show, show.start, 0, now)!;
      expect(window.from.getTime() + window.minutes * 60_000).toBeLessThanOrEqual(now - LIVE_EDGE_LAG_MS);
    }
  });

  it('lover ikke et arkiv ud i fremtiden naar udsendelsen netop er startet', () => {
    expect(archiveWindow(show, show.start, 0, at('20:01'))).toBeNull();
    expect(archiveWindow(show, show.start, 0, at('20:02'))).toBeNull();
    expect(archiveWindow(show, show.start, 0, at('20:02') + 30_000))
      .toEqual({ from: show.start, seekSeconds: 0, minutes: 1 });
  });

  it('flytter et langt resume til det rigtige arkivminut og bevarer programmets sekunder', () => {
    const start = new Date(at('20:00') + 25_000);
    expect(archiveWindow({ ...show, start }, start, 320, at('22:00')))
      .toEqual({ from: new Date(at('20:05')), seekSeconds: 45, minutes: 55 });
  });

  it('genoptager paa praecis samme absolutte sted ved alle 60 sekunder i et arkivminut', () => {
    for (let second = 0; second < 60; second += 1) {
      const seek = 320 + second + 0.946;
      const window = archiveWindow(show, show.start, seek, at('22:00'))!;
      expect(window.seekSeconds).toBeGreaterThanOrEqual(0);
      expect(window.seekSeconds).toBeLessThan(60);
      expect(window.from.getTime() + window.seekSeconds * 1000).toBe(show.start.getTime() + seek * 1000);
    }
  });

  it('ser en hel igangvaerende times udsendelse uden huller eller gentagne minutter', () => {
    let now = at('20:10');
    let reached = show.start.getTime();
    let window = archiveWindow(show, show.start, 0, now)!;
    let requests = 1;
    for (let second = 0; second < 3600; second += 1) {
      reached += 1000;
      now += 1000;
      if (reached < window.from.getTime() + window.minutes * 60_000) continue;
      const next = archiveContinuation(show, window.from.getTime(), (reached - window.from.getTime()) / 1000, now);
      if (next.kind === 'done') {
        expect(reached).toBe(show.stop.getTime());
        break;
      }
      expect(next.kind).toBe('continue');
      if (next.kind !== 'continue') throw new Error('arkivets fremdrift gik i staa');
      expect(next.from.getTime() + next.seekSeconds * 1000).toBe(reached);
      window = next;
      requests += 1;
    }
    expect(reached).toBe(show.stop.getTime());
    expect(requests).toBeGreaterThan(1);
  });
});

describe('slutmargen efter programguiden', () => {
  const news = { start: new Date(at('18:00')), stop: new Date(at('18:20')) };

  it('TV2-loggens 17 min + 179.340 s naar EPG-slut og stopper der uden et nyt stykke (v425)', () => {
    const bounds = archivePlaybackBounds(news);
    expect(archiveWindow(bounds, news.start, 0, at('18:19') + 8546))
      .toEqual({ from: news.start, seekSeconds: 0, minutes: 17 });
    expect(archiveContinuation(bounds, at('18:00'), 1020.379, at('18:36') + 10171))
      .toMatchObject({ kind: 'continue', from: new Date(at('18:17')), seekSeconds: 0.379, minutes: 17 });
    // 179,340 s er 0,66 s foer 18:20 og regnes som 18:20 (v424). Foer v425 blev
    // slutmargenen hentet som et nyt stykke fra 18:20; det stykkeskift efter
    // udsendelsens slutning var det der froes. Nu er udsendelsen set til ende.
    expect(archiveContinuation(bounds, at('18:17'), 179.340, at('18:39') + 8451))
      .toEqual({ kind: 'done' });
    expect(archiveContinuation(bounds, at('18:19'), 960 - 0.66, at('18:55')))
      .toEqual({ kind: 'done' });
    expect(news.stop.getTime()).toBe(at('18:20'));
  });

  it('stopper ikke fordi udsendelsen slutter mens man ser den forsinket, kun naar stroemmen naar EPG-slut', () => {
    const bounds = archivePlaybackBounds(news);
    // Stykket sluttede 18:01, laenge foer EPG-slut: fortsaet, selv om klokken nu er 18:20.
    expect(archiveContinuation(bounds, at('18:00'), 60, at('18:20')))
      .toMatchObject({ kind: 'continue', from: new Date(at('18:01')) });
    // Stroemmen naaede EPG-slut (eller lidt forbi): set til ende, ingen slutmargen hentes (v425).
    expect(archiveContinuation(bounds, at('18:00'), 20 * 60, at('18:40')))
      .toEqual({ kind: 'done' });
    expect(archiveContinuation(bounds, at('18:00'), 21 * 60, at('18:21')))
      .toEqual({ kind: 'done' });
  });

  it('et stykke inde i slutmargenen afsluttes, og der bestilles aldrig fremtidige minutter', () => {
    const bounds = archivePlaybackBounds(news);
    // Foer v425: vent paa panelets naeste minut. Nu er udsendelsen set til ende ved EPG-slut.
    expect(archiveContinuation(bounds, at('18:34'), 0, at('18:35'))).toEqual({ kind: 'done' });
    for (let second = 0; second < 60; second += 1) {
      const now = at('18:22') + second * 1000;
      const window = archiveWindow(bounds, new Date(at('18:19')), 59.34, now);
      if (window !== null) expect(window.from.getTime() + window.minutes * 60_000).toBeLessThanOrEqual(now - LIVE_EDGE_LAG_MS);
    }
  });

  it('bevarer slutgraensen ved nye stykker uden at aendre EPG-programmet', () => {
    const bounds = archivePlaybackBounds(news, at('18:40'));
    const window = archiveWindow(bounds, new Date(at('18:24')), 59.34, at('18:50'))!;
    expect(window).toEqual({ from: new Date(at('18:24')), seekSeconds: 59.34, minutes: 16 });
    expect(archivePlaybackBounds(news, bounds.stop.getTime()).stop.getTime()).toBe(at('18:40'));
    // Et stykke der sluttede foer EPG-slut fortsaetter til den bevarede graense 18:40, ikke 18:35.
    expect(archiveContinuation(bounds, at('18:10'), 60, at('18:50')))
      .toMatchObject({ kind: 'continue', from: new Date(at('18:11')), seekSeconds: 0, minutes: 29 });
    expect(archivePlaybackBounds(news, NaN).stop.getTime()).toBe(at('18:35'));
    expect(news.stop.getTime()).toBe(at('18:20'));
  });
});

describe('start forfra kun for afsluttede udsendelser (v425)', () => {
  const news = { start: new Date(at('18:00')), stop: new Date(at('18:20')) };
  const bounds = archivePlaybackBounds(news);

  it('en faerdig udsendelse hvis stroem slutter praecis ved EPG-slut er set til ende', () => {
    expect(archiveContinuation(bounds, at('18:00'), 20 * 60, at('18:40'))).toEqual({ kind: 'done' });
    // Panelets stykke slutter 1-2 s foer det bestilte minut (v424): regnes stadig som EPG-slut.
    expect(archiveContinuation(bounds, at('18:00'), 20 * 60 - 1.5, at('18:40'))).toEqual({ kind: 'done' });
    // Men 7 s foer EPG-slut leverede panelet for lidt: de sidste sekunder hentes som hidtil.
    expect(archiveContinuation(bounds, at('18:00'), 20 * 60 - 7, at('18:40')))
      .toMatchObject({ kind: 'continue', from: new Date(at('18:19')), seekSeconds: 53 });
  });

  it('et stykke der ramte den levende kant inde i slutmargenen afsluttes uden et nyt stykke', () => {
    // Startet forfra kl. 18:22:30, lige efter at udsendelsen blev komplet: stykket gaar til 18:21.
    expect(archiveWindow(bounds, news.start, 0, at('18:22') + 30_000))
      .toEqual({ from: news.start, seekSeconds: 0, minutes: 21 });
    expect(archiveContinuation(bounds, at('18:00'), 21 * 60, at('18:44'))).toEqual({ kind: 'done' });
    // Ogsaa naar stykket sluttede foer margenens egen slutning kl. 18:35.
    expect(archiveContinuation(bounds, at('18:00'), 30 * 60, at('18:50'))).toEqual({ kind: 'done' });
    expect(archiveContinuation(bounds, at('18:19'), 960 - 0.66, at('18:55'))).toEqual({ kind: 'done' });
  });

  it('en udsendelse der stadig sendes skifter til live ved kanten som hidtil', () => {
    expect(archiveContinuation(bounds, at('18:00'), 10 * 60, at('18:10'))).toEqual({ kind: 'live' });
    expect(archiveContinuation(show, at('20:00'), 40 * 60, at('20:40'))).toEqual({ kind: 'live' });
  });

  it('et stykke der slutter midt i udsendelsen fortsaetter eller venter som hidtil', () => {
    expect(archiveContinuation(bounds, at('18:00'), 10 * 60, at('18:40')))
      .toEqual({ kind: 'continue', from: new Date(at('18:10')), seekSeconds: 0, minutes: 25 });
    expect(archiveContinuation(bounds, at('18:00'), 18 * 60 + 40, at('18:20'))).toEqual({ kind: 'wait' });
    expect(archiveContinuation(bounds, at('18:00'), 18 * 60 + 40, at('18:21')))
      .toEqual({ kind: 'continue', from: new Date(at('18:18')), seekSeconds: 40, minutes: 1 });
  });

  it('archiveComplete: slut og 120 s senere helt i arkivet', () => {
    expect(RESTART_SETTLE_MS).toBe(120_000);
    expect(archiveComplete(news, at('18:19'))).toBe(false);
    expect(archiveComplete(news, at('18:20'))).toBe(false);
    expect(archiveComplete(news, at('18:22') - 1)).toBe(false);
    expect(archiveComplete(news, at('18:22'))).toBe(true);
    expect(archiveComplete(news, at('18:40'))).toBe(true);
  });

  it('archiveComplete runder en sluttid midt i et minut op, saa ét stykke daekker udsendelsen', () => {
    const odd = { start: new Date(at('18:00')), stop: new Date(at('18:20') + 20_000) };
    expect(archiveComplete(odd, at('18:22') + 20_000)).toBe(false);
    expect(archiveComplete(odd, at('18:23') - 1)).toBe(false);
    expect(archiveComplete(odd, at('18:23'))).toBe(true);
    // Ved graensen bestilles et stykke der naar forbi EPG-slut, og det afsluttes dér.
    const odds = archivePlaybackBounds(odd);
    expect(archiveWindow(odds, odd.start, 0, at('18:23'))).toEqual({ from: odd.start, seekSeconds: 0, minutes: 21 });
    expect(archiveContinuation(odds, at('18:00'), 21 * 60, at('18:44'))).toEqual({ kind: 'done' });
    // Regnet fra den raa sluttid (18:22:20) ville stykket ende 18:20:00, 20 s
    // foer EPG-slut, og de sidste sekunder blev hentet som et nyt stykke ved kanten.
    expect(archiveWindow(odds, odd.start, 0, at('18:22') + 20_000)).toEqual({ from: odd.start, seekSeconds: 0, minutes: 20 });
    expect(archiveContinuation(odds, at('18:00'), 20 * 60, at('18:42')).kind).toBe('continue');
  });

  it('en fejl inde i slutmargenen genforbinder fra det naaede punkt i stedet for at afslutte', () => {
    // Kampen 20:00-21:00 startet forfra kl. 22:00: ét stykke 20:00-21:15.
    const match = archivePlaybackBounds(show);
    expect(archiveWindow(match, show.start, 0, at('22:00'))).toEqual({ from: show.start, seekSeconds: 0, minutes: 75 });
    // Et haeng kl. 21:05 i indholdet (kampen traekker over): fortsaet derfra, som foer v425.
    expect(archiveContinuation(match, at('20:00'), 65 * 60, at('23:05'), false))
      .toEqual({ kind: 'continue', from: new Date(at('21:05')), seekSeconds: 0, minutes: 10 });
    // Sluttede stykket selv dér, er udsendelsen set til ende (standard).
    expect(archiveContinuation(match, at('20:00'), 65 * 60, at('23:05'))).toEqual({ kind: 'done' });
    expect(archiveContinuation(match, at('20:00'), 65 * 60, at('23:05'), true)).toEqual({ kind: 'done' });
    // Selve slutgraensen gaelder ogsaa ved en fejl.
    expect(archiveContinuation(match, at('20:00'), 75 * 60 - 1, at('23:05'), false)).toEqual({ kind: 'done' });
    // Og foer EPG-slut aendrer flaget intet.
    expect(archiveContinuation(match, at('20:00'), 30 * 60, at('23:05'), false))
      .toEqual({ kind: 'continue', from: new Date(at('20:30')), seekSeconds: 0, minutes: 45 });
  });
});

describe('archiveCompleteAt', () => {
  it('giver praecis det tidspunkt hvor archiveComplete bliver sand, ogsaa midt i et minut', () => {
    const whole = { stop: new Date('2026-10-25T18:20:00Z') };
    const mid = { stop: new Date('2026-10-25T18:20:20Z') };
    expect(archiveCompleteAt(whole)).toBe(new Date('2026-10-25T18:22:00Z').getTime());
    expect(archiveCompleteAt(mid)).toBe(new Date('2026-10-25T18:23:00Z').getTime());
    for (const programme of [whole, mid]) {
      const at = archiveCompleteAt(programme);
      expect(archiveComplete(programme, at - 1)).toBe(false);
      expect(archiveComplete(programme, at)).toBe(true);
    }
  });
});
