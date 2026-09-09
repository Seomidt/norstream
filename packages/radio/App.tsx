import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { StoredChannel } from '@norstream/app/src/storage/channels.js';
import { createSession } from '@norstream/app/src/session.js';
import type { AppSession } from '@norstream/app/src/session.js';
import { InternetRadio } from '@norstream/app/src/features/radio/InternetRadio.js';
import type { RadioCountry } from '@norstream/app/src/sync/radioBrowser.js';
import { theme } from '@norstream/app/src/ui/theme.js';
import { RadioPlayerScreen } from './src/RadioPlayerScreen.js';
import { applyCarFavourites, syncAutoLibrary } from './src/library.js';
import { autoLog, clearAutoLog, current, nowPlayingEnabled, setNowPlayingEnabled, subscribe, titledStations } from './modules/radio-auto/index.js';
import type { AutoSnapshot } from './modules/radio-auto/index.js';

/**
 * NorRadio: internetradioen fra NorStream som sin egen app.
 *
 * Samme kode som Radio-fanen — lande med flag, stationer fra Radio Browser,
 * favoritter, soegning, afspilleren med soejler — men uden panel, uden
 * kanaler og uden film. Lyden spiller videre naar skaermen slukkes, med
 * styring i notifikationen og fra bilens rat over Bluetooth.
 */
/** Hoejden paa "spiller nu"-baren, som listen faar som luft i bunden. */
const BAR_HEIGHT = 44;

type Route = { name: 'loading' } | { name: 'home' } | { name: 'player'; channel: StoredChannel; zap: StoredChannel[] } | { name: 'error' };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'loading' });
  const [session, setSession] = useState<AppSession | null>(null);
  /** Landet der er aabnet. Ligger her, saa det overlever afspilleren. */
  const [country, setCountry] = useState<RadioCountry | null>(null);
  const listBack = useRef<() => boolean>(() => false);
  /** Taelles op hver gang afspilleren lukker, saa listen ruller tilbage til sin plads. */
  const [returned, setReturned] = useState(0);
  /** Stationer der sender titel; laeses igen hver gang man er tilbage paa listen. */
  const [titled, setTitled] = useState<Set<string>>(() => titledStations());
  /** Den skjulte fejlsoegningsside: hold fingeren paa titlen. */
  const [showLog, setShowLog] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [nowPlayingOn, setNowPlayingOn] = useState(true);
  const openLog = (): void => {
    setLog(autoLog());
    setNowPlayingOn(nowPlayingEnabled());
    setShowLog(true);
  };
  const closePlayer = (): void => {
    setRoute({ name: 'home' });
    setReturned((count) => count + 1);
    setTitled(titledStations());
  };
  /** Hvad tjenesten spiller lige nu, ogsaa naar det er bilen der valgte. */
  const [playing, setPlaying] = useState<AutoSnapshot>(() => current());
  useEffect(() => subscribe(setPlaying), []);

  /** Taelles op naar bilen har aendret favoritterne, saa listen laeser dem igen. */
  const [favouritesSignal, setFavouritesSignal] = useState(0);

  // Bibliotek til bilen: ved start, og hver gang man er tilbage paa listen.
  // Foerst foeres bilens favoritter ind; har den aendret noget, laeses listen igen.
  useEffect(() => {
    if (session === null || route.name !== 'home') return;
    const db = session.db;
    void (async () => {
      if (await applyCarFavourites(db)) setFavouritesSignal((count) => count + 1);
      await syncAutoLibrary(db);
    })();
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
      if (showLog) {
        setShowLog(false);
        return true;
      }
      if (route.name === 'player') {
        closePlayer();
        return true;
      }
      if (route.name === 'home') return listBack.current();
      return false;
    });
    return () => subscription.remove();
  }, [route, showLog]);

  const barShown = playing.state !== 'idle' && playing.title !== null;

  // Listen maa ikke skifte hoejde: paa Android hopper en liste til toppen
  // naar dens hoejde aendres. Derfor er kanterne de samme uanset skaerm
  // (afspilleren ligger uden for SafeAreaView og tager selv sine kanter),
  // og "spiller nu"-baren ligger oven paa listen i stedet for under den.
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
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
              <Pressable onLongPress={openLog} delayLongPress={800}>
                <Text style={styles.title}>NorRadio</Text>
              </Pressable>
            </View>
            <InternetRadio
              session={session}
              country={country}
              onCountryChange={setCountry}
              onSelect={(channel, zap) => setRoute({ name: 'player', channel, zap })}
              backRef={listBack}
              contentBottom={barShown ? BAR_HEIGHT : 0}
              restoreSignal={returned}
              titledIds={titled}
              favouritesSignal={favouritesSignal}
              onFavouritesChanged={() => {
                void syncAutoLibrary(session.db);
              }}
            />
            {barShown && (
              <View style={styles.nowPlaying}>
                <Text style={styles.nowPlayingText} numberOfLines={1}>
                  {playing.state === 'playing' ? '▶' : playing.state === 'paused' ? '❚❚' : '…'} {playing.title}
                  {playing.track !== null ? ` · ${playing.artist !== null ? `${playing.artist} – ` : ''}${playing.track}` : ''}
                </Text>
              </View>
            )}
          </View>
        )}
      </SafeAreaView>
      {showLog && (
        <View style={styles.overlay}>
          <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
            <View style={styles.logBar}>
              <Text style={styles.title}>Tjenestens log</Text>
              <Pressable onPress={() => setLog(autoLog())} hitSlop={8}>
                <Text style={styles.logAction}>Opdatér</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  clearAutoLog();
                  setLog([]);
                }}
                hitSlop={8}
              >
                <Text style={styles.logAction}>Ryd</Text>
              </Pressable>
              <Pressable onPress={() => setShowLog(false)} hitSlop={8}>
                <Text style={styles.logAction}>Luk</Text>
              </Pressable>
            </View>
            <View style={styles.logSwitch}>
              <Text style={styles.logSwitchText}>Sang og cover i bilen</Text>
              <Switch
                value={nowPlayingOn}
                onValueChange={(value) => {
                  setNowPlayingEnabled(value);
                  setNowPlayingOn(value);
                }}
              />
            </View>
            <ScrollView contentContainerStyle={styles.logContent}>
              <Text style={styles.logText} selectable>
                {log.length === 0 ? 'Ingen linjer endnu.' : log.join('\n')}
              </Text>
            </ScrollView>
          </SafeAreaView>
        </View>
      )}
      {route.name === 'player' && session !== null && (
        <View style={styles.overlay}>
          <RadioPlayerScreen channel={route.channel} zap={route.zap} onBack={closePlayer} />
        </View>
      )}
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
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: BAR_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderTopColor: theme.colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  nowPlayingText: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
  logBar: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.md },
  logAction: { color: theme.colors.accent, fontSize: 15, fontWeight: '600' },
  logSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  logSwitchText: { color: theme.colors.text, fontSize: 15 },
  logContent: { padding: theme.spacing.md },
  logText: { color: theme.colors.textMuted, fontSize: 11, fontFamily: 'monospace', lineHeight: 15 },
});
