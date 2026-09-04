import { describe, expect, it } from 'vitest';
import { parseM3u } from './m3u/parser.js';
import { createXmltvParser } from './epg/parser.js';
import { parseXmltvTimestamp } from './epg/timestamp.js';
import { buildTimeshiftUrl } from './urls.js';
import type { Programme } from './models.js';
import type { XtreamCredentials } from './models.js';

const creds: XtreamCredentials = {
  baseUrl: 'http://panel.example:8080',
  username: 'USER',
  password: 'PASS',
};

/**
 * Disse to tests dækker samlingen mellem m3u-, epg- og url-modulerne, som
 * hvert modul isoleret ikke kan bevise: at Channel.epgChannelId og
 * Programme.channelId rent faktisk matcher for samme kanal (inklusive et
 * kanal-id med et "&"), og at parseXmltvTimestamp og buildTimeshiftUrl er
 * enige om, hvordan et panels tidszoneoffset anvendes.
 */
describe('sammenkobling mellem m3u, epg og urls', () => {
  it('Channel.epgChannelId fra M3U matcher Programme.channelId fra XMLTV, også med & i id', () => {
    const playlist =
      '#EXTINF:-1 tvg-id="news&weather" tvg-name="Nyheder",Nyheder & Vejr\n' +
      'http://panel.example:8080/live/USER/PASS/1.ts\n';
    const entries = parseM3u(playlist);
    const channel = entries[0]?.channel;
    expect(channel?.epgChannelId).toBe('news&weather');

    const xml =
      '<tv><programme start="20260904200000 +0000" stop="20260904210000 +0000" ' +
      'channel="news&amp;weather"><title>Aftennyheder</title></programme></tv>';
    const programmes: Programme[] = [];
    const parser = createXmltvParser((p) => programmes.push(p));
    parser.write(xml);
    parser.end();

    expect(programmes).toHaveLength(1);
    expect(programmes[0]?.channelId).toBe(channel?.epgChannelId);
  });

  it('parseXmltvTimestamp og buildTimeshiftUrl er enige om panelets tidszonekonvention', () => {
    // parseXmltvTimestamp trækker offset fra for at få UTC;
    // buildTimeshiftUrl/formatTimeshiftStart lægger panelOffsetMinutes til
    // for at komme tilbage til panelets lokale tid. For samme offset (+0200
    // svarende til 120 minutter) skal de to operationer ophæve hinanden, så
    // vi ender med det oprindelige lokale klokkeslæt.
    const parsed = parseXmltvTimestamp('20260904200000 +0200');
    expect(parsed).not.toBeNull();

    const url = buildTimeshiftUrl(creds, '1', parsed as Date, 60, 'php', 120);
    expect(decodeURIComponent(url)).toContain('start=2026-09-04:20-00');
  });
});
