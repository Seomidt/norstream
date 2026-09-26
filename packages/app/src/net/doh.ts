import type { FetchLike, FetchLikeResponse } from '@norstream/core';

/**
 * DNS over HTTPS som noedudgang.
 *
 * Nogle netvaerk (routere, mobiludbydere) lyver om hvor panelet bor: navnet
 * slaas op til ingenting, mens adressen selv er aaben. Forbindelsestjekket
 * fandt det; her bruges det. Fejler et kald til panelet paa netvaerket,
 * slaas navnet op hos Google eller Cloudflare over HTTPS, og kaldet sendes
 * igen direkte til adressen med navnet som Host-hoved. Lykkes det, huskes
 * adressen en time, saa baade de naeste kald og streams gaar udenom.
 *
 * Kun http: over https ville adressen ikke passe til certifikatet. De
 * fleste paneler taler http paa port 8080, og dem daekker det.
 */
export interface DohResolver {
  via: string;
  url: (host: string) => string;
  headers?: Record<string, string>;
}

export const DOH_RESOLVERS: DohResolver[] = [
  { via: 'Google', url: (host) => `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A` },
  {
    via: 'Cloudflare',
    url: (host) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`,
    headers: { accept: 'application/dns-json' },
  },
];

/** Fetch der kan sende hoveder med; udvidelsen af core's FetchLike appen selv bygger. */
export type HeaderFetch = (url: string, headers?: Record<string, string>) => Promise<FetchLikeResponse>;

/** IPv4-adresserne i et DNS-JSON-svar (type 1 = A). */
export function parseDnsJson(text: string): string[] {
  try {
    const parsed = JSON.parse(text) as { Answer?: Array<{ type?: number; data?: string }> };
    return (parsed.Answer ?? [])
      .filter((answer) => answer.type === 1 && typeof answer.data === 'string')
      .map((answer) => answer.data as string)
      .filter((ip) => IPV4.test(ip));
  } catch {
    return [];
  }
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export interface UrlParts {
  scheme: string;
  host: string;
  /** Med kolon foran, eller tom. */
  port: string;
  /** Sti, forespoergsel og resten. */
  rest: string;
}

/** Delene af en adresse der kan gaa udenom navnet: http, med et navn og ikke en adresse. */
export function eligibleParts(url: string): UrlParts | null {
  const match = /^(http):\/\/([^/:?#]+)(:\d+)?([/?#].*)?$/i.exec(url);
  if (match === null) return null;
  const host = match[2] ?? '';
  if (IPV4.test(host) || host.includes(':')) return null;
  return { scheme: (match[1] ?? 'http').toLowerCase(), host, port: match[3] ?? '', rest: match[4] ?? '' };
}

/** Samme adresse, sendt til ip'en med navnet som Host-hoved. */
export function viaIp(parts: UrlParts, ip: string): { url: string; headers: Record<string, string> } {
  return { url: `${parts.scheme}://${ip}${parts.port}${parts.rest}`, headers: { Host: `${parts.host}${parts.port}` } };
}

const PIN_MS = 60 * 60_000;
const pins = new Map<string, { ip: string; until: number }>();

export function pinnedIp(host: string, now = Date.now()): string | null {
  const pin = pins.get(host.toLowerCase());
  if (pin === undefined) return null;
  if (pin.until <= now) {
    pins.delete(host.toLowerCase());
    return null;
  }
  return pin.ip;
}

export function pinHost(host: string, ip: string, now = Date.now()): void {
  pins.set(host.toLowerCase(), { ip, until: now + PIN_MS });
}

export function unpinHost(host: string): void {
  pins.delete(host.toLowerCase());
}

/** Til tests. */
export function clearPins(): void {
  pins.clear();
}

export type Resolver = (host: string) => Promise<string[]>;

/** Slaar navnet op hos Google, saa Cloudflare. Tom liste naar ingen af dem kunne. */
export function createResolver(fetchImpl: HeaderFetch): Resolver {
  return async (host) => {
    for (const resolver of DOH_RESOLVERS) {
      try {
        const response = await fetchImpl(resolver.url(host), resolver.headers);
        const ips = parseDnsJson(await response.text());
        if (ips.length > 0) return ips;
      } catch {
        // Naeste opslagstjeneste.
      }
    }
    return [];
  };
}

/**
 * Laegger sig om fetch: naar netvaerket ikke kan naa navnet, proeves adressen.
 *
 * Kun naar kaldet *kaster* (intet svar, ingen forbindelse, navnet kendes
 * ikke): et HTTP-svar, ogsaa 403, er panelet der svarer, og saa er DNS ikke
 * problemet. Er navnet allerede pinnet, gaar kaldet direkte til adressen;
 * svigter den, glemmes den og navnet proeves igen.
 */
export function withDnsFallback(fetchImpl: HeaderFetch, resolve: Resolver = createResolver(fetchImpl)): HeaderFetch {
  return async (url, headers) => {
    const parts = eligibleParts(url);
    if (parts === null) return fetchImpl(url, headers);

    const pinned = pinnedIp(parts.host);
    if (pinned !== null) {
      const direct = viaIp(parts, pinned);
      try {
        // Kalderens hoveder foerst, saa Host-hovedet fra viaIp altid vinder.
        return await fetchImpl(direct.url, { ...headers, ...direct.headers });
      } catch {
        unpinHost(parts.host);
      }
    }

    try {
      return await fetchImpl(url, headers);
    } catch (cause) {
      const ips = await resolve(parts.host);
      for (const ip of ips.slice(0, 2)) {
        const direct = viaIp(parts, ip);
        try {
          const response = await fetchImpl(direct.url, { ...headers, ...direct.headers });
          pinHost(parts.host, ip);
          return response;
        } catch {
          // Naeste adresse, eller den oprindelige fejl.
        }
      }
      throw cause;
    }
  };
}

/**
 * Streamens adresse til afspilleren: direkte til ip'en med Host-hoved naar
 * panelets navn er pinnet, ellers adressen som den er.
 */
export function streamSource(url: string): string | { uri: string; headers: Record<string, string> } {
  const parts = eligibleParts(url);
  if (parts === null) return url;
  const pinned = pinnedIp(parts.host);
  if (pinned === null) return url;
  const direct = viaIp(parts, pinned);
  return { uri: direct.url, headers: direct.headers };
}
