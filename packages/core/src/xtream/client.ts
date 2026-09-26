import type {
  Category,
  Channel,
  Episode,
  Programme,
  VodDetails,
  VodItem,
  XtreamCredentials,
} from '../models.js';
import { normaliseBaseUrl } from '../urls.js';
import { truthyFlag } from './coerce.js';
import { mapCategories, mapChannels } from './mapping.js';
import { panelOffsetFromServerInfo } from './serverInfo.js';
import { mapEpgListings } from './epgListings.js';
import { mapEpisodes, mapVodDetails, mapVodItems } from './vodMapping.js';

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  /**
   * Svarets krop som tekst.
   *
   * Paakraevet, og det er den vigtige del. Den var valgfri, og appens egen
   * `fetch`-indpakning gav den ikke videre — saa hver eneste ting der laeser
   * tekst frem for JSON fejlede stille paa telefonen: M3U-lister,
   * XMLTV-oversigter og det aabne logo-register. Alle tre saa ud til bare
   * "ikke at vaere hentet". Nu fanger oversaetteren den slags.
   */
  text(): Promise<string>;
  /**
   * Svarets krop som raa bytes. Valgfri — kun XMLTV-vejen bruger den, til at
   * pakke en gzippet (.xml.gz) programoversigt ud. De oevrige laesere (JSON,
   * tekst) roeres ikke, og indpakninger der ikke giver den, virker som foer.
   */
  arrayBuffer?(): Promise<ArrayBuffer>;
}

export type FetchLike = (url: string) => Promise<FetchLikeResponse>;

/** Credentials afvist af panelet. Appen skal rydde keychain og sende brugeren til onboarding. */
export class XtreamAuthError extends Error {
  constructor(message = 'Xtream-credentials blev afvist') {
    super(message);
    this.name = 'XtreamAuthError';
  }
}

/** Panelet kunne ikke nås eller svarede uforståeligt. Appen kan falde tilbage på cache. */
export class XtreamNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XtreamNetworkError';
  }
}

interface UserInfoResponse {
  user_info?: { auth?: number | string };
}

/** Kontoens tilstand hos panelet, fra `user_info`. */
export interface XtreamAccountInfo {
  /** Unix-sekunder for udloeb, eller `null` for ubegraenset / uoplyst. */
  expDate: number | null;
  /** Panelets status, fx `Active`, `Expired`, `Banned` — eller `null`. */
  status: string | null;
}

/** exp_date kan komme som tal eller talstreng; 0/""/null betyder ubegraenset. */
function parseExpDate(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

export class XtreamClient {
  private readonly baseUrl: string;

  constructor(
    private readonly creds: XtreamCredentials,
    private readonly fetchImpl: FetchLike,
  ) {
    this.baseUrl = normaliseBaseUrl(creds.baseUrl);
  }

  private endpoint(action?: string, params: Record<string, string> = {}): string {
    const query = [
      `username=${encodeURIComponent(this.creds.username)}`,
      `password=${encodeURIComponent(this.creds.password)}`,
    ];
    if (action) query.push(`action=${encodeURIComponent(action)}`);
    for (const [key, value] of Object.entries(params)) {
      query.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
    return `${this.baseUrl}/player_api.php?${query.join('&')}`;
  }

  private async request(
    action?: string,
    params: Record<string, string> = {},
  ): Promise<unknown> {
    let response: FetchLikeResponse;
    try {
      response = await this.fetchImpl(this.endpoint(action, params));
    } catch (cause) {
      throw new XtreamNetworkError(
        `Kunne ikke nå panelet: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new XtreamAuthError();
    }
    if (!response.ok) {
      throw new XtreamNetworkError(`Panelet svarede med HTTP ${response.status}`);
    }

    try {
      return await response.json();
    } catch (cause) {
      throw new XtreamNetworkError(
        `Panelets svar var ikke gyldig JSON: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  }

  /** Verificerer credentials. Kaster XtreamAuthError hvis panelet afviser dem. */
  async authenticate(): Promise<void> {
    const body = (await this.request()) as UserInfoResponse;
    const auth = body?.user_info?.auth;
    if (!truthyFlag(auth)) {
      throw new XtreamAuthError();
    }
  }

  /**
   * Kontoens udloebsdato og status, fra samme `user_info` som login.
   *
   * Til Indstillinger, saa man kan se hvornaar panelet udloeber. Et rent
   * opslag uden action — samme svar som `authenticate` laeser `auth` fra.
   */
  async getAccountInfo(): Promise<XtreamAccountInfo> {
    const body = (await this.request()) as {
      user_info?: { exp_date?: unknown; status?: unknown };
    };
    const info = body?.user_info;
    return {
      expDate: parseExpDate(info?.exp_date),
      status: typeof info?.status === 'string' ? info.status : null,
    };
  }

  async getLiveCategories(): Promise<Category[]> {
    return mapCategories(await this.requestList('get_live_categories'));
  }

  async getLiveStreams(): Promise<Channel[]> {
    return mapChannels(await this.requestList('get_live_streams'));
  }

  /**
   * Programoversigt for een kanal, slaaet op paa `stream_id`.
   *
   * Det er vejen uden om XMLTV-filen, som paa brugerens panel er 98 MB og
   * aldrig naar frem inden for en rimelig timeout. Svaret her er faa kilobyte.
   *
   * Bruger `request`, ikke `requestList`: svaret er et objekt med
   * `epg_listings`, ikke et bart array. `mapEpgListings` er tolerant over for
   * begge former og over for beskadigede poster.
   */
  async getShortEpg(streamId: string, limit = 12): Promise<Programme[]> {
    const body = await this.request('get_short_epg', {
      stream_id: streamId,
      limit: String(Math.max(1, Math.trunc(limit))),
    });
    return mapEpgListings(streamId, body);
  }

  /**
   * Hele programtabellen for een kanal — ogsaa bagud i tid.
   *
   * `get_short_epg` giver kun de naeste faa programmer. Det er nok til at vise
   * "nu og naeste", men ikke til arkivet: skal brugeren kunne starte gaars
   * aftenudsendelse, skal guiden kunne *vise* den foerst, og de programmer
   * findes kun her.
   *
   * Svaret er stoerre — typisk et par hundrede kilobyte for en kanal med en
   * uges tabel — saa det hentes per kanal og kun naar der er brug for det,
   * ikke for alle 22.142 kanaler.
   */
  async getFullEpg(streamId: string): Promise<Programme[]> {
    const body = await this.request('get_simple_data_table', { stream_id: streamId });
    return mapEpgListings(streamId, body);
  }

  /**
   * Panelets offset fra UTC i minutter, eller `null` hvis panelet ikke oplyser
   * nok til at regne det ud. Se `serverInfo.ts` for hvorfor `timezone`-strengen
   * ikke bruges.
   */
  async getPanelOffsetMinutes(): Promise<number | null> {
    return panelOffsetFromServerInfo(await this.request());
  }

  async getVodCategories(): Promise<Category[]> {
    return mapCategories(await this.requestList('get_vod_categories'));
  }

  async getVodStreams(): Promise<VodItem[]> {
    return mapVodItems(await this.requestList('get_vod_streams'), 'movie');
  }

  async getSeriesCategories(): Promise<Category[]> {
    return mapCategories(await this.requestList('get_series_categories'));
  }

  async getSeries(): Promise<VodItem[]> {
    return mapVodItems(await this.requestList('get_series'), 'series');
  }

  /**
   * Handling, rolleliste og trailer for én film.
   *
   * Et opslag per titel, ikke per liste: `get_vod_streams` giver tusindvis
   * af film paa ét kald, men kun navn og plakat. Resten koster et kald per
   * film, og det kald sker foerst naar man aabner den.
   */
  async getVodInfo(vodId: string): Promise<VodDetails> {
    return mapVodDetails(await this.request('get_vod_info', { vod_id: vodId }));
  }

  /** Det samme for en serie, plus dens afsnit. */
  async getSeriesInfo(seriesId: string): Promise<{ details: VodDetails; episodes: Episode[] }> {
    const body = await this.request('get_series_info', { series_id: seriesId });
    return { details: mapVodDetails(body), episodes: mapEpisodes(body, seriesId) };
  }

  /**
   * Som `request`, men kaster XtreamNetworkError hvis det afkodede svar ikke
   * er et array. Et panel i fejltilstand (fejlobjekt, captive portal,
   * vedligeholdelsesbesked) skal ikke fejlagtigt fortolkes som "ingen kanaler" —
   * det ville få appen til at overskrive en god cache med en tom liste.
   * `mapCategories`/`mapChannels` er fortsat tolerante over for ugyldige
   * *elementer* i et array; det er en bevidst forskel og skal ikke ændres.
   */
  private async requestList(action: string): Promise<unknown> {
    const body = await this.request(action);
    if (!Array.isArray(body)) {
      throw new XtreamNetworkError('Panelets svar var ikke en liste');
    }
    return body;
  }
}
