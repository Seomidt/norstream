import type { Category, Channel, XtreamCredentials } from '../models.js';
import { normaliseBaseUrl } from '../urls.js';
import { mapCategories, mapChannels } from './mapping.js';

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

  private endpoint(action?: string): string {
    const query = [
      `username=${encodeURIComponent(this.creds.username)}`,
      `password=${encodeURIComponent(this.creds.password)}`,
    ];
    if (action) query.push(`action=${encodeURIComponent(action)}`);
    return `${this.baseUrl}/player_api.php?${query.join('&')}`;
  }

  private async request(action?: string): Promise<unknown> {
    let response: FetchLikeResponse;
    try {
      response = await this.fetchImpl(this.endpoint(action));
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
    if (auth === undefined || Number(auth) !== 1) {
      throw new XtreamAuthError();
    }
  }

  async getLiveCategories(): Promise<Category[]> {
    return mapCategories(await this.request('get_live_categories'));
  }

  async getLiveStreams(): Promise<Channel[]> {
    return mapChannels(await this.request('get_live_streams'));
  }
}
