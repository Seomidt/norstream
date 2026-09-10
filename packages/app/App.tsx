import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, Text, View } from 'react-native';
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
import { CanvasContext, TV_SAFE_MARGIN, TV_SCALE, isTV } from './src/ui/tv.js';
import { TvPressable } from './src/ui/TvPressable.js';

type Route =
  | { name: 'loading' }
  | { name: 'onboarding'; notice?: string }
  | { name: 'home' }
  /** `startFrom` er sat naar afspilningen kommer fra guidens start-forfra. */
  | { name: 'player'; channel: StoredChannel; startFrom?: Programme; zap?: StoredChannel[] }
  /** En film eller serie. Afspilleren husker hvilken titel den kom fra. */
  | { name: 'vodDetail'; itemKey: string }
  | { name: 'vodPlayer'; itemKey: string; playback: Playback }
  | {
      name: 'trailer';
      itemKey: string;
      trailerId: string | null;
      title: string;
      year: number | null;
      kind: 'movie' | 'series';
    }
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
  const [place, setPlace] = useState<HomePlace>({ tab: 'home', browse: null, vod: null });

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

  /** Skaermene der ligger oven paa Hjem, med Hjem i behold nedenunder. */
  const overHome =
    route.name === 'player' || route.name === 'vodDetail' || route.name === 'trailer' || route.name === 'vodPlayer';

  // Paa tv tegnes alt i et mindre laerred og skaleres op: se ui/tv.ts.
  // Skaleringen sker om laerredets midte, saa det skubbes foerst ind i
  // fladens midte (positivt: laerredet er mindre end fladen) og vokser
  // derfra ud til kanterne. Fladen maales paa det yderste lag.
  // Laerredet holder TV_SAFE_MARGIN fri langs alle kanter: fjernsynet kan
  // beskaere billedet, og saa skal det yderste ikke vaere noget der bruges.
  //
  // Laerredet maa IKKE have flex: 1 sammen med hoejden: i Yoga slaar
  // flex: 1 (flexBasis 0 + vokse) den faste hoejde, saa laerredet blev lige
  // saa hoejt som hele fladen og efter skaleringen halvanden gang hoejere.
  // Derfor laa menulinjen nederst langt under skaermens kant, mens bredden
  // (tvaeraksen) passede. Laerredet laegges absolut, saa flex ikke blander sig.
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const visible = 1 - 2 * TV_SAFE_MARGIN;
  const canvasWidth = (frame.width * visible) / TV_SCALE;
  const canvasHeight = (frame.height * visible) / TV_SCALE;
  const canvas =
    isTV && frame.width > 0
      ? {
          position: 'absolute' as const,
          left: 0,
          top: 0,
          width: canvasWidth,
          height: canvasHeight,
          backgroundColor: theme.colors.background,
          // Intet maa tegnes uden for laerredet: en liste der loeb ud over
          // kanten stod i den frie kant, ogsaa mens afspilleren daekkede
          // laerredet ("jeg kan skimte menuen bag ved kanalen").
          overflow: 'hidden' as const,
          transform: [
            { translateX: (frame.width - canvasWidth) / 2 },
            { translateY: (frame.height - canvasHeight) / 2 },
            { scale: TV_SCALE },
          ],
        }
      : styles.root;
  const canvasSize = useMemo(
    () => (isTV && frame.width > 0 ? { width: canvasWidth, height: canvasHeight } : null),
    [canvasWidth, canvasHeight, frame.width],
  );

  return (
    <SafeAreaProvider>
    <CanvasContext.Provider value={canvasSize}>
      {/* Det yderste lag males, saa der ikke staar hvidt uden om laerredet, og maales. */}
      <View
        style={styles.root}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setFrame((current) => (current.width === width && current.height === height ? current : { width, height }));
        }}
      >
      <View style={canvas}>
      {/* Afspillerne tager selv hoejde for udskaeringen: i landskab skal
          billedet helt ud til kanten, i portraet laegger de selv toppen til. */}
      <SafeAreaView
        style={styles.root}
        edges={route.name === 'player' || route.name === 'vodPlayer' ? [] : ['top', 'left', 'right']}
      >
        <StatusBar style="light" />
      {route.name === 'loading' && (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      )}
      {route.name === 'error' && (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{BOOT_ERROR_TEXT}</Text>
          <TvPressable style={styles.button} onPress={retryBoot}>
            <Text style={styles.buttonText}>Prøv igen</Text>
          </TvPressable>
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
      {/* Hjem bliver staaende under afspilleren og filmsiderne, ikke
          afmonteret: saa staar kanallisten, favoritterne og guiden praecis
          hvor man forlod dem naar man kommer tilbage, rullet og det hele.
          Foer blev alt tegnet forfra fra toppen. Skaermene ovenpaa daekker
          hele fladen, og Hjem tager ingen tryk imens. */}
      {(route.name === 'home' || overHome) && session !== null && (
        <View style={styles.homeHost} pointerEvents={route.name === 'home' ? 'auto' : 'none'}>
        <HomeScreen
          session={session}
          place={place}
          onPlaceChange={setPlace}
          onSelect={(channel, startFrom, neighbours) =>
            setRoute({ name: 'player', channel, startFrom, zap: neighbours })
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
            setPlace({ tab: 'home', browse: null, vod: null });
            setRoute({ name: 'onboarding', notice });
          }}
        />
        </View>
      )}
      {route.name === 'player' && session !== null && (
        <View style={styles.overlay}>
          <PlayerScreen
            session={session}
            channel={route.channel}
            startFrom={route.startFrom}
            zap={route.zap}
            onBack={() => setRoute({ name: 'home' })}
          />
        </View>
      )}
      {route.name === 'vodDetail' && session !== null && (
        <View style={styles.overlay}>
          <VodDetailScreen
            session={session}
            itemKey={route.itemKey}
            onBack={() => setRoute({ name: 'home' })}
            onPlay={(playback) => setRoute({ name: 'vodPlayer', itemKey: route.itemKey, playback })}
            onTrailer={(trailerId, title, year, kind) =>
              setRoute({ name: 'trailer', itemKey: route.itemKey, trailerId, title, year, kind })
            }
          />
        </View>
      )}
      {route.name === 'trailer' && session !== null && (
        <View style={styles.overlay}>
          <TrailerScreen
            session={session}
            trailerId={route.trailerId}
            title={route.title}
            year={route.year}
            kind={route.kind}
            onBack={() => setRoute({ name: 'vodDetail', itemKey: route.itemKey })}
          />
        </View>
      )}
      {route.name === 'vodPlayer' && session !== null && (
        <View style={styles.overlay}>
          <VodPlayerScreen
            session={session}
            playback={route.playback}
            onBack={() => setRoute({ name: 'vodDetail', itemKey: route.itemKey })}
          />
        </View>
      )}
      </SafeAreaView>
      </View>
      </View>
    </CanvasContext.Provider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  homeHost: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.background,
  },
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
