import type { Category, Channel, Programme, XtreamCredentials } from '../models.js';
import { normaliseBaseUrl } from '../urls.js';
import { truthyFlag } from './coerce.js';
import { mapCategories, mapChannels } from './mapping.js';
import { panelOffsetFromServerInfo } from './serverInfo.js';
import { mapEpgListings } from './epgListings.js';

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
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
