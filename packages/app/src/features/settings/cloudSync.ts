/**
 * Sky-backup mod NorStreams egen lille sky-funktion (Supabase edge-funktion).
 *
 * Ingen login, ingen Google, ingen enhedskode. Brugeren vaelger ét KODEORD.
 * Funktionen i skyen krypterer kopien med en noegle udledt af kodeordet
 * (PBKDF2 + AES-GCM), saa panelets adresse aldrig ligger i klartekst, og
 * gemmer den under en hash af kodeordet. Samme kodeord paa en ny boks henter
 * den samme kopi ned igen. Kodeordet sendes kun for at laase op og gemmes
 * aldrig i skyen.
 *
 * Noeglen herunder er den *offentlige* publishable-noegle. Den maa gerne ligge
 * i appen — den kan ikke laese databasen (tabellen er laast bag funktionen).
 * Den eneste hemmelighed er brugerens kodeord.
 */
const SKY_URL = 'https://usewnyvdxxfgvwaefvmq.supabase.co/functions/v1/sky';
const SKY_KEY = 'sb_publishable_qiURGvAo_bilg3BGpl1-xw_Zs9Odd0k';

/** Mindste laengde paa kodeordet — funktionen afviser kortere. */
export const MIN_CODE_LENGTH = 4;

type Fetch = typeof fetch;

interface SkyResult {
  status: number;
  body: { ok?: boolean; data?: unknown; error?: unknown };
}

async function callSky(
  payload: { action: 'save' | 'load'; code: string; data?: string },
  fetchImpl: Fetch,
): Promise<SkyResult> {
  let response: Response;
  try {
    response = await fetchImpl(SKY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SKY_KEY,
        Authorization: `Bearer ${SKY_KEY}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('network');
  }
  const body = (await response.json().catch(() => ({}))) as SkyResult['body'];
  return { status: response.status, body };
}

/**
 * Lgger kopien op i skyen krypteret med kodeordet. Kaster 'network' naar der
 * ingen forbindelse er, og 'save' ved andre fejl.
 */
export async function saveToCloud(code: string, json: string, fetchImpl: Fetch = fetch): Promise<void> {
  const { status, body } = await callSky({ action: 'save', code: code.trim(), data: json }, fetchImpl);
  if (status !== 200 || body.ok !== true) throw new Error('save');
}

/**
 * Henter kopien ned igen med kodeordet. Kaster 'notfound' naar der ingen kopi
 * ligger under det kodeord (ogsaa ved forkert kodeord), 'network' uden
 * forbindelse, og 'load' ved andre fejl.
 */
export async function loadFromCloud(code: string, fetchImpl: Fetch = fetch): Promise<string> {
  const { status, body } = await callSky({ action: 'load', code: code.trim() }, fetchImpl);
  if (status === 404) throw new Error('notfound');
  if (status !== 200 || body.ok !== true || typeof body.data !== 'string') throw new Error('load');
  return body.data;
}
