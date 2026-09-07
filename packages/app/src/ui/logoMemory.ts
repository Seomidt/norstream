import type { SqlDatabase } from '../storage/types.js';

/**
 * Hvilken af kanalens logo-adresser der tegnede sidst.
 *
 * Kanalen har flere adresser at proeve, og `Image` gaar videre naar en
 * fejler. Men den gaar videre **hver gang raekken kommer paa skaermen**: en
 * kanal hvis foerste adresse svarer 404, koster et forgaeves opkald og et
 * oejebliks tom firkant ved hver eneste rulning forbi. Med 22.142 kanaler er
 * det ikke en detalje.
 *
 * Her huskes den adresse der virkede, per kanal, saa naeste gang begynder
 * der. Det er hukommelse om **udfaldet**, ikke om billedet: selve billedet
 * ligger i systemets egen billedcache, som React Native bruger af sig selv.
 *
 * Synkron, fordi `ChannelLogo` tegner synkront og ikke kan vente paa en
 * database. Tabellen laeses ind én gang ved opstart og skrives igennem.
 */
const memory = new Map<string, string>();
let database: SqlDatabase | null = null;

export async function initLogoMemory(db: SqlDatabase): Promise<void> {
  database = db;
  memory.clear();
  const rows = await db.getAllAsync<{ channel_key: string; url: string }>(
    'SELECT channel_key, url FROM logo_resolved',
  );
  for (const row of rows) memory.set(row.channel_key, row.url);
}

export function recallLogo(key: string): string | null {
  return memory.get(key) ?? null;
}

export function rememberLogo(key: string, url: string): void {
  if (memory.get(key) === url) return;
  memory.set(key, url);
  void database
    ?.runAsync('INSERT OR REPLACE INTO logo_resolved (channel_key, url) VALUES (?, ?)', [key, url])
    .catch(() => undefined);
}

/** Naar den huskede adresse holder op med at virke. */
export function forgetLogo(key: string): void {
  if (!memory.has(key)) return;
  memory.delete(key);
  void database
    ?.runAsync('DELETE FROM logo_resolved WHERE channel_key = ?', [key])
    .catch(() => undefined);
}
