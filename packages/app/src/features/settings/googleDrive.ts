import {
  createMultipartBody,
  MULTIPART_BOUNDARY,
  parseDeviceCode,
  parseFileId,
  parseRefreshedToken,
  parseTokenPoll,
} from './googleDriveParse.js';
import type { DeviceCode, TokenPoll } from './googleDriveParse.js';
import type { GoogleDriveConfig } from '../../storage/settings.js';

/**
 * Google Drev-sikkerhedskopi: login med enheds-flowet, og upload af filen.
 *
 * `drive.file` er den smalle rettighed: appen kan kun se og roere de filer
 * den selv laver. Den kan ikke laese resten af brugerens Drev. Det er nok
 * til at lgge kopien op og opdatere den igen.
 */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

/** Filens navn paa Drev. Den samme hver gang, saa den opdateres frem for at hobe sig op. */
export const DRIVE_BACKUP_NAME = 'norstream-sikkerhedskopi.json';

type Fetch = typeof fetch;

function form(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/** Beder Google om en kode brugeren kan godkende paa telefonen. */
export async function requestDeviceCode(clientId: string, fetchImpl: Fetch = fetch): Promise<DeviceCode> {
  let response: Response;
  try {
    response = await fetchImpl(DEVICE_CODE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: clientId, scope: DRIVE_SCOPE }),
    });
  } catch {
    throw new Error('Kunne ikke nå Google. Er der forbindelse?');
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (json as { error_description?: string }).error_description ?? `HTTP ${response.status}`;
    throw new Error(`Google afviste klient-id’et: ${message}`);
  }
  return parseDeviceCode(json);
}

/** Ét forsoeg paa at hente tokenet mens brugeren godkender. */
export async function pollToken(
  clientId: string,
  clientSecret: string,
  deviceCode: string,
  fetchImpl: Fetch = fetch,
): Promise<TokenPoll> {
  let response: Response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: clientId, client_secret: clientSecret, device_code: deviceCode, grant_type: DEVICE_GRANT }),
    });
  } catch {
    return { status: 'pending' };
  }
  return parseTokenPoll(await response.json().catch(() => ({})));
}

/** Nyt adgangstoken ud fra det gemte refresh-token. Kaster 'reauth' naar login skal fornyes. */
export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  fetchImpl: Fetch = fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    });
  } catch {
    throw new Error('Kunne ikke nå Google.');
  }
  if (!response.ok) throw new Error('reauth');
  return parseRefreshedToken(await response.json().catch(() => ({})));
}

/**
 * Lgger kopien op. Er der et fil-id fra sidst, opdateres den fil (media-PATCH);
 * ellers laves en ny (multipart). Returnerer fil-id’et, saa naeste gang
 * opdaterer den samme fil frem for at lave endnu en.
 */
export async function uploadBackup(
  accessToken: string,
  fileId: string | null,
  json: string,
  fetchImpl: Fetch = fetch,
): Promise<string> {
  if (fileId !== null) {
    const patch = await fetchImpl(`${UPLOAD_URL}/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: json,
    });
    if (patch.ok) return parseFileId(await patch.json().catch(() => ({ id: fileId })));
    // 404: filen er slettet paa Drev. Fald igennem og lav en ny.
    if (patch.status !== 404) throw new Error(`Drev svarede HTTP ${patch.status}.`);
  }
  const create = await fetchImpl(`${UPLOAD_URL}?uploadType=multipart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${MULTIPART_BOUNDARY}`,
    },
    body: createMultipartBody(DRIVE_BACKUP_NAME, json),
  });
  if (!create.ok) throw new Error(`Drev svarede HTTP ${create.status}.`);
  return parseFileId(await create.json().catch(() => ({})));
}

/**
 * Hele vejen: frisk adgangstoken ud fra det gemte login, og lg kopien op.
 * Kaster 'reauth' naar login skal fornyes. Bruges baade af "Gem nu" og af
 * den ugentlige kopi.
 */
export async function saveBackupToDrive(
  config: GoogleDriveConfig,
  json: string,
  fetchImpl: Fetch = fetch,
): Promise<{ fileId: string }> {
  if (config.refreshToken === null) throw new Error('reauth');
  const accessToken = await refreshAccessToken(config.clientId, config.clientSecret, config.refreshToken, fetchImpl);
  const fileId = await uploadBackup(accessToken, config.fileId, json, fetchImpl);
  return { fileId };
}
