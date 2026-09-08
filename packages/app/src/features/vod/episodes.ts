/**
 * Regler for afsnit: hvilket der er det naeste, og hvor "Fortsaet" skal pege.
 * Rene funktioner, saa de kan testes uden database og afspiller.
 */
export interface EpisodeLike {
  key: string;
  season: number;
  episode: number;
  positionSeconds: number | null;
  watched: boolean;
}

function byOrder<T extends EpisodeLike>(episodes: readonly T[]): T[] {
  return [...episodes].sort((a, b) => a.season - b.season || a.episode - b.episode);
}

/** Afsnittet efter det givne, i saeson- og afsnitsorden. Null naar det var det sidste. */
export function nextEpisode<T extends EpisodeLike>(episodes: readonly T[], currentKey: string): T | null {
  const ordered = byOrder(episodes);
  const index = ordered.findIndex((episode) => episode.key === currentKey);
  if (index === -1) return null;
  return ordered[index + 1] ?? null;
}

/**
 * Hvor "Fortsaet" skal pege.
 *
 * Foerst det afsnit man var i gang med og ikke har set faerdig (det seneste,
 * hvis flere). Ellers det naeste usete efter det sidste sete — saa en serie
 * man har set fem afsnit af paa en anden tjeneste, og markeret som set,
 * fortsaetter med det sjette. Intet, naar man ikke er begyndt.
 */
export function continueEpisodeFor<T extends EpisodeLike>(episodes: readonly T[]): T | null {
  const ordered = byOrder(episodes);
  const inProgress = [...ordered].reverse().find((episode) => episode.positionSeconds !== null && !episode.watched);
  if (inProgress !== undefined) return inProgress;
  let lastWatched = -1;
  ordered.forEach((episode, index) => {
    if (episode.watched) lastWatched = index;
  });
  if (lastWatched === -1) return null;
  return ordered.slice(lastWatched + 1).find((episode) => !episode.watched) ?? null;
}
