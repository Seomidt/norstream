/**
 * En kilde er ét sted kanaler kommer fra: et Xtream-panel eller en M3U-liste.
 *
 * Modellen findes fordi to kilder uvaegerligt bruger de samme id'er. Xtreams
 * `stream_id` er et loebenummer der starter forfra hos hver udbyder, og to
 * paneler har begge en kanal 1. Uden en noegle der ogsaa siger *hvorfra*,
 * ville den ene udbyders DR1 overskrive den andens i det oejeblik listen blev
 * synkroniseret — og favoritter, optagelser og programdata ville pege paa den
 * forkerte kanal uden at nogen kunne se det.
 */

export type SourceKind =
  /** Et Xtream Codes-panel: kategorier, kanaler, EPG og arkiv over et API. */
  | 'xtream'
  /** En M3U-spilleliste: en flad liste med URL'er, og ingen EPG i sig selv. */
  | 'm3u';

export interface Source {
  /** Genereret af appen. Indeholder aldrig ':' — se `channelKey`. */
  id: string;
  kind: SourceKind;
  /** Brugerens eget navn paa kilden, fx "Hovedpanel" eller "Sport". */
  name: string;
  /** Xtream: panelets basis-URL. M3U: adressen paa selve listen. */
  url: string;
  /** Kun Xtream. Adgangskoden ligger i Keychain, aldrig her. */
  username: string | null;
  /**
   * Kun M3U, og valgfri. En M3U-liste rummer ingen programoversigt; skal
   * guiden virke for kilden, skal der peges paa en XMLTV-adresse ved siden af.
   */
  xmltvUrl: string | null;
  enabled: boolean;
  sortOrder: number;
}

/**
 * Skilletegnet mellem kilde og kanal i en noegle.
 *
 * Kolon fordi appen selv laver kilde-id'erne og kan holde det ude af dem.
 * Kanalens eget id kommer derimod udefra og kan indeholde hvad som helst —
 * derfor deles der ved det **foerste** kolon, ikke det sidste.
 */
const SEPARATOR = ':';

/** Sandt for et id appen selv kan bruge som kildenoegle. */
export function isValidSourceId(id: string): boolean {
  return id.length > 0 && !id.includes(SEPARATOR);
}

/**
 * Den globale noegle for en kanal.
 *
 * Det er den der staar i `channels.id`, i favoritter, i optagelser og som
 * `programmes.channel_id`. Alt hvad appen gemmer om en kanal, haenger paa den.
 */
export function channelKey(sourceId: string, streamId: string): string {
  return `${sourceId}${SEPARATOR}${streamId}`;
}

export interface ChannelKeyParts {
  sourceId: string;
  /** Kanalens id hos kilden — Xtreams `stream_id`, eller M3U'ens udledte id. */
  streamId: string;
}

/**
 * Deler en noegle op igen. `null` naar strengen ikke er en noegle.
 *
 * Bruges hver gang der skal tales med kilden: opslag i EPG, en stream-URL, et
 * arkiv-udsnit. Uden kilde-delen ved appen ikke hvilket panel den skal spoerge.
 */
export function parseChannelKey(key: string): ChannelKeyParts | null {
  const index = key.indexOf(SEPARATOR);
  if (index <= 0 || index === key.length - 1) return null;
  return { sourceId: key.slice(0, index), streamId: key.slice(index + 1) };
}
