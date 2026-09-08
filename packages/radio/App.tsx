import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { StoredChannel } from '@norstream/app/src/storage/channels.js';
import { createSession } from '@norstream/app/src/session.js';
import type { AppSession } from '@norstream/app/src/session.js';
import { InternetRadio } from '@norstream/app/src/features/radio/InternetRadio.js';
import type { RadioCountry } from '@norstream/app/src/sync/radioBrowser.js';
import { theme } from '@norstream/app/src/ui/theme.js';
import { RadioPlayerScreen } from './src/RadioPlayerScreen.js';
import { syncAutoLibrary } from './src/library.js';
import { current, subscribe } from './modules/radio-auto/index.js';
import type { AutoSnapshot } from './modules/radio-auto/index.js';

/**
 * NorRadio: internetradioen fra NorStream som sin egen app.
 *
 * Samme kode som Radio-fanen — lande med flag, stationer fra Radio Browser,
 * favoritter, soegning, afspilleren med soejler — men uden panel, uden
 * kanaler og uden film. Lyden spiller videre naar skaermen slukkes, med
 * styring i notifikationen og fra bilens rat over Bluetooth.
 */
type Route = { name: 'loading' } | { name: 'home' } | { name: 'player'; channel: StoredChannel; zap: StoredChannel[] } | { name: 'error' };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'loading' });
  const [session, setSession] = useState<AppSession | null>(null);
  /** Landet der er aabnet. Ligger her, saa det overlever afspilleren. */
  const [country, setCountry] = useState<RadioCountry | null>(null);
  const listBack = useRef<() => boolean>(() => false);
  /** Hvad tjenesten spiller lige nu, ogsaa naar det er bilen der valgte. */
  const [playing, setPlaying] = useState<AutoSnapshot>(() => current());
  useEffect(() => subscribe(setPlaying), []);

  // Bibliotek til bilen: ved start, og hver gang man er tilbage paa listen.
  useEffect(() => {
    if (session === null || route.name !== 'home') return;
    void syncAutoLibrary(session.db);
  }, [session, route.name]);

  useEffect(() => {
    let cancelled = false;
    createSession()
      .then((created) => {
        if (cancelled) return;
        setSession(created);
        setRoute({ name: 'home' });
      })
      .catch(() => {
        if (!cancelled) setRoute({ name: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route.name === 'player') {
        setRoute({ name: 'home' });
        return true;
      }
      if (route.name === 'home') return listBack.current();
      return false;
    });
    return () => subscription.remove();
  }, [route]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={route.name === 'player' ? [] : ['top', 'left', 'right']}>
        <StatusBar style="light" />
        {route.name === 'loading' && (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        )}
        {route.name === 'error' && (
          <View style={styles.centered}>
            <Text style={styles.errorText}>Appen kunne ikke starte. Luk den helt og åbn den igen.</Text>
          </View>
        )}
        {(route.name === 'home' || route.name === 'player') && session !== null && (
          <View style={styles.host} pointerEvents={route.name === 'home' ? 'auto' : 'none'}>
            <View style={styles.header}>
              <Text style={styles.title}>NorRadio</Text>
            </View>
            <InternetRadio
              session={session}
              country={country}
              onCountryChange={setCountry}
              onSelect={(channel, zap) => setRoute({ name: 'player', channel, zap })}
              backRef={listBack}
            />
            {playing.state !== 'idle' && playing.title !== null && route.name === 'home' && (
              <View style={styles.nowPlaying}>
                <Text style={styles.nowPlayingText} numberOfLines={1}>
                  {playing.state === 'playing' ? '▶' : playing.state === 'paused' ? '❚❚' : '…'} {playing.title}
                </Text>
              </View>
            )}
          </View>
        )}
        {route.name === 'player' && session !== null && (
          <View style={styles.overlay}>
            <RadioPlayerScreen channel={route.channel} zap={route.zap} onBack={() => setRoute({ name: 'home' })} />
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  host: { flex: 1 },
  header: { paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.sm },
  title: { color: theme.colors.text, fontSize: 22, fontWeight: '800' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  errorText: { color: theme.colors.text, fontSize: 15, textAlign: 'center' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.background },
  nowPlaying: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderTopColor: theme.colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  nowPlayingText: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
});
