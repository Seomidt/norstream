/** Native afspilning kan stoppe uden slut/fejl-haendelse. Pause, buffering
 * og klargoering af en ny kilde maa ikke udloese genforbindelse. */
export function archiveStopped(input: { archive: boolean; wantsPlay: boolean; active: boolean; changing: boolean; playing: boolean; status: string }): boolean {
  return input.archive && input.wantsPlay && input.active && !input.changing && !input.playing && (input.status === 'readyToPlay' || input.status === 'idle');
}

/** Raa native fejl kan indeholde kodeord i URI; kun faste kategorier logges. */
export function playbackFailureKind(message: string | undefined): string {
  if (message === undefined) return 'ukendt';
  if (/decoder|codec|mediacodec/i.test(message)) return 'dekoder';
  if (/response code[ :=]+(?:401|403)|http (?:401|403)/i.test(message)) return 'adgang afvist';
  if (/response code[ :=]+404|http 404/i.test(message)) return 'arkiv/kilde mangler';
  if (/timeout|network|connection|socket|http|source error/i.test(message)) return 'netvaerk/kilde';
  return 'ukendt';
}
