import { logEvent } from './log.js';

export interface ProcessExit {
  timestamp: number;
  reason: number;
  status: number;
  pssKiB: number;
  rssKiB: number;
  lowMemoryReportSupported: boolean;
}

export interface ProcessDiagnosticsNative {
  recentExits(): Promise<ProcessExit[]>;
}

const REASONS: Record<number, string> = {
  0: 'ukendt årsag',
  1: 'processen afsluttede selv',
  2: 'afsluttet af signal',
  3: 'Android afsluttede processen på grund af hukommelsesmangel',
  4: 'nedbrud i appens JVM',
  5: 'native nedbrud',
  6: 'appen svarede ikke (ANR)',
  7: 'opstarten fejlede',
  8: 'tilladelser ændret',
  9: 'for stort ressourceforbrug',
  10: 'afsluttet på brugerens anmodning eller ved opdatering',
  11: 'brugerprofil stoppet',
  12: 'afhængig proces afsluttet',
  13: 'anden systemårsag',
  14: 'Androids app-frysning',
  15: 'appens tilstand ændret',
  16: 'appen blev opdateret',
};

/** Historik fra Android, ikke en slutning ud fra afspillerens bufferstatus.
 * Hukommelsestal er sidste systemmaaling, ikke praecist forbruget ved exit. */
export async function logPreviousExits(
  native: ProcessDiagnosticsNative | null,
  write: (tag: string, text: string) => void = logEvent,
  now = Date.now(),
): Promise<void> {
  if (native === null) return;
  try {
    const exits = await native.recentExits();
    for (const exit of exits.slice(0, 8)) {
      const numbers = [exit.timestamp, exit.reason, exit.status, exit.pssKiB, exit.rssKiB];
      if (!numbers.every((n) => Number.isFinite(n) && n >= 0)) continue;
      if (exit.timestamp > now || now - exit.timestamp > 7 * 24 * 60 * 60_000) continue;
      const time = new Date(exit.timestamp).toLocaleString('da-DK');
      const reason = REASONS[exit.reason] ?? 'ukendt årsag';
      const possibleMemory = exit.reason === 2 && exit.status === 9 && !exit.lowMemoryReportSupported
        ? '; hukommelsesmangel er mulig, ikke bekræftet'
        : '';
      const memory = exit.pssKiB > 0 || exit.rssKiB > 0
        ? `; sidste måling PSS/RSS ${Math.round(exit.pssKiB / 1024)}/${Math.round(exit.rssKiB / 1024)} MiB`
        : '; ingen hukommelsesmåling';
      write('proces', `${time}: ${reason} (kode ${exit.reason}, status ${exit.status})${possibleMemory}${memory}`);
    }
  } catch {
    // Ingen fejltekst fra native eller opstartsafhaengighed.
  }
}
