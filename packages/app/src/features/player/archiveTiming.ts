/** Programoversigten og panelets arkiv kan have hver sin tidskorrektion. */
export interface ArchiveTiming {
  epgMinutes: number;
  archiveMinutes: number;
}

/** Vinduets laengde beregnes paa rigtig tid; kun forespoergslens start
 * oversaettes til panelets arkivkoordinat. */
export function archiveRequestTime(from: Date, timing: ArchiveTiming): Date {
  return new Date(from.getTime() + (timing.archiveMinutes - timing.epgMinutes) * 60_000);
}
