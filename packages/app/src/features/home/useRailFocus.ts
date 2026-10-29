import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

interface FocusTarget { requestTVFocus(): void }

/** Tilbage sender native fokus straks; kun ubekraeftede forsoeg gentages. */
export function useRailFocus(enabled: boolean, target: RefObject<FocusTarget | null>) {
  const active = useRef(enabled);
  active.current = enabled;
  const stop = useRef<(updateState: boolean) => void>(() => undefined);
  const [pending, setPending] = useState(false);
  const confirm = useCallback(() => stop.current(true), []);

  const request = useCallback(() => {
    stop.current(false);
    if (!active.current) return;
    setPending(true);
    let finished = false;
    const requestNative = () => {
      if (finished) return;
      try { target.current?.requestTVFocus(); }
      catch { /* En native knap kan vaere frigivet lige foer den nye ref saettes. */ }
    };
    const frame = requestAnimationFrame(requestNative);
    const retry = setInterval(requestNative, 150);
    const timeout = setTimeout(() => finish(true), 1500);
    function finish(updateState: boolean) {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(frame);
      clearInterval(retry);
      clearTimeout(timeout);
      if (updateState) setPending(false);
    }
    stop.current = finish;
    // Direkte fra BackHandler, foer React tegner menuen eller en timer koerer.
    requestNative();
  }, [target]);

  useEffect(() => {
    if (!enabled) { stop.current(false); setPending(false); }
    return () => stop.current(false);
  }, [enabled]);

  return { pending, confirm, request };
}
