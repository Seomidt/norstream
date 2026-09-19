import { isTV } from '../../ui/tv.js';
import { checkForUpdate, downloadAndInstall } from './appUpdate.js';

/**
 * Opdater boksen af sig selv ved opstart.
 *
 * En Google TV-boks i en anden by kan ikke naaes, og ingen aabner
 * Indstillinger paa den. Derfor ser appen selv efter en nyere udgave hver
 * gang den starter: er der en, henter den APK'en og starter Androids
 * installation. Boksen viser saa systemets ene "installér?"-skaerm — det er
 * det eneste tryk Android ikke lader en app springe over — og er ellers
 * oppe paa den nye udgave uden at nogen roerer en computer.
 *
 * Kun paa tv. Paa telefonen ville en installation der starter af sig selv
 * ved hver opstart vaere paatraengende; der bliver knappen i Indstillinger
 * staaende som den frivillige vej.
 *
 * Alt her sker stille: en opdatering der ikke kan naaes (ingen forbindelse,
 * ingen udgivelse endnu, en fejl undervejs) maa aldrig staa i vejen for at
 * se tv. Derfor ingen fejlbesked — bare et forsoeg mere naeste gang.
 */
let attempted = false;

export async function maybeAutoUpdate(): Promise<void> {
  // Kun tv, og kun én gang per opstart: uden vagten ville et mislykket forsoeg
  // kunne gentage sig selv, og telefonen skal ikke installere af sig selv.
  if (attempted || !isTV) return;
  attempted = true;
  try {
    const found = await checkForUpdate();
    if (!found.available) return;
    await downloadAndInstall(found.url);
  } catch {
    // Stille med vilje: se doc ovenfor.
  }
}
