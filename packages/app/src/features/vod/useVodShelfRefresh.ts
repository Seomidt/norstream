import { useEffect } from 'react';
import { AppState } from 'react-native';

/** Genlaes lokale hylder ved tilbagekomst, cloud-gendannelse og app-resume. */
export function useVodShelfRefresh(load: () => Promise<void>, active: boolean, reloadToken: number): void {
  useEffect(() => {
    if (!active) return;
    const refresh = (): void => { void load().catch(() => undefined); };
    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, [load, active, reloadToken]);
}
