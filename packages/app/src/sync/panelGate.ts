/**
 * Én koe for alle EPG-kald til panelet (v350).
 *
 * Panelet tillader én forbindelse, og det taeller tilsyneladende ogsaa
 * `player_api.php`-kald: fire ad gangen gav 403 paa alt. Hvert lag holdt
 * sig derfor til ét kald ad gangen — men lagene vidste ikke om hinanden.
 * Fra v339 hentede Sport hele programtabellen for op til 150 kanaler i
 * baggrunden, samtidig med at forsiden, guiden og kanallisten bad om deres,
 * og saa stod alt og "indlaeste" (v350: "hele appen koerer super langsomt").
 *
 * Her staar de i koe: hoejst ét kald i luften, og det man kan se paa
 * skaermen (forgrund) gaar altid foer baggrundsarbejde. En baggrundshentning
 * tager koeen per kanal, saa guiden hoejst venter paa ét kald.
 */
type Waiter = () => void;

let busy = false;
const foreground: Waiter[] = [];
const background: Waiter[] = [];

/** Venter til panelet er ledigt. Baggrund koerer kun naar ingen forgrund venter. */
export function acquirePanel(isBackground: boolean): Promise<void> {
  if (!busy) {
    busy = true;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    (isBackground ? background : foreground).push(resolve);
  });
}

export function releasePanel(): void {
  const next = foreground.shift() ?? background.shift();
  if (next === undefined) {
    busy = false;
    return;
  }
  next();
}

/** Koerer `work` naar panelet er ledigt, og slipper det igen — ogsaa ved fejl. */
export async function withPanel<T>(isBackground: boolean, work: () => Promise<T>): Promise<T> {
  await acquirePanel(isBackground);
  try {
    return await work();
  } finally {
    releasePanel();
  }
}

/** Hvor mange der venter, til status og test. */
export function panelQueue(): { foreground: number; background: number; busy: boolean } {
  return { foreground: foreground.length, background: background.length, busy };
}

/** Kun til test. */
export function resetPanelGate(): void {
  busy = false;
  foreground.length = 0;
  background.length = 0;
}
