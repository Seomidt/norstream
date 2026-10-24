/** Kun maaletal og fase-navne: ingen kilde-URL eller native fejltekst. */
export interface PreparationPlayer {
  currentTime: number;
  bufferedPosition: number;
  playing: boolean;
  playbackRate: number;
  status: string;
}
export interface PreparationState { preparationPhase: string }

/** Observer ogsaa en klargoering uden timeUpdate, indtil klar/fejl/afbrudt. */
export function watchArchivePreparation(
  player: PreparationPlayer,
  state: PreparationState,
  targetSeconds: number,
  log: (line: string) => void,
): (result: 'klar' | 'fejl' | 'afbrudt') => void {
  const started = Date.now();
  let stopped = false;
  const number = (value: number): string => Number.isFinite(value) && value >= 0 ? value.toFixed(3) : '?';
  const report = (event: string): void => {
    try {
      log(`klargoering v392: ${event}, fase ${state.preparationPhase}, ventet ${Math.round((Date.now() - started) / 1000)} s, position ${number(player.currentTime)} s, maal ${number(targetSeconds)} s, buffer ${number(player.bufferedPosition)} s, spiller ${player.playing ? 'ja' : 'nej'}, hastighed ${number(player.playbackRate)}, status ${['idle', 'loading', 'readyToPlay', 'error'].includes(player.status) ? player.status : 'ukendt'}`);
    } catch {
      // Expo-video kan allerede vaere frigivet ved unmount.
      log(`klargoering v392: ${event}, native afspiller utilgaengelig`);
    }
  };
  report('start');
  const timer = setInterval(() => report('venter'), 5000);
  return result => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    report(result);
  };
}
