/** Kort ophold ved pil-navigation; OK og indgang i indholdet sker straks. */
export const RAIL_SETTLE_MS = 100;
const ARROWS = new Set(['left', 'longLeft', 'up', 'longUp', 'down', 'longDown']);

export function createRailSelection<T>(select: (id: T) => void, lastKey: () => { type: string; at: number }) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { id: T } | null = null;
  const stopTimer = (): void => { if (timer !== null) clearTimeout(timer); timer = null; };
  const cancel = (): void => { stopTimer(); pending = null; };
  const enter = (): void => {
    const next = pending;
    cancel();
    if (next !== null) select(next.id);
  };
  return {
    focus(id: T): void {
      const key = lastKey();
      if (!ARROWS.has(key.type) || Date.now() - key.at > 600) return;
      stopTimer();
      pending = { id };
      timer = setTimeout(enter, RAIL_SETTLE_MS);
    },
    // Android melder blur paa tryk ned, foer pil-hoejre naar JS ved slip.
    // Bevar derfor valget til enter, men stop den forsinkede aktivering.
    leave: stopTimer,
    enter,
    press(id: T): void { cancel(); select(id); },
    cancel,
  };
}
