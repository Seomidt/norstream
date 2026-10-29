import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import type { AppSession } from '../session.js';
import { refreshFollowedSeries } from './vodDetails.js';

/** Opstart, app-resume og loebende kontrol, uafhaengigt af katalogets doegnrytme.
 * Seks-timers graensen og deling af igangvaerende kald ligger i hente-laget. */
export function useFollowedSeriesRefresh(session: AppSession, enabled: boolean, onChanged: () => void): void {
  const changed = useRef(onChanged);
  changed.current = onChanged;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let running = false;
    let foreground = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    const continueWork = () => !cancelled && foreground;
    const run = (): void => {
      if (!continueWork() || running) return;
      running = true;
      void (async () => {
        let updated = 0;
        for (const access of session.sources) {
          if (!continueWork()) break;
          if (access.source.kind !== 'xtream' || access.creds === null) continue;
          updated += await refreshFollowedSeries(session.db, access.source.id, access.creds, session.fetchImpl, new Date(), continueWork).catch(() => 0);
        }
        if (continueWork() && updated > 0) changed.current();
      })().finally(() => { running = false; });
    };
    run();
    const timer = setInterval(run, 30 * 60_000);
    const subscription = AppState.addEventListener('change', state => {
      foreground = state === 'active';
      if (foreground) run();
    });
    return () => { cancelled = true; clearInterval(timer); subscription.remove(); };
  }, [session, enabled]);
}
