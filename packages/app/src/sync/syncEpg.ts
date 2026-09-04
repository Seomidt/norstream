import { buildXmltvUrl, createXmltvParser } from '@uhf-play/core';
import type { Programme, XtreamCredentials } from '@uhf-play/core';
import { deleteProgrammesBefore, upsertProgrammes } from '../storage/programmes.js';
import type { SqlDatabase } from '../storage/types.js';

/** Leverer XMLTV-dokumentet som tekstbidder, saa det aldrig ligger samlet i hukommelsen. */
export type TextChunkSource = (url: string) => Promise<AsyncIterable<string>>;

const BATCH_SIZE = 500;
const RETENTION_HOURS = 12;

/**
 * Henter og parser EPG streamet. Programmer skrives i partier frem for eet ad
 * gangen, saa en fuld XMLTV-fil ikke bliver til hundredtusindvis af enkelt-
 * skrivninger, og aldrig som eet samlet array, saa hukommelsen forbliver flad.
 *
 * Programmer der sluttede for mere end 12 timer siden ryddes: uden det vokser
 * databasen ubegraenset for hver fornyelse.
 */
export async function syncEpg(
  db: SqlDatabase,
  creds: XtreamCredentials,
  source: TextChunkSource,
  now: Date = new Date(),
): Promise<{ programmes: number }> {
  const url = buildXmltvUrl(creds);
  const chunks = await source(url);

  let batch: Programme[] = [];
  let total = 0;

  const parser = createXmltvParser((programme) => {
    batch.push(programme);
    total += 1;
  });

  async function flush(): Promise<void> {
    if (batch.length === 0) return;
    const pending = batch;
    batch = [];
    await upsertProgrammes(db, pending);
  }

  for await (const chunk of chunks) {
    parser.write(chunk);
    if (batch.length >= BATCH_SIZE) await flush();
  }
  parser.end();
  await flush();

  const cutoff = new Date(now.getTime() - RETENTION_HOURS * 60 * 60_000);
  await deleteProgrammesBefore(db, cutoff);

  return { programmes: total };
}

/**
 * Den rigtige kilde: streamer svaret i bidder frem for at samle det.
 * Bruges af appen; tests leverer deres egen kilde.
 */
export function createHttpChunkSource(timeoutMs = 60_000): TextChunkSource {
  return async (url: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch (cause) {
      clearTimeout(timer);
      throw cause;
    }

    if (!response.ok || !response.body) {
      clearTimeout(timer);
      throw new Error(`EPG-kilden svarede med HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    return {
      async *[Symbol.asyncIterator]() {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            yield decoder.decode(value, { stream: true });
          }
          yield decoder.decode();
        } finally {
          clearTimeout(timer);
          reader.releaseLock();
        }
      },
    };
  };
}
