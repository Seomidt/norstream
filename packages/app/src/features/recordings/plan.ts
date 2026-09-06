/**
 * Hvad der skal ske med en optagelse lige nu, som ren beregning.
 *
 * En "optagelse" i denne app er ikke en optagelse. Panelet har ingen
 * optagefunktion — det Norlys kalder optagelse, ligger paa Norlys' egne
 * servere. Det appen kan, er at hente udsendelsen ned fra panelets **arkiv**
 * naar den er sendt. Derfor har en optagelse en ventetid foer den kan hentes,
 * og en frist hvorefter den aldrig kan hentes mere.
 *
 * Reglerne staar her, adskilt fra baade database og filsystem, fordi den
 * dyreste fejl i det her lag er stille: en optagelse der aldrig bliver hentet,
 * eller en der forsoeges hentet i en uendelighed fordi arkivet for laengst har
 * smidt den ud.
 */

export type RecordingState =
  /** Bestilt. Enten er udsendelsen ikke sendt endnu, eller den er ikke hentet. */
  | 'planned'
  /** Hentningen er i gang. */
  | 'downloading'
  /** Filen ligger paa enheden. */
  | 'done'
  /** Hentningen mislykkedes. Kan proeves igen saa laenge arkivet raekker. */
  | 'failed'
  /** Arkivet naaede at smide udsendelsen ud foer vi fik den. */
  | 'expired';

export type RecordingAction =
  /** Udsendelsen er ikke faerdig endnu. */
  | 'wait'
  /** Hent den nu. */
  | 'fetch'
  /** For sent — arkivet har den ikke mere. */
  | 'expire'
  /** Der er ikke noget at goere. */
  | 'none';

/**
 * Hvor laenge vi venter efter en udsendelse er slut, foer vi henter den.
 *
 * Panelets arkiv skrives mens der sendes, og den sidste bid er ikke
 * noedvendigvis paa plads i samme sekund udsendelsen slutter. To minutter
 * koster ingenting og sparer en halv hentning der skulle laves om.
 */
export const SETTLE_MS = 2 * 60_000;

export interface RecordingPlanInput {
  state: RecordingState;
  /** Hvornaar udsendelsen slutter. */
  stopMs: number;
  /** Kanalens arkivlaengde i dage, som den var da optagelsen blev bestilt. */
  archiveDays: number;
}

export function recordingAction(input: RecordingPlanInput, now: Date): RecordingAction {
  if (input.state === 'done' || input.state === 'expired') return 'none';
  // En hentning der allerede koerer skal ikke startes igen. Gjorde vi det,
  // ville to hentninger skrive i den samme fil.
  if (input.state === 'downloading') return 'none';

  const ms = now.getTime();
  if (input.stopMs + SETTLE_MS > ms) return 'wait';

  // Arkivet maales fra nu og bagud. Er udsendelsen faldet ud af vinduet,
  // findes den ikke laengere, og et forsoeg mere er spildt.
  if (input.archiveDays > 0 && input.stopMs < ms - input.archiveDays * 24 * 60 * 60_000) {
    return 'expire';
  }

  return 'fetch';
}

/**
 * Kan der overhovedet bestilles en optagelse af det her?
 *
 * Uden arkiv findes der ingen vej til udsendelsen bagefter, og en knap der
 * lover noget den ikke kan holde er vaerre end ingen knap.
 */
export function canRecord(channel: { hasArchive: boolean; archiveDays: number }): boolean {
  return channel.hasArchive && channel.archiveDays > 0;
}

/**
 * Hvornaar optagelsen tidligst kan hentes. Bruges til at sige "klar ca. 21:32"
 * frem for at lade brugeren gaette paa hvornaar der sker noget.
 */
export function readyAt(stopMs: number): Date {
  return new Date(stopMs + SETTLE_MS);
}

/** Naar arkivet smider udsendelsen ud, eller null naar kanalen ingen frist har. */
export function expiresAt(stopMs: number, archiveDays: number): Date | null {
  if (archiveDays <= 0) return null;
  return new Date(stopMs + archiveDays * 24 * 60 * 60_000);
}

/** Bytes som noget et menneske kan laese. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const gb = bytes / 1_000_000_000;
  if (gb >= 1) return `${gb.toFixed(1).replace('.', ',')} GB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

function clock(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function day(date: Date, now: Date): string {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 24 * 60 * 60_000;
  const diff = Math.floor(
    (new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - startOfToday) /
      dayMs,
  );
  if (diff === 0) return 'i dag';
  if (diff === -1) return 'i går';
  if (diff === 1) return 'i morgen';
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.`;
}

/**
 * Én linje der siger hvor optagelsen staar.
 *
 * Samlet ét sted og uden komponenter omkring sig, fordi det er den tekst der
 * afgoer om brugeren tror appen har glemt hans optagelse. "Bestilt" uden mere
 * er ikke godt nok naar udsendelsen foerst sendes i morgen aften.
 */
export function describeRecording(
  recording: {
    state: RecordingState;
    start: Date;
    stop: Date;
    archiveDays: number;
    bytes: number;
    error: string | null;
  },
  now: Date,
): string {
  switch (recording.state) {
    case 'done':
      return `På enheden · ${formatBytes(recording.bytes)}`;
    case 'downloading':
      return 'Henter fra arkivet …';
    case 'expired':
      return recording.error ?? 'Kunne ikke hentes i tide.';
    case 'failed':
      return recording.error ?? 'Hentningen mislykkedes.';
    case 'planned': {
      const action = recordingAction(
        { state: 'planned', stopMs: recording.stop.getTime(), archiveDays: recording.archiveDays },
        now,
      );
      if (action === 'wait') {
        const ready = readyAt(recording.stop.getTime());
        return `Hentes ${day(ready, now)} efter kl. ${clock(ready)}`;
      }
      return 'Klar til at blive hentet';
    }
  }
}
