import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { logEvent } from '../diagnostics/log.js';

/** Kontrol af alder; selve kanallisten beholder sin eksisterende doegnrytme. */
export const CHANNEL_SYNC_CHECK_MS = 30 * 60_000;

/** Start, tilbage til appen og loebende mens Hjem er synlig. Ingen parallelle hentninger. */
export function useAutomaticChannelSync(refreshIfDue: () => Promise<void>, enabled: boolean): void {
  const inFlight = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let foreground = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    const run = (): void => {
      if (cancelled || !foreground || inFlight.current) return;
      inFlight.current = true;
      void refreshIfDue().catch(() => {
        logEvent('baggrund', 'kanaler v390: automatisk opdatering fejlede, beholder kanaldata');
      }).finally(() => { inFlight.current = false; });
    };
    run();
    const timer = setInterval(run, CHANNEL_SYNC_CHECK_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      foreground = state === 'active';
      if (foreground) run();
    });
    return () => { cancelled = true; clearInterval(timer); subscription.remove(); };
  }, [refreshIfDue, enabled]);
}
