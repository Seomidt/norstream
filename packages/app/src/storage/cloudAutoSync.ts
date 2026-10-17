import { backupHasUserData, createBackup, parseBackup, restoreBackup, serialiseBackup } from './backup.js';
import type { Backup, CredentialLoader, RestoreResult } from './backup.js';
import { getSkyConfig, getSkySync, getSkySyncState, setSkyLastMs, setSkySyncState } from './settings.js';
import type { SqlDatabase } from './types.js';

/**
 * Loebende synkronisering mellem enheder gennem skyen (v340).
 *
 * Samme sky og samme kodeord som den ugentlige kopi, men i stedet for en
 * kopi om ugen: hver gang noget er aendret paa denne boks (favoritter,
 * grupper, "se videre", fremdrift i film, indstillinger), laegges kopien op,
 * og hver gang appen starter eller kommer frem, hentes den nyeste ned. Saa
 * er en ny favorit paa det ene tv paa det andet naeste gang det taendes, og
 * en film begyndt paa telefonen kan fortsaettes paa tv'et.
 *
 * Reglerne, uden netvaerk (skyen er to funktioner udefra, saa det kan testes):
 *
 * - **Foerste gang** paa en boks: ligger der en *synkroniseret* kopi i
 *   skyen (lagt op af denne synkronisering paa en anden boks), rettes boksen
 *   ind efter den. Ligger der kun en almindelig kopi (ugentlig, "Gem nu")
 *   eller ingen, laegges boksens eget op. Den boks man slaar det til paa
 *   FOERST bestemmer altsaa; de naeste foelger den.
 * - Derefter: er skyen nyere end det vi sidst saa, og intet er aendret her,
 *   hentes den. Er noget aendret her og skyen uaendret, laegges det op. Er
 *   begge dele aendret, vinder den nyeste (skyens tidspunkt mod hvornaar den
 *   lokale aendring foerst blev set).
 * - En kopi uden brugerdata laegges aldrig op (som den ugentlige): en ny
 *   boks maa ikke slette alt paa de andre.
 * - Fremdrift i film flettes (den nyeste per titel); favoritter, grupper og
 *   resten erstattes, som ved en gendannelse.
 */

export interface CloudIo {
  upload(code: string, json: string): Promise<void>;
  /** Kopien under kodeordet, eller null naar der ingen ligger. Kaster ved netfejl. */
  download(code: string): Promise<string | null>;
}

export type CloudSyncOutcome = 'off' | 'unchanged' | 'uploaded' | 'applied' | 'empty' | 'failed';

export interface CloudSyncResult {
  outcome: CloudSyncOutcome;
  /** Naar skyen blev lagt ind: hvad der kom med (til logoer og genindlaesning). */
  restore?: RestoreResult;
}

/** FNV-1a, 32 bit, som hex. Kun til at se om noget er aendret. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Fingeraftrykket af det brugeren selv har lavet: uden tidspunkt og uden kodeord. */
export function fingerprint(backup: Backup): string {
  const bare = {
    ...backup,
    exportedMs: 0,
    synced: false,
    sources: backup.sources.map(({ password: _password, ...rest }) => rest),
  };
  return hashText(JSON.stringify(bare));
}

let running: Promise<CloudSyncResult> | null = null;

/**
 * Én synkronisering: se paa skyen og paa boksen, og goer det ene der skal
 * goeres. Aldrig to paa én gang; det andet kald faar det foerstes svar.
 */
export function runCloudSync(
  db: SqlDatabase,
  io: CloudIo,
  now = Date.now(),
  loadCreds?: CredentialLoader,
): Promise<CloudSyncResult> {
  if (running !== null) return running;
  running = syncOnce(db, io, now, loadCreds).finally(() => {
    running = null;
  });
  return running;
}

async function syncOnce(db: SqlDatabase, io: CloudIo, now: number, loadCreds?: CredentialLoader): Promise<CloudSyncResult> {
  const config = await getSkyConfig(db);
  if (config.code === '' || !(await getSkySync(db))) return { outcome: 'off' };
  const state = await getSkySyncState(db);

  let local: Backup;
  let cloudJson: string | null;
  try {
    [local, cloudJson] = await Promise.all([createBackup(db, now, loadCreds), io.download(config.code)]);
  } catch {
    return { outcome: 'failed' };
  }
  const localFp = fingerprint(local);
  const localDirty = state.fingerprint !== '' && localFp !== state.fingerprint;
  const dirtySince = localDirty ? (state.dirtySinceMs > 0 ? state.dirtySinceMs : now) : 0;

  let cloud: Backup | null = null;
  if (cloudJson !== null) {
    try {
      cloud = parseBackup(cloudJson);
    } catch {
      cloud = null;
    }
  }
  const cloudSynced = cloud !== null && cloud.synced === true;
  const cloudNewer = cloud !== null && cloudSynced && cloud.exportedMs > state.seenMs;
  const first = state.fingerprint === '';

  // Skyen skal laegges ind: foerste gang naar der ligger en synkroniseret
  // kopi; senere naar den er nyere end det vi saa, og den vinder over en
  // lokal aendring (skyens tidspunkt mod hvornaar aendringen foerst blev set).
  const applyCloud = cloud !== null && (first ? cloudSynced : cloudNewer && (!localDirty || cloud.exportedMs > dirtySince));
  if (applyCloud && cloud !== null) {
    let restore: RestoreResult;
    try {
      restore = await restoreBackup(db, cloud, { matchByName: true, mergeProgress: true });
    } catch {
      return { outcome: 'failed' };
    }
    // Fingeraftrykket af det der nu ligger her, saa naeste tjek ser "uaendret".
    const after = await createBackup(db, now, loadCreds);
    await setSkySyncState(db, { fingerprint: fingerprint(after), seenMs: cloud.exportedMs, dirtySinceMs: 0 });
    return { outcome: 'applied', restore };
  }

  const shouldUpload = first || localDirty;
  if (!shouldUpload) {
    return { outcome: 'unchanged' };
  }
  if (!backupHasUserData(local)) {
    // Intet at laegge op: husk kun at vi har set skyen, saa en tom boks
    // ikke bliver ved med at "vaere aendret".
    await setSkySyncState(db, { fingerprint: state.fingerprint, seenMs: state.seenMs, dirtySinceMs: 0 });
    return { outcome: 'empty' };
  }
  try {
    await io.upload(config.code, serialiseBackup({ ...local, synced: true }));
  } catch {
    // Netfejl: husk hvornaar aendringen blev set, saa en senere konflikt afgoeres rigtigt.
    await setSkySyncState(db, { fingerprint: state.fingerprint, seenMs: state.seenMs, dirtySinceMs: dirtySince });
    return { outcome: 'failed' };
  }
  await setSkySyncState(db, { fingerprint: localFp, seenMs: local.exportedMs, dirtySinceMs: 0 });
  await setSkyLastMs(db, now);
  return { outcome: 'uploaded' };
}

/**
 * Efter en manuel "Hent fra skyen" (eller gendannelse ved opsaetning): det
 * der ligger her, ER skyens kopi nu. Uden dette ville naeste synkronisering
 * enten hente den igen eller laegge den op igen.
 */
export async function markCloudApplied(db: SqlDatabase, cloudJson: string, now = Date.now()): Promise<void> {
  let seenMs = now;
  try {
    seenMs = parseBackup(cloudJson).exportedMs;
  } catch {
    // Uparselig: saa taeller "nu".
  }
  const after = await createBackup(db, now);
  await setSkySyncState(db, { fingerprint: fingerprint(after), seenMs, dirtySinceMs: 0 });
}
