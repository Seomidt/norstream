import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { getSetting, setSetting } from '../../storage/settings.js';
import type { SqlDatabase } from '../../storage/types.js';
import { isTV } from '../../ui/tv.js';

export const UNIFORM_AUDIO_SUPPORTED = isTV && Platform?.OS === 'android';
export const UNIFORM_AUDIO_KEY = 'uniform_audio';
let enabled = true;
let revision = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
function apply(value: boolean): void {
  enabled = value;
  for (const listener of listeners) listener();
}
export async function loadUniformAudio(db: SqlDatabase): Promise<boolean> {
  const before = revision;
  const value = (await getSetting(db, UNIFORM_AUDIO_KEY)) !== '0';
  if (before === revision) apply(value);
  return enabled;
}
export async function saveUniformAudio(db: SqlDatabase, value: boolean): Promise<void> {
  await setSetting(db, UNIFORM_AUDIO_KEY, value ? '1' : '0');
  revision += 1;
  apply(value);
}
export function useUniformAudio(db: SqlDatabase): boolean {
  const value = useSyncExternalStore(subscribe, () => enabled, () => false);
  useEffect(() => {
    if (UNIFORM_AUDIO_SUPPORTED) void loadUniformAudio(db).catch(() => undefined);
  }, [db]);
  return UNIFORM_AUDIO_SUPPORTED && value;
}
