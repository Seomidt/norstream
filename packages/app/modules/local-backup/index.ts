import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

/**
 * Direkte sikkerhedskopi mellem telefon og tv paa det lokale wi-fi.
 *
 * Tv'et starter en modtager (LocalBackupModule.kt) og viser sin adresse og
 * en kode. Telefonen sender filen med en POST til den adresse (det gaar
 * gennem almindelig fetch, saa afsenderen behoever intet native). Ingen
 * sky, ingen konto. Tomme svar paa andre platforme og uden modulet.
 */
export interface Receiver {
  ip: string | null;
  port: number;
}

interface NativeModule {
  localIp(): string | null;
  startReceiver(pin: string): Promise<number>;
  stopReceiver(): void;
  addListener(event: 'onReceived', listener: (payload: { json: string }) => void): { remove: () => void };
}

let native: NativeModule | null = null;
if (Platform.OS === 'android') {
  try {
    native = requireNativeModule('LocalBackup') as NativeModule;
  } catch {
    native = null;
  }
}

export const localBackupAvailable = native !== null;

/** Starter modtageren og svarer med adressen telefonen skal sende til. */
export async function startReceiver(pin: string): Promise<Receiver> {
  if (native === null) throw new Error('Modtagelse virker kun på tv-appen.');
  const port = await native.startReceiver(pin);
  return { ip: native.localIp(), port };
}

export function stopReceiver(): void {
  try {
    native?.stopReceiver();
  } catch {
    // Ingen modtager at stoppe.
  }
}

export function subscribeReceived(listener: (json: string) => void): () => void {
  const subscription = native?.addListener('onReceived', (payload) => listener(payload.json));
  return () => subscription?.remove();
}

/** Telefonens vej: send kopien til tv'ets adresse. Kaster med en grund ved fejl. */
export async function sendToTv(ip: string, port: number, pin: string, json: string): Promise<void> {
  const url = `http://${ip}:${port}/backup`;
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', headers: { 'X-Norstream-Pin': pin, 'Content-Type': 'application/json' }, body: json });
  } catch {
    throw new Error('Tv’et kunne ikke nås. Er telefon og tv på det samme wi-fi, og passer adressen?');
  }
  if (response.status === 403) throw new Error('Forkert kode. Tjek koden på tv’et.');
  if (!response.ok) throw new Error(`Tv’et svarede HTTP ${response.status}.`);
}
