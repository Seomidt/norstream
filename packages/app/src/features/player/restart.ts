/**
 * Hvorfor start-forfra ikke kan bruges, som ren beregning.
 *
 * Ligger uden for skaermen af to grunde. Den ene er at det kan testes. Den
 * anden er vigtigere: reglen var foer et enkelt `&&` inde i en render, og
 * konsekvensen af at én af de tre betingelser var falsk var at knappen
 * **forsvandt**. Brugeren saa en app uden start-forfra og havde ingen maade at
 * finde ud af hvad der manglede. Naar aarsagen er en vaerdi, kan skaermen sige
 * den hoejt — og tilbyde det der skal til.
 */
export type RestartBlock =
  /** Panelet har intet arkiv paa denne kanal. Der er intet at hente. */
  | 'no-archive'
  /** Timeshift-dialekten blev aldrig fundet. Kan probes igen. */
  | 'no-dialect'
  /** Vi ved ikke hvad der sendes lige nu, saa vi ved ikke hvad "forfra" er. */
  | 'no-epg';

export function restartBlockFor(
  hasArchive: boolean,
  hasDialect: boolean,
  hasCurrentProgramme: boolean,
): RestartBlock | null {
  // Raekkefoelgen er ikke tilfaeldig: uden arkiv hjaelper hverken dialekt
  // eller programdata, saa det er den besked der skal staa.
  if (!hasArchive) return 'no-archive';
  if (!hasDialect) return 'no-dialect';
  if (!hasCurrentProgramme) return 'no-epg';
  return null;
}

export interface RestartHint {
  /** Hvad brugeren faar at vide. */
  text: string;
  /** Knappen der kan raade bod paa det, eller null naar der ikke er nogen. */
  action: string | null;
}

export function restartHint(block: RestartBlock): RestartHint {
  switch (block) {
    case 'no-archive':
      return { text: 'Kanalen har intet arkiv hos udbyderen.', action: null };
    case 'no-dialect':
      return {
        text: 'Appen fandt ikke ud af hvordan panelet leverer arkiv.',
        action: 'Prøv igen',
      };
    case 'no-epg':
      return { text: 'Ingen programoversigt for kanalen endnu.', action: 'Hent program' };
  }
}
