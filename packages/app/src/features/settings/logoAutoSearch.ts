import type { FetchLike } from '@norstream/core';
import {
  clearLogoOverride,
  markLogoSearched,
  recentlySearchedLogos,
  setLogoOverride,
} from '../../storage/logoOverrides.js';
import type { ChannelWithoutLogo } from '../../storage/logoOverrides.js';
import type { SqlDatabase } from '../../storage/types.js';
import { findLogoCandidates } from '../../sync/logoSearch.js';
import type { GoogleSearchKeys, LogoCandidate } from '../../sync/logoSearch.js';

/**
 * Logoer til alle kanaler uden ét, paa én gang.
 *
 * Gaar listen igennem, spoerger nettet om hver kanal og gemmer det foerste
 * bud som brugerens eget valg — praecis som havde man valgt det selv i
 * vaelgeren, saa det kan fjernes samme sted. Et bud der ikke svarer med et
 * billede, fjernes igen, og naeste bud proeves.
 *
 * Kanaler der blev soegt for nylig uden held springes over, saa et nyt
 * tryk paa knappen ikke stiller de samme spoergsmaal igen; en uge senere
 * proeves de igen, for Wikidata vokser.
 */

export interface AutoSearchProgress {
  done: number;
  total: number;
  found: number;
  /** Kanalen der spoerges om lige nu. */
  current: string;
}

export interface AutoSearchResult {
  found: number;
  tried: number;
  /** Sprunget over fordi de blev soegt for nylig. */
  skipped: number;
}

export interface AutoSearchDeps {
  db: SqlDatabase;
  fetchImpl: FetchLike;
  google: GoogleSearchKeys | null;
  /** Henter logoet ned med det samme. Falsk naar adressen ikke gav et billede. */
  replaceLogo: (channelKey: string, url: string) => Promise<boolean>;
  resetLogo: (channelKey: string) => Promise<void>;
  now?: () => number;
}

export interface AutoSearchHandle {
  result: Promise<AutoSearchResult>;
  cancel: () => void;
}

/** Hvor mange kanaler der spoerges om ad gangen. Wikidata er faelles; vi tager ikke mere end to. */
const PARALLEL = 2;
/** Hvor mange bud der proeves per kanal foer den opgives. */
const MAX_TRIES = 2;

export function autoSearchLogos(
  deps: AutoSearchDeps,
  channels: readonly ChannelWithoutLogo[],
  onProgress: (progress: AutoSearchProgress) => void,
): AutoSearchHandle {
  let cancelled = false;
  const now = deps.now ?? Date.now;

  const result = (async (): Promise<AutoSearchResult> => {
    const candidates = channels.filter((channel) => !channel.hasOverride);
    const recent = await recentlySearchedLogos(
      deps.db,
      candidates.map((channel) => channel.id),
      now(),
    );
    const queue = candidates.filter((channel) => !recent.has(channel.id));
    const total = queue.length;
    let done = 0;
    let found = 0;
    let next = 0;

    async function one(channel: ChannelWithoutLogo): Promise<void> {
      onProgress({ done, total, found, current: channel.name });
      const bids = await findLogoCandidates(deps.fetchImpl, {
        name: channel.name,
        country: channel.country,
        google: deps.google,
      });
      const got = await tryCandidates(deps, channel.id, bids.slice(0, MAX_TRIES));
      if (got) found += 1;
      else await markLogoSearched(deps.db, channel.id, now());
      done += 1;
      onProgress({ done, total, found, current: channel.name });
    }

    async function worker(): Promise<void> {
      while (!cancelled && next < queue.length) {
        const channel = queue[next];
        next += 1;
        if (channel === undefined) break;
        await one(channel);
      }
    }

    await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, () => worker()));
    return { found, tried: done, skipped: recent.size };
  })();

  return {
    result,
    cancel: () => {
      cancelled = true;
    },
  };
}

async function tryCandidates(deps: AutoSearchDeps, channelKey: string, bids: LogoCandidate[]): Promise<boolean> {
  for (const bid of bids) {
    await setLogoOverride(deps.db, channelKey, bid.url);
    if (await deps.replaceLogo(channelKey, bid.url)) return true;
    await clearLogoOverride(deps.db, channelKey);
    await deps.resetLogo(channelKey);
  }
  return false;
}
