import type { ComponentType } from 'react';

/**
 * Skaermens kode evalueres foerst naar den faktisk tegnes. Metro pakker
 * stadig alt i APK'en; dette kraever hverken net eller en ny indlaesning
 * ved naeste besoeg. Skaermens identitet er stabil, saa fokus og tilstand
 * opfoerer sig som ved en almindelig import.
 */
export function deferredScreen<P extends object>(load: () => ComponentType<P>): ComponentType<P> {
  let loaded: ComponentType<P> | null = null;
  return function DeferredScreen(props: P) {
    const Screen = loaded ?? (loaded = load());
    return <Screen {...props} />;
  };
}
