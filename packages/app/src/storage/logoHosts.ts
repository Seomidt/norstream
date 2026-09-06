import { getSetting, setSetting } from './settings.js';
import type { SqlDatabase } from './types.js';

const KEY_PREFIX = 'logo_host:';
const KEY_CHECKED = 'logo_hosts_checked_ms';

/**
 * Hvad et opkald til en logo-vaert gav.
 *
 * `unreachable` er **kun** for de svar hvor der aldrig kom et svar: telefonen
 * kunne ikke naa vaerten. En HTTP-fejl — ogsaa 404 — betyder at vaerten lever
 * og bare ikke har netop den fil, og det er en forskel der afgoer om det giver
 * mening at proeve dens oevrige adresser.
 */
export type LogoHostState = 'ok' | 'unreachable';

export interface LogoHostRecord {
  origin: string;
  state: LogoHostState;
  /** Kort dansk linje der siger hvad der skete. Kun til visning. */
  detail: string;
}

export async function recordLogoHostState(
  db: SqlDatabase,
  record: LogoHostRecord,
): Promise<void> {
  await setSetting(db, `${KEY_PREFIX}${record.origin}`, `${record.state}|${record.detail}`);
}

export async function listLogoHosts(db: SqlDatabase): Promise<LogoHostRecord[]> {
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key LIKE ? ESCAPE '\\'",
    [`${KEY_PREFIX}%`],
  );
  return rows.map((row) => {
    const separator = row.value.indexOf('|');
    const state = separator < 0 ? row.value : row.value.slice(0, separator);
    return {
      origin: row.key.slice(KEY_PREFIX.length),
      state: state === 'unreachable' ? 'unreachable' : 'ok',
      detail: separator < 0 ? '' : row.value.slice(separator + 1),
    };
  });
}

/**
 * De vaerter der ikke kunne naas, som et opslag kanallisten kan filtrere med.
 *
 * Det her er hele pointen i at maale én gang. `Image` falder tilbage til den
 * naeste adresse naar en fejler — men en vaert uden rute svarer ikke med en
 * fejl, den svarer **ikke**, og forsoeget staar og venter til det bliver
 * afbrudt. Med 22.142 kanaler betyder det en tom firkant hver gang, ogsaa naar
 * der ligger et brugbart logo laengere nede i raekken. Ved at kende vaerten paa
 * forhaand springes den over med det samme, og det naeste forsoeg er det der
 * faktisk kan tegne noget.
 */
export async function deadLogoOrigins(db: SqlDatabase): Promise<Set<string>> {
  const hosts = await listLogoHosts(db);
  return new Set(hosts.filter((host) => host.state === 'unreachable').map((host) => host.origin));
}

export async function getLogoHostsCheckedMs(db: SqlDatabase): Promise<number | null> {
  const value = await getSetting(db, KEY_CHECKED);
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function setLogoHostsCheckedMs(db: SqlDatabase, ms: number): Promise<void> {
  await setSetting(db, KEY_CHECKED, String(Math.trunc(ms)));
}
