/**
 * Filteret "kun kanaler med start forfra": ét valg for alle lister, men
 * kun saa laenge appen er aaben.
 *
 * Det blev gemt paa telefonen foer, og saa stod det og skjulte kanaler
 * dage efter at nogen havde slaaet det til — uden at nogen kunne huske
 * det. Alle kanaler vises altid ved start; filteret er et tryk vaek naar
 * man vil have det, og vaek igen naar appen lukkes.
 */

let enabled = false;
const listeners = new Set<() => void>();

export function restartFilterEnabled(): boolean {
  return enabled;
}

export function setRestartFilterEnabled(value: boolean): void {
  if (value === enabled) return;
  enabled = value;
  for (const listener of listeners) listener();
}

export function subscribeRestartFilter(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
