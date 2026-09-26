import { describe, expect, it } from 'vitest';
import { mapEpgListings } from './epgListings.js';

/** "TV Avisen" */
const TITLE = 'VFYgQXZpc2Vu';
/** "Nyheder fra Danmarks Radio" */
const DESCRIPTION = 'TnloZWRlciBmcmEgRGFubWFya3MgUmFkaW8=';

function listing(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: TITLE,
    description: DESCRIPTION,
    start_timestamp: '1757088000',
    stop_timestamp: '1757089800',
    ...overrides,
  };
}

describe('mapEpgListings', () => {
  it('afkoder titel og beskrivelse og omsaetter epoch-sekunder', () => {
    const [programme] = mapEpgListings('247634', { epg_listings: [listing()] });

    expect(programme).toEqual({
      channelId: '247634',
      title: 'TV Avisen',
      description: 'Nyheder fra Danmarks Radio',
      start: new Date(1757088000_000),
      stop: new Date(1757089800_000),
    });
  });

  it('bruger kalderens stream_id, ikke svarets channel_id', () => {
    // Hele pointen i omlaegningen: opslaget sker paa stream_id, og det er
    // den noegle programmerne skal gemmes under.
    const [programme] = mapEpgListings('247634', {
      epg_listings: [listing({ channel_id: 'dr1.dk' })],
    });
    expect(programme?.channelId).toBe('247634');
  });

  it('accepterer et bart array uden epg_listings-indpakning', () => {
    expect(mapEpgListings('1', [listing()])).toHaveLength(1);
  });

  it('accepterer tidsstempler som tal', () => {
    const [programme] = mapEpgListings('1', [
      listing({ start_timestamp: 1757088000, stop_timestamp: 1757089800 }),
    ]);
    expect(programme?.start).toEqual(new Date(1757088000_000));
  });

  it('accepterer end_timestamp som alias for stop_timestamp', () => {
    const raw = listing();
    delete raw.stop_timestamp;
    const [programme] = mapEpgListings('1', [{ ...raw, end_timestamp: '1757089800' }]);
    expect(programme?.stop).toEqual(new Date(1757089800_000));
  });

  it('sorterer efter starttidspunkt, saa guiden ikke skal sortere igen', () => {
    const programmes = mapEpgListings('1', [
      listing({ start_timestamp: '1757095200', stop_timestamp: '1757098800' }),
      listing({ start_timestamp: '1757088000', stop_timestamp: '1757091600' }),
    ]);
    expect(programmes.map((p) => p.start.getTime())).toEqual([
      1757088000_000, 1757095200_000,
    ]);
  });

  it('springer poster over uden laesbar titel', () => {
    expect(mapEpgListings('1', [listing({ title: undefined })])).toEqual([]);
    expect(mapEpgListings('1', [listing({ title: '' })])).toEqual([]);
    // Ikke base64: bliver til en klump vi ikke vil vise som programtitel.
    expect(mapEpgListings('1', [listing({ title: '!!!' })])).toEqual([]);
  });

  it('beholder posten naar kun beskrivelsen er beskadiget', () => {
    const [programme] = mapEpgListings('1', [listing({ description: '!!!' })]);
    expect(programme?.title).toBe('TV Avisen');
    expect(programme?.description).toBeNull();
  });

  it('springer poster over uden brugbare tidsstempler', () => {
    expect(mapEpgListings('1', [listing({ start_timestamp: undefined })])).toEqual([]);
    expect(mapEpgListings('1', [listing({ stop_timestamp: 'i morgen' })])).toEqual([]);
    expect(mapEpgListings('1', [listing({ start_timestamp: '0' })])).toEqual([]);
  });

  it('springer poster over hvor sluttidspunktet ikke ligger efter starten', () => {
    // Ville give en celle med nul eller negativ bredde i guiden.
    expect(mapEpgListings('1', [listing({ stop_timestamp: '1757088000' })])).toEqual([]);
    expect(mapEpgListings('1', [listing({ stop_timestamp: '1757087000' })])).toEqual([]);
  });

  it('taaler svar der slet ikke ligner en programoversigt', () => {
    for (const raw of [null, undefined, 42, 'fejl', {}, { epg_listings: 'nej' }]) {
      expect(mapEpgListings('1', raw)).toEqual([]);
    }
    expect(mapEpgListings('1', [null, 7, ['nej'], listing()])).toHaveLength(1);
  });
});
