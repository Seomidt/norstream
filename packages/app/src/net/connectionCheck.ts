/**
 * Maaler vejen fra telefonen til panelet, trin for trin.
 *
 * "Virker paa mobil, ikke paa Wi-Fi, virker med VPN" kan vaere fire ting,
 * og de ser ens ud paa skaermen: udbyderen lyver om navnet (DNS-blokering),
 * udbyderen spaerrer adressen, panelet afviser netvaerket (et forbud paa
 * hjemmeadressen), eller Wi-Fi'et har slet ikke internet. Hvert trin her
 * skiller ét af dem fra, og dommen til sidst siger hvad der kan goeres.
 *
 * Ingen adgangsoplysninger: panelet kaldes med brugernavn og kodeord
 * "test", for det er svaret paa *om* panelet svarer der taeller, ikke hvad
 * det svarer. Saa kan rapporten vises og sendes videre uden at skjule noget.
 */
export interface ProbeResponse {
  status: number;
  text: string;
}

/** Ét HTTP-kald. Kaster naar der slet ikke kommer svar (navn, rute, timeout). */
export type Probe = (url: string, headers?: Record<string, string>) => Promise<ProbeResponse>;

export interface CheckStep {
  title: string;
  ok: boolean;
  detail: string;
}

export type Verdict = 'ok' | 'dns-block' | 'ip-block' | 'no-internet' | 'unknown';

export interface CheckReport {
  steps: CheckStep[];
  verdict: Verdict;
  advice: string;
}

/** Adressen skilt ad, saa den kan sammensaettes med en IP i stedet for navnet. */
export function splitPanelUrl(
  panelUrl: string,
): { scheme: string; host: string; port: string; hostHeader: string } | null {
  const match = /^(https?):\/\/([^/:?#]+)(?::(\d+))?/i.exec(panelUrl.trim());
  if (match === null) return null;
  const scheme = match[1]!.toLowerCase();
  const host = match[2]!;
  const port = match[3] ?? '';
  return { scheme, host, port, hostHeader: port === '' ? host : `${host}:${port}` };
}

const PROBE_PATH = '/player_api.php?username=test&password=test';

function describeError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.length > 120 ? `${message.slice(0, 117)}…` : message;
}

async function resolveOverHttps(probe: Probe, host: string): Promise<{ ips: string[]; via: string }> {
  const attempts: Array<{ via: string; url: string; headers?: Record<string, string> }> = [
    { via: 'Google', url: `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A` },
    {
      via: 'Cloudflare',
      url: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`,
      headers: { accept: 'application/dns-json' },
    },
  ];
  let lastError = '';
  for (const attempt of attempts) {
    try {
      const response = await probe(attempt.url, attempt.headers);
      const parsed = JSON.parse(response.text) as { Answer?: Array<{ type?: number; data?: string }> };
      const ips = (parsed.Answer ?? [])
        .filter((answer) => answer.type === 1 && typeof answer.data === 'string')
        .map((answer) => answer.data as string);
      if (ips.length > 0) return { ips, via: attempt.via };
      lastError = `${attempt.via} kender ikke navnet`;
    } catch (cause) {
      lastError = `${attempt.via}: ${describeError(cause)}`;
    }
  }
  throw new Error(lastError);
}

export async function runConnectionCheck(probe: Probe, panelUrl: string): Promise<CheckReport> {
  const steps: CheckStep[] = [];
  const parts = splitPanelUrl(panelUrl);
  if (parts === null) {
    return {
      steps: [{ title: 'Panelets adresse', ok: false, detail: `Kan ikke laese adressen: ${panelUrl}` }],
      verdict: 'unknown',
      advice: 'Panelets adresse ser forkert ud. Tjek den under Kilder.',
    };
  }

  // 1. Er der internet overhovedet?
  let internet = false;
  try {
    const response = await probe('https://www.google.com/generate_204');
    internet = response.status === 204 || response.status === 200;
    steps.push({
      title: 'Internet',
      ok: internet,
      detail: internet ? 'Google svarer.' : `Google svarer ${response.status}; netvaerket er maaske bag en login-side.`,
    });
  } catch (cause) {
    steps.push({ title: 'Internet', ok: false, detail: `Intet svar fra Google: ${describeError(cause)}` });
  }
  if (!internet) {
    return {
      steps,
      verdict: 'no-internet',
      advice: 'Telefonen har ikke internet paa dette netvaerk. Det er ikke panelet og ikke appen.',
    };
  }

  // 2. Panelet paa sit navn, som appen goer det.
  let byName = false;
  try {
    const response = await probe(`${parts.scheme}://${parts.hostHeader}${PROBE_PATH}`);
    byName = true;
    steps.push({
      title: `Panelet paa navnet ${parts.host}`,
      ok: true,
      detail: `Svarer HTTP ${response.status}. Vejen er aaben.`,
    });
  } catch (cause) {
    steps.push({
      title: `Panelet paa navnet ${parts.host}`,
      ok: false,
      detail: `Intet svar: ${describeError(cause)}`,
    });
  }

  // 3. Navnet slaaet op uden om udbyderens DNS.
  let ips: string[] = [];
  try {
    const resolved = await resolveOverHttps(probe, parts.host);
    ips = resolved.ips;
    steps.push({
      title: 'Navnet slaaet op over krypteret DNS',
      ok: true,
      detail: `${resolved.via} siger ${ips.join(', ')}.`,
    });
  } catch (cause) {
    steps.push({
      title: 'Navnet slaaet op over krypteret DNS',
      ok: false,
      detail: describeError(cause),
    });
  }

  // 4. Panelet direkte paa adressen, med navnet som Host-hoved.
  let byIp = false;
  const ip = ips[0];
  if (ip !== undefined) {
    const port = parts.port === '' ? '' : `:${parts.port}`;
    try {
      const response = await probe(`${parts.scheme}://${ip}${port}${PROBE_PATH}`, { Host: parts.hostHeader });
      byIp = true;
      steps.push({
        title: `Panelet direkte paa ${ip}`,
        ok: true,
        detail: `Svarer HTTP ${response.status}.`,
      });
    } catch (cause) {
      steps.push({
        title: `Panelet direkte paa ${ip}`,
        ok: false,
        detail: `Intet svar: ${describeError(cause)}`,
      });
    }
  }

  if (byName) {
    return {
      steps,
      verdict: 'ok',
      advice:
        'Panelet kan naas fra dette netvaerk. Fejler kanalerne alligevel, ligger det i selve videostroemmen, som tit kommer fra en anden server end panelet. Koer maalingen igen mens en kanal fejler, og send begge billeder.',
    };
  }
  if (byIp) {
    return {
      steps,
      verdict: 'dns-block',
      advice:
        'Navnet blokeres paa dette netvaerk, men adressen er aaben: udbyderen lyver om hvor panelet bor. Privat DNS paa telefonen (Indstillinger → Netvaerk → Privat DNS → dns.google) loeser det for hele telefonen. Virker det ikke, er det routeren der overtager DNS; saet den til 8.8.8.8 eller 1.1.1.1.',
    };
  }
  if (ip !== undefined) {
    return {
      steps,
      verdict: 'ip-block',
      advice:
        'Hverken navnet eller adressen svarer, mens resten af internettet goer. Enten spaerrer udbyderen adressen, eller panelet afviser dette netvaerks IP. Koer maalingen paa mobildata: svarer panelet der, er det denne forbindelse der er spaerret, og saa hjaelper kun VPN eller en anden adresse fra udbyderen af panelet.',
    };
  }
  return {
    steps,
    verdict: 'unknown',
    advice:
      'Panelet svarer ikke, og navnet kunne ikke slaas op over krypteret DNS. Netvaerket blokerer mere end panelet. Proev paa mobildata og sammenlign.',
  };
}
