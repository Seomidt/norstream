import { parseM3u } from '@norstream/core';
import type { Category, Channel, FetchLike, Source } from '@norstream/core';
import { replaceCategories, replaceChannels } from '../storage/channels.js';
import type { SqlDatabase } from '../storage/types.js';

/**
 * Henter en M3U-liste og skriver den ind som kanaler og kategorier.
 *
 * En M3U-liste er ikke et API. Der er ingen kategori-liste at hente — grupperne
 * staar som `group-title` paa hver enkelt linje — og der er ingen EPG. Begge
 * dele udledes her: kategorierne af grupperne, og programdata hentes bagefter
 * fra kildens XMLTV-adresse, hvis den har en.
 *
 * Kanalens id er dens `tvg-id` naar den har et, ellers dens adresse. Adressen
 * er ikke koen, men den er stabil, og den er det eneste der med sikkerhed
 * skelner to linjer fra hinanden i en liste hvor navne gaar igen.
 */
export async function syncM3u(
  db: SqlDatabase,
  source: Source,
  fetchImpl: FetchLike,
  now: Date = new Date(),
): Promise<{ categories: number; channels: number }> {
  void now;
  const response = await fetchImpl(source.url);
  if (!response.ok) {
    throw new Error(`Listen svarede HTTP ${response.status}`);
  }
  const text = await readText(response);
  const entries = parseM3u(text);

  const categories = new Map<string, Category>();
  const channels: Channel[] = [];
  const urls = new Map<string, string>();

  for (const entry of entries) {
    const channel = entry.channel;
    channels.push(channel);
    urls.set(channel.id, entry.url);
    if (channel.categoryId !== null && !categories.has(channel.categoryId)) {
      categories.set(channel.categoryId, { id: channel.categoryId, name: channel.categoryId });
    }
  }

  await replaceCategories(db, source.id, [...categories.values()]);
  await replaceChannels(db, source.id, channels, urls);

  return { categories: categories.size, channels: channels.length };
}

/**
 * Læser svaret som tekst uden at antage at `FetchLike` lover en `text()`.
 * Graensefladen findes for at kunne stubbes i tests, og en kilde der kaster
 * her ville se ud som en tom liste.
 */
async function readText(response: unknown): Promise<string> {
  if (typeof response === 'object' && response !== null) {
    const text = (response as { text?: unknown }).text;
    if (typeof text === 'function') {
      const value: unknown = await (text as () => unknown).call(response);
      if (typeof value === 'string') return value;
    }
  }
  throw new Error('Listen kunne ikke laeses som tekst');
}
