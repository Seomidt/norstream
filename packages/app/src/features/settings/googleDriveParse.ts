/**
 * Ren logik til Google Drev-sikkerhedskopi, uden native-moduler, saa den kan
 * testes. Selve netvaerkskaldene ligger i googleDrive.ts.
 *
 * Login foregaar med "enheds-flowet" (OAuth 2.0 Device Authorization Grant):
 * tv'et beder om en kode, viser den, og brugeren godkender paa telefonen.
 * Det er den maade tv-apps logger paa, fordi der ingen browser er paa tv'et.
 */

/** Svaret paa anmodningen om en enhedskode. */
export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  /** Sekunder mellem hvert forsoeg paa at hente tokenet. */
  intervalSeconds: number;
  /** Sekunder til koden udloeber. */
  expiresInSeconds: number;
}

/** Tolker enhedskode-svaret; kaster hvis noget mangler. */
export function parseDeviceCode(json: unknown): DeviceCode {
  const o = json as Record<string, unknown>;
  const deviceCode = typeof o.device_code === 'string' ? o.device_code : '';
  const userCode = typeof o.user_code === 'string' ? o.user_code : '';
  // Google har kaldt feltet baade verification_url og verification_uri.
  const verificationUrl =
    typeof o.verification_url === 'string'
      ? o.verification_url
      : typeof o.verification_uri === 'string'
        ? o.verification_uri
        : 'https://www.google.com/device';
  if (deviceCode.length === 0 || userCode.length === 0) {
    throw new Error('Google svarede ikke med en kode. Tjek at klient-id’et er rigtigt.');
  }
  return {
    deviceCode,
    userCode,
    verificationUrl,
    intervalSeconds: typeof o.interval === 'number' && o.interval > 0 ? o.interval : 5,
    expiresInSeconds: typeof o.expires_in === 'number' && o.expires_in > 0 ? o.expires_in : 1800,
  };
}

/** Udfaldet af et forsoeg paa at hente tokenet mens brugeren godkender. */
export type TokenPoll =
  | { status: 'ok'; accessToken: string; refreshToken: string | null; expiresInSeconds: number }
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'denied'; message: string }
  | { status: 'expired' };

/** Tolker et token-svar under login-ventningen. */
export function parseTokenPoll(json: unknown): TokenPoll {
  const o = json as Record<string, unknown>;
  const accessToken = typeof o.access_token === 'string' ? o.access_token : '';
  if (accessToken.length > 0) {
    return {
      status: 'ok',
      accessToken,
      refreshToken: typeof o.refresh_token === 'string' ? o.refresh_token : null,
      expiresInSeconds: typeof o.expires_in === 'number' ? o.expires_in : 3600,
    };
  }
  const error = typeof o.error === 'string' ? o.error : '';
  if (error === 'authorization_pending') return { status: 'pending' };
  if (error === 'slow_down') return { status: 'slow_down' };
  if (error === 'expired_token') return { status: 'expired' };
  // access_denied, eller noget uventet.
  return { status: 'denied', message: error.length > 0 ? error : 'Login blev afvist.' };
}

/** Adgangstokenet ud af et opfrisknings-svar; kaster naar login skal fornyes. */
export function parseRefreshedToken(json: unknown): string {
  const o = json as Record<string, unknown>;
  const accessToken = typeof o.access_token === 'string' ? o.access_token : '';
  if (accessToken.length === 0) {
    throw new Error('reauth');
  }
  return accessToken;
}

/** Fil-id’et ud af et upload-svar; kaster hvis det mangler. */
export function parseFileId(json: unknown): string {
  const o = json as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id : '';
  if (id.length === 0) throw new Error('Google svarede ikke med et fil-id.');
  return id;
}

/** Grænsen mellem delene i en multipart-krop. Fast; maa ikke findes i indholdet. */
export const MULTIPART_BOUNDARY = 'norstream-grms-boundary';

/**
 * Kroppen der laver en ny fil paa Drev: metadata (navnet) og selve indholdet
 * i én multipart/related-krop. Til opdatering bruges kun media-vejen (ren
 * PATCH), saa denne bruges kun foerste gang.
 */
export function createMultipartBody(name: string, content: string): string {
  const metadata = JSON.stringify({ name, mimeType: 'application/json' });
  return [
    `--${MULTIPART_BOUNDARY}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${MULTIPART_BOUNDARY}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    content,
    `--${MULTIPART_BOUNDARY}--`,
    '',
  ].join('\r\n');
}
