/** Raa native fejl kan indeholde kodeord i URI; kun faste kategorier logges. */
export function playbackFailureKind(message: string | undefined): string {
  if (message === undefined) return 'ukendt';
  if (/discontinuity|timestamp/i.test(message)) return 'tidsstempel';
  if (/decoder|codec|mediacodec/i.test(message)) return 'dekoder';
  if (/response code[ :=]+(?:401|403)|http (?:401|403)/i.test(message)) return 'adgang afvist';
  if (/response code[ :=]+404|http 404/i.test(message)) return 'arkiv/kilde mangler';
  if (/timeout|network|connection|socket|http|source error/i.test(message)) return 'netvaerk/kilde';
  return 'ukendt';
}

/** Ekstra native felter findes paa Android fra v380. Aldrig raa tekst/URI. */
export function nativeFailureDetails(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'kode ?, type ?';
  const data = error as { errorCode?: unknown; errorType?: unknown };
  const code = typeof data.errorCode === 'number' && Number.isInteger(data.errorCode) && data.errorCode >= 0 && data.errorCode <= 10_000 ? data.errorCode : '?';
  const type = typeof data.errorType === 'number' && Number.isInteger(data.errorType) && data.errorType >= 0 && data.errorType <= 3 ? data.errorType : '?';
  return `kode ${code}, type ${type}`;
}

/** Native uret afgoer om en stream staar stille, ikke koesatte JS-haendelser. */
export function playbackClock(eventPosition: number, nativePosition: number, active: boolean): number {
  return active && Number.isFinite(nativePosition) && nativePosition >= 0 ? nativePosition : eventPosition;
}
