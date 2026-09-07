import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
// Ikke react-natives egen SafeAreaView: den gør **ingenting paa Android**.
// Telefonens navigationslinje laa derfor oven i appens fanelinje, og det saa
// ud som et layoutproblem i appen frem for en manglende indramning.
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { Programme } from '@norstream/core';
import { HomeScreen } from './src/features/home/HomeScreen.js';
import type { HomePlace } from './src/features/home/HomeScreen.js';
import { OnboardingScreen } from './src/features/onboarding/OnboardingScreen.js';
import { PlayerScreen } from './src/features/player/PlayerScreen.js';
import { VodDetailScreen } from './src/features/vod/VodDetailScreen.js';
import type { Playback } from './src/features/vod/VodDetailScreen.js';
import { VodPlayerScreen } from './src/features/vod/VodPlayerScreen.js';
import { TrailerScreen } from './src/features/vod/TrailerScreen.js';
import { createSession, reloadSources } from './src/session.js';
import type { AppSession } from './src/session.js';

import type { StoredChannel } from './src/storage/channels.js';
import { theme } from './src/ui/theme.js';

type Route =
  | { name: 'loading' }
  | { name: 'onboarding'; notice?: string }
  | { name: 'home' }
  /** `startFrom` er sat naar afspilningen kommer fra guidens start-forfra. */
  | { name: 'player'; channel: StoredChannel; startFrom?: Programme }
  /** En film eller serie. Afspilleren husker hvilken titel den kom fra. */
  | { name: 'vodDetail'; itemKey: string }
  | { name: 'vodPlayer'; itemKey: string; playback: Playback }
  | { name: 'trailer'; itemKey: string; trailerId: string; title: string }
  | { name: 'error' };

/**
 * Opstarten laeser Keychain, aabner SQLite og koerer migreringen. Alle tre
 * kan kaste — f.eks. hvis enheden har en database fra en tidligere
 * skema-version, hvor en kolonne mangler. Uden en fejlrute ville appen blive
 * staaende paa spinneren for evigt uden vej ud, saa vi fanger og tilbyder et
 * nyt forsoeg.
 */
const BOOT_ERROR_TEXT =
  'Appen kunne ikke starte. Prøv igen — hjælper det ikke, kan du geninstallere appen.';

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'loading' });
  const [session, setSession] = useState<AppSession | null>(null);
  const [bootAttempt, setBootAttempt] = useState(0);
  /**
   * Hvor brugeren stod i Hjem, loeftet herop.
   *
   * HomeScreen afmonteres naar afspilleren aabnes, og med den forsvandt baade
   * den valgte fane og hvor langt man var naaet ned i land -> kategori ->
   * kanaler. "Tilbage" landede saa altid paa Favoritter, uanset hvor turen
   * begyndte. Tilstanden bor her, hvor den overlever afspilleren.
   */
  const [place, setPlace] = useState<HomePlace>({ tab: 'favorites', browse: null, vod: null });

  useEffect(() => {
    let cancelled = false;

    async function boot(): Promise<void> {
      // Sessionen aabnes altid: den er ogsaa det der flytter en installation
      // fra tiden med ét panel over paa kilder. Foerst bagefter kan vi vide
      // om der er noget at vise.
      const created = await createSession();
      if (cancelled) return;
      setSession(created);
      setRoute(created.sources.length === 0 ? { name: 'onboarding' } : { name: 'home' });
    }

    boot().catch(() => {
      if (cancelled) return;
      setRoute({ name: 'error' });
    });

    return () => {
      cancelled = true;
    };
  }, [bootAttempt]);

  async function afterOnboarding(): Promise<void> {
    try {
      const created = session === null ? await createSession() : await reloadSources(session);
      if (created.sources.length === 0) return;
      setSession(created);
      setRoute({ name: 'home' });
    } catch {
      // Samme grund som i boot(): databasen kan kaste, og en spinner uden
      // udgang er vaerre end en fejlbesked med en knap.
      setRoute({ name: 'error' });
    }
  }

  /**
   * Telefonens egen tilbage-knap.
   *
   * Appen har ingen navigationsstak — ruterne er en union her — og Android
   * goer det eneste den kan uden en: lukker appen. Midt i en film. Nu foelger
   * knappen den samme vej som "Tilbage" paa skaermen: afspiller -> titel ->
   * hjem, og inde i Hjem ét niveau op i land -> kategori -> kanaler. Foerst
   * paa forsiden faar Android lov til at lukke.
   */
  const homeBack = useRef<() => boolean>(() => false);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      switch (route.name) {
        case 'player':
        case 'vodDetail':
          setRoute({ name: 'home' });
          return true;
        case 'vodPlayer':
        case 'trailer':
          setRoute({ name: 'vodDetail', itemKey: route.itemKey });
          return true;
        case 'home':
          return homeBack.current();
        default:
          return false;
      }
    });
    return () => subscription.remove();
  }, [route]);

  function retryBoot(): void {
    setSession(null);
    setRoute({ name: 'loading' });
    setBootAttempt((n) => n + 1);
  }

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
          <Text style={styles.errorText}>{BOOT_ERROR_TEXT}</Text>
          <Pressable style={styles.button} onPress={retryBoot}>
            <Text style={styles.buttonText}>Prøv igen</Text>
          </Pressable>
        </View>
      )}
      {route.name === 'onboarding' && (
        <OnboardingScreen
          notice={route.notice}
          onDone={() => {
            void afterOnboarding();
          }}
        />
      )}
      {route.name === 'home' && session !== null && (
        <HomeScreen
          session={session}
          place={place}
          onPlaceChange={setPlace}
          onSelect={(channel, startFrom) =>
            setRoute({ name: 'player', channel, startFrom })
          }
          onOpenVod={(item) => setRoute({ name: 'vodDetail', itemKey: item.key })}
          backRef={homeBack}
          onSourcesChanged={() => {
            void (async () => {
              // Kilderne er skiftet: sessionen skal laese legitimation for de
              // nye og glemme de fjernede, ellers bygger afspilleren URL'er
              // for et panel der ikke laengere findes.
              setSession(await reloadSources(session));
            })();
          }}
          onSignedOut={(notice) => {
            setSession(null);
            setPlace({ tab: 'favorites', browse: null, vod: null });
            setRoute({ name: 'onboarding', notice });
          }}
        />
      )}
      {route.name === 'player' && session !== null && (
        <PlayerScreen
          session={session}
          channel={route.channel}
          startFrom={route.startFrom}
          onBack={() => setRoute({ name: 'home' })}
        />
      )}
      {route.name === 'vodDetail' && session !== null && (
        <VodDetailScreen
          session={session}
          itemKey={route.itemKey}
          onBack={() => setRoute({ name: 'home' })}
          onPlay={(playback) => setRoute({ name: 'vodPlayer', itemKey: route.itemKey, playback })}
          onTrailer={(trailerId, title) =>
            setRoute({ name: 'trailer', itemKey: route.itemKey, trailerId, title })
          }
        />
      )}
      {route.name === 'trailer' && (
        <TrailerScreen
          trailerId={route.trailerId}
          title={route.title}
          onBack={() => setRoute({ name: 'vodDetail', itemKey: route.itemKey })}
        />
      )}
      {route.name === 'vodPlayer' && session !== null && (
        <VodPlayerScreen
          session={session}
          playback={route.playback}
          onBack={() => setRoute({ name: 'vodDetail', itemKey: route.itemKey })}
        />
      )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  errorText: {
    color: theme.colors.text,
    fontSize: 15,
    textAlign: 'center',
    marginBottom: theme.spacing.lg,
  },
  button: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
  },
  buttonText: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
});
