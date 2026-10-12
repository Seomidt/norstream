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
  /** Panelet oplyser intet arkiv paa denne kanal. Kan afproeves manuelt. */
  | 'no-archive'
  /** Timeshift-dialekten blev aldrig fundet. Kan probes igen. */
  | 'no-dialect'
  /** Vi ved ikke hvad der sendes lige nu, saa vi ved ikke hvad "forfra" er. */
  | 'no-epg';

/** Et manuelt forsoeg maa bruge en kendt arkivvej og en allerede sendt udsendelse. */
export function restartModeFor(hasArchive: boolean, hasDialect: boolean, hasProgramme: boolean): 'ready' | 'trial' | null {
  if (!hasDialect || !hasProgramme) return null;
  return hasArchive ? 'ready' : 'trial';
}

export function restartBlockFor(
  hasArchive: boolean,
  hasDialect: boolean,
  hasCurrentProgramme: boolean,
): RestartBlock | null {
  // Udbyderens arkivflag forklares foerst. Den separate restartModeFor
  // tillader et eksplicit forsoeg, naar vej og program er paa plads.
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
      return { text: 'Udbyderen oplyser ikke arkiv på kanalen. Det kan afprøves med Prøv start forfra, når programdata og arkivvejen er klar.', action: null };
    case 'no-dialect':
      return {
        text: 'Appen fandt ikke ud af hvordan panelet leverer arkiv.',
        action: 'Prøv igen',
      };
    case 'no-epg':
      return { text: 'Ingen programoversigt for kanalen endnu.', action: 'Hent program' };
  }
}
