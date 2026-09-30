import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WebViewMessageEvent } from 'react-native-webview';
import type { AppSession } from '../../session.js';
import { getTmdbApiKey, getYoutubeApiKey } from '../../storage/settings.js';
import { findTitleInfo, findTmdbTrailers, tmdbFetch } from '../../sync/tmdb.js';
import { theme } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { isTV } from '../../ui/tv.js';
import { MIN_TRAILER_SECONDS, findLongerTrailer, searchYoutubeTrailers, youtubeSearchUrl } from './trailerSearch.js';
import type { FetchText } from './trailerSearch.js';
import { webView } from './webview.js';
import { buildHlsMaster } from './youtubeStream.js';
import { findAppleTrailers } from './appleTrailer.js';
import type { GetJson } from './appleTrailer.js';
import { findImdbTrailers } from './imdbTrailer.js';
import type { GetText, PostJson } from './youtubeStream.js';
import { logEvent } from '../../diagnostics/log.js';
import { surfaceTypeForPlatform } from '../player/format.js';
import { TvPressable } from '../../ui/TvPressable.js';

/** Webvisningen, eller null paa tv, hvor den ikke findes. */
const WebView = webView();

interface Props {
  session: AppSession;
  /** Panelets bud paa en trailer. Kan mangle. */
  trailerId: string | null;
  title: string;
  year: number | null;
  /** Film eller serie; TMDB slaar dem op hver sit sted. */
  kind: 'movie' | 'series';
  onBack: () => void;
}

/**
 * Hvad der vises i rammen.
 *
 * - `measured`: YouTubes afspiller styret gennem deres IFrame-API, som
 *   fortaeller hvor lang videoen er. Det er saadan en teaser paa otte
 *   sekunder opdages.
 * - `plain`: den rene indlejring, uden maaling. Reserven hvis API'et ikke
 *   kommer op — en trailer der spiller er bedre end en der maales.
 * - `search`: YouTubes egen soegeside inde i appen, naar der ikke er nogen
 *   noegle at soege med, eller soegningen intet fandt.
 * - `looking`: soegningen gennem Data API'et er i gang.
 */
type Source =
  /** Videofilen i appens egen afspiller: Apple TV (HLS) eller IMDb (MP4). */
  | {
      kind: 'native';
      id: string;
      uri: string;
      /** Sekunder inde hvor der fortsaettes (0 fra start). */
      resumeAt: number;
      /** Hvilken udgave af adresserne (noegle og filnavn). */
      attempt: number;
      /** Genopretninger i traek uden at komme videre. */
      failures: number;
      /** Videoens laengde ifoelge kilden; bruges hvis afspilleren ikke kender den. */
      seconds: number | null;
      contentType: 'dash' | 'hls' | 'progressive';
      /** Fra IMDb (v335): en almindelig MP4, ingen graense. `id` er da IMDbs video-id. */
      imdb?: { titleId: string };
      /** Fra Apple TV (v336): HLS i fuld HD, ingen graense. `id` er da Apples trailer-id. */
      apple?: boolean;
    }
  /** YouTubes egen afspiller (telefon), med maaling af laengden. */
  | { kind: 'measured'; id: string; checkLength: boolean; startAt?: number }
  | { kind: 'plain'; id: string }
  /** Tv (v354): traileren spiller i YouTube-appen; skaermen lukker naar man kommer tilbage. */
  | { kind: 'external'; id: string }
  | { kind: 'search'; url: string }
  | { kind: 'looking' }
  /** Tv: intet fundet, og ingen soegeside at vise. */
  | { kind: 'none' };

/**
 * Traileren, inde i appen.
 *
 * Kilderne i raekkefoelge (v336): Apple TV (HLS i fuld HD) og IMDb (MP4 i
 * 1080p) i appens egen afspiller — de virker hele vejen. Findes titlen ikke
 * dér, er YouTube tilbage, og dér gaelder (v354):
 *
 * - **Tv: YouTube-appen.** Google TV har den, og den spiller i fuld kvalitet
 *   med fjernbetjeningen. Appen aabnes med video-id'et; naar man kommer
 *   tilbage, lukker trailerskaermen. Kan appen ikke aabnes, bruges YouTubes
 *   indlejrede afspiller i en webvisning som paa telefonen.
 * - **Telefon: YouTubes indlejrede afspiller** fra start, som beskrevet
 *   nedenfor.
 *
 * Den native YouTube-vej (v329–v334: YouTubes filer i appens afspiller, og
 * "blandingen" med et skift til YouTubes afspiller efter et minut) er fjernet:
 * YouTube stopper filerne efter ~1 minut uden deres robot-bevis, og skiftet
 * endte i daarlig kvalitet ("fungerer ikke"). Robot-beviset bygges ALDRIG
 * (se OVERDRAGELSE v333). `youtubeStream.ts` er kun HLS-hjaelperen til Apple.
 *
 * **Afspilleren ligger i en lille side med en neutral base-adresse.** Det er
 * maalt, ikke gaettet — i en rigtig browser paa GitHubs maskine, efter to
 * builds paa gaet:
 *
 * - `youtube.com/embed/<id>` aabnet direkte: fejl 153. Der fulgte ingen
 *   `Referer` med, og en indlejret afspiller vil vide hvilken side den sidder
 *   paa.
 * - En side med base-adressen `https://www.youtube.com`: fejl 152-4, "denne
 *   video er ikke tilgaengelig". YouTube afviser en indlejring der paastaar
 *   at sidde paa youtube.com selv.
 * - En side med en anden https-adresse som base: ingen fejl. Afspilleren
 *   staar klar.
 *
 * Adressen skal bare vaere en https-oprindelse der ikke er YouTubes egen.
 * Der hentes intet fra den; den er kun det navn webvisningen sender med.
 *
 * **Panelets id er et bud, ikke et svar.** Det kan vaere en teaser paa otte
 * sekunder, en video der ikke maa indlejres, eller mangle helt. Afspilleren
 * maaler varigheden, og er den under et minut — eller gaar det galt — soeges
 * der videre: med en API-noegle vaelger appen selv en lang nok, uden den
 * aabnes YouTubes soegeside herinde, saa man vaelger selv.
 */
/** En trailer at proeve: YouTube-id, hvor den kom fra, og om laengden skal maales. */
interface Candidate {
  id: string;
  note: string;
  checkLength: boolean;
}

/** YouTubes soegeside som tekst (til soegning uden API-noegle). */
const fetchText: FetchText = async (url, headers) => {
  const response = await fetch(url, { headers });
  return response.ok ? await response.text() : null;
};

const EMBED_ORIGIN = 'https://norstream.app';

/** Den native vej findes kun paa Android (DASH i ExoPlayer). */
const NATIVE_TRAILERS = Platform.OS === 'android';
/** YouTube svarer paa ~0,1 s; et hængende svar maa ikke holde traileren tilbage. */
const NATIVE_LOOKUP_TIMEOUT_MS = 6000;
/** Er afspilleren ikke klar efter saa lang tid, regnes den for gaaet i staa. */
const NATIVE_READY_TIMEOUT_MS = 15000;
/** Staar den og henter saa laenge midt i traileren, regnes den for gaaet i staa. */
const NATIVE_STALL_MS = 10000;
/**
 * Saa mange genopretninger i traek UDEN at komme videre, foer webvisningen
 * tager over. En genopretning der kom mindst NATIVE_PROGRESS_S videre
 * nulstiller tallet: stopper YouTube hvert minut, bliver det korte pauser.
 */
const NATIVE_MAX_RECOVERIES = 3;
const NATIVE_PROGRESS_S = 10;

/** m:ss til diagnoselinjen. */
function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** POST til YouTubes afspiller-API; null ved alt der ikke er et JSON-svar. */
const postJson: PostJson = async (url, headers, body) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NATIVE_LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    return response.ok ? ((await response.json()) as unknown) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/** GET af JSON (Apple TV's soegning og filmsider); null ved alt andet end et svar. */
const getJson: GetJson = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NATIVE_LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', Origin: 'https://tv.apple.com' },
      signal: controller.signal,
    });
    return response.ok ? ((await response.json()) as unknown) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/** GET af HLS-manifestet; null ved alt andet end et svar. */
const getText: GetText = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NATIVE_LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Manifestet skal ligge i en fil: afspilleren tager en adresse. Én fil per
 * video og forsoeg, skrevet forfra (YouTubes adresser udloeber efter timer).
 */
function writeManifest(videoId: string, attempt: number, text: string, extension: 'mpd' | 'm3u8'): string | null {
  try {
    const file = new File(Paths.cache, `trailer-${videoId}-${attempt}.${extension}`);
    if (file.exists) file.delete();
    file.create();
    file.write(text);
    return file.uri;
  } catch {
    return null;
  }
}

/** YouTube-appens pakkenavne: tv-udgaven foerst paa tv, saa telefonens. */
const YOUTUBE_PACKAGES = isTV ? ['com.google.android.youtube.tv', 'com.google.android.youtube'] : ['com.google.android.youtube'];
/** Er appen ikke afvist inden da, regnes den for aabnet. */
const LAUNCH_SETTLE_MS = 1500;

/**
 * Aabner traileren i YouTube-appen (v354). Svarer med om appen kom op;
 * `onReturned` kaldes naar man er tilbage fra den (startActivityAsync venter
 * paa at aktiviteten lukker). Foerst de kendte pakker, saa `vnd.youtube:`
 * som enhver YouTube-app tager. Ingen app → falsk, og den indlejrede
 * afspiller tager over.
 */
async function openInYoutubeApp(videoId: string, onReturned: () => void): Promise<boolean> {
  const id = safeId(videoId);
  const url = `https://www.youtube.com/watch?v=${id}`;
  const attempt = (params: IntentLauncher.IntentLauncherParams, data: string): Promise<boolean> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(true), LAUNCH_SETTLE_MS);
      IntentLauncher.startActivityAsync('android.intent.action.VIEW', { ...params, data })
        .then(() => {
          clearTimeout(timer);
          resolve(true);
          onReturned();
        })
        .catch(() => {
          clearTimeout(timer);
          resolve(false);
        });
    });
  if (Platform.OS !== 'android') return false;
  for (const packageName of YOUTUBE_PACKAGES) {
    if (await attempt({ packageName }, url)) return true;
  }
  return attempt({}, `vnd.youtube:${id}`);
}

/**
 * En rigtig Chrome-browser-streng, ikke webvisningens egen.
 *
 * YouTube er begyndt at spaerre den indlejrede afspiller i webvisninger med
 * "Log ind for at bekraefte, at du ikke er en bot". En webvisnings egen
 * User-Agent (";wv") er noget af det de kigger efter. Med en almindelig
 * Chrome-streng behandles indlejringen som en browser, og sammen med
 * tredjeparts-cookies (saa YouTube maa saette sine egne) rammer bot-tjekket
 * sjaeldnere. Det er ikke en garanti — tjekket sidder ogsaa paa YouTubes side
 * — men "Aabn i YouTube" er der stadig som sikker vej.
 */
/**
 * Paa tv: en desktop-Chrome-streng. Med mobilstrengen faar man YouTubes
 * mobilafspiller, som paa en stor skaerm vaelger lav kvalitet og spiller
 * daarligere; desktop-afspilleren vaelger kvalitet efter rammens stoerrelse
 * (fuld skaerm paa tv'et = HD). Samme bot-hensyn som mobilstrengen: en
 * rigtig browser, ikke webvisningens egen.
 */
const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36';

export function TrailerScreen({ session, trailerId, title, year, kind, onBack }: Props) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Der begyndes altid med at lede: TMDB er foerste valg naar noeglen er der.
  const [source, setSource] = useState<Source>({ kind: 'looking' });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** Kandidater der venter, bedste foerst. */
  const queue = useRef<Candidate[]>([]);
  /** Videoer der allerede er proevet, saa den samme ikke proeves igen. */
  const tried = useRef(new Set<string>());
  /** Hvor langt ned i kilderne vi er naaet (se refill). */
  const stage = useRef(0);
  /** Skaermen er stadig aaben; en soegning der svarer sent maa ikke roere en lukket skaerm. */
  const alive = useRef(true);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  /**
   * Fylder koeen fra naeste kilde, i den raekkefoelge de er bedst:
   *
   *  0. TMDB — ved hvad der er en trailer; alle dens bud, bedste foerst.
   *  1. Udbyderens eget bud — maales, for det kan vaere et klip paa sekunder.
   *  2. YouTubes Data API, hvis der er en noegle.
   *  3. YouTubes egen soegning, uden noegle.
   *
   * Svarer falsk naar der ikke er flere kilder.
   */
  async function refill(): Promise<boolean> {
    const step = stage.current;
    stage.current += 1;
    const name = year === null ? title : `${title} (${year})`;
    switch (step) {
      case 0: {
        const tmdbKey = await getTmdbApiKey(session.db);
        if (tmdbKey === null) return true;
        for (const found of await findTmdbTrailers(tmdbFetch, tmdbKey, kind, name)) {
          queue.current.push({ id: found.youtubeId, note: `Trailer fra TMDB: ${found.name}.`, checkLength: false });
        }
        return true;
      }
      case 1:
        if (trailerId !== null) queue.current.push({ id: trailerId, note: 'Udbyderens trailer.', checkLength: true });
        return true;
      case 2: {
        const apiKey = await getYoutubeApiKey(session.db);
        if (apiKey === null) return true;
        const found = await findLongerTrailer(session.fetchImpl, apiKey, title, year, null);
        if (found !== null) queue.current.push({ id: found.id, note: `Fundet på YouTube: ${found.title}.`, checkLength: false });
        return true;
      }
      case 3:
        for (const found of await searchYoutubeTrailers(fetchText, title, year)) {
          queue.current.push({ id: found.id, note: `Fundet på YouTube: ${found.title}.`, checkLength: false });
        }
        return true;
      default:
        return false;
    }
  }

  /**
   * Spiller den naeste kandidat. Kaldes ved start, og igen naar en video ikke
   * kan vises her — spaerret i Danmark ("ikke tilgaengelig i dit land"),
   * ikke maa indlejres, fjernet — eller er for kort til at vaere en trailer.
   */
  async function playNext(): Promise<void> {
    if (!alive.current) return;
    setSource({ kind: 'looking' });
    for (;;) {
      const next = queue.current.shift();
      if (next !== undefined) {
        if (tried.current.has(next.id)) continue;
        tried.current.add(next.id);
        if (!alive.current) return;
        setNote(next.note);
        if (isTV) {
          // Tv (v354): YouTube-appen spiller den i fuld kvalitet. Laengden
          // kan ikke maales dér; TMDB's bud (foerst i koeen) er rigtige trailere.
          setLoading(true);
          const opened = await openInYoutubeApp(next.id, () => {
            if (alive.current) onBackRef.current();
          });
          if (!alive.current) return;
          logEvent('trailer', opened ? 'aabnet i YouTube-appen' : 'YouTube-appen kunne ikke aabnes: indlejret afspiller');
          if (opened) {
            setLoading(false);
            setSource({ kind: 'external', id: next.id });
            return;
          }
        }
        setLoading(true);
        setSource({ kind: 'measured', id: next.id, checkLength: next.checkLength });
        return;
      }
      let more: boolean;
      try {
        more = await refill();
      } catch {
        more = true;
      }
      if (!more) break;
    }
    if (!alive.current) return;
    setNote('Ingen trailer til titlen kan vises her.');
    // Paa tv er YouTubes soegeside inde i appen ikke til at bruge med en
    // fjernbetjening; der siges i stedet at intet kunne vises.
    if (isTV) {
      setLoading(false);
      setSource({ kind: 'none' });
      return;
    }
    setLoading(true);
    setSource({ kind: 'search', url: youtubeSearchUrl(title, year) });
  }

  /**
   * Trailerkilderne i brugerens raekkefoelge (v336): Apple TV (HLS i fuld HD),
   * saa IMDb (MP4 i 1080p), saa YouTube-vejen (`playNext`). Apple og IMDb
   * spilles i appens egen afspiller hele vejen. `skip`: kilder der allerede
   * er proevet (en der fejlede under afspilning springes over naeste gang).
   */
  async function start(skip: ReadonlySet<'apple' | 'imdb'> = new Set()): Promise<void> {
    if (NATIVE_TRAILERS) {
      try {
        const tmdbKey = await getTmdbApiKey(session.db);
        const name = year === null ? title : `${title} (${year})`;
        const info = tmdbKey === null ? null : await findTitleInfo(tmdbFetch, tmdbKey, kind, name);
        if (!alive.current) return;

        if (!skip.has('apple')) {
          const titles = [info?.englishTitle, info?.originalTitle, title].filter((t): t is string => typeof t === 'string');
          const apple = (await findAppleTrailers(getJson, kind, titles, info?.year ?? year))[0];
          const master = apple === undefined ? null : await getText(apple.url);
          const built = master === null || apple === undefined ? null : buildHlsMaster(master, apple.url);
          const uri = built === null || apple === undefined ? null : writeManifest(`apple-${apple.id.replace(/[^A-Za-z0-9]/g, '')}`, 0, built.playlist, 'm3u8');
          if (!alive.current) return;
          if (apple !== undefined && uri !== null) {
            setNote(`Trailer fra Apple TV: ${apple.name}.`);
            setLoading(true);
            setSource({
              kind: 'native',
              id: apple.id,
              uri,
              resumeAt: 0,
              attempt: 0,
              failures: 0,
              seconds: apple.seconds,
              contentType: 'hls',
              apple: true,
            });
            return;
          }
        }

        const titleId = skip.has('imdb') ? null : info?.imdbId ?? null;
        const found = titleId === null ? [] : await findImdbTrailers(postJson, titleId);
        const best = found[0];
        if (best !== undefined && titleId !== null && alive.current) {
          setNote(`Trailer fra IMDb: ${best.name}.`);
          setLoading(true);
          setSource({
            kind: 'native',
            id: best.videoId,
            uri: best.url,
            resumeAt: 0,
            attempt: 0,
            failures: 0,
            seconds: best.seconds,
            contentType: 'progressive',
            imdb: { titleId },
          });
          return;
        }
      } catch {
        // Apple og IMDb er tilvalg; YouTube-vejen tager over.
      }
    }
    await playNext();
  }

  /** IMDb-traileren stoppede: frisk adresse (de er tidsbegraensede) og fortsaet; ellers YouTube. */
  async function recoverImdb(from: Extract<Source, { kind: 'native' }>, position: number): Promise<void> {
    if (!alive.current || from.imdb === undefined) return;
    setLoading(true);
    const progressed = position >= from.resumeAt + NATIVE_PROGRESS_S;
    const failures = progressed ? 0 : from.failures + 1;
    if (failures < NATIVE_MAX_RECOVERIES) {
      const again = (await findImdbTrailers(postJson, from.imdb.titleId)).find((t) => t.videoId === from.id);
      if (!alive.current) return;
      if (again !== undefined) {
        setSource({ ...from, uri: again.url, resumeAt: position, attempt: from.attempt + 1, failures });
        return;
      }
    }
    await playNext();
  }

  useEffect(() => {
    alive.current = true;
    void start();
    return () => {
      alive.current = false;
    };
    // Kun ved foerste visning; titlen aendrer sig ikke mens skaermen er aaben.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onMessage(event: WebViewMessageEvent): void {
    let message: { type?: string; seconds?: number; code?: unknown };
    try {
      message = JSON.parse(event.nativeEvent.data) as typeof message;
    } catch {
      return;
    }
    if (source.kind !== 'measured') return;
    if (message.type === 'playing') {
      setLoading(false);
      return;
    }
    if (message.type === 'duration' && typeof message.seconds === 'number' && message.seconds > 0) {
      if (source.checkLength && message.seconds < MIN_TRAILER_SECONDS) void playNext();
    } else if (message.type === 'noapi') {
      // Afspiller-API'et kom ikke op. Den rene indlejring virker uden det
      // (men kan saa ikke melde fejl).
      setLoading(true);
      setSource({ kind: 'plain', id: source.id });
    } else if (message.type === 'error') {
      // Spaerret i Danmark, maa ikke indlejres, fjernet: proev den naeste.
      void playNext();
    }
  }

  const webSource =
    source.kind === 'measured'
      ? { html: measuredEmbedPage(source.id, isTV, source.startAt ?? 0), baseUrl: EMBED_ORIGIN }
      : source.kind === 'plain'
        ? { html: embedPage(source.id, isTV), baseUrl: EMBED_ORIGIN }
        : source.kind === 'search'
          ? { uri: source.url }
          : null;
  const openUrl =
    source.kind === 'native' && source.apple === true
      ? `https://tv.apple.com/search?term=${encodeURIComponent(title)}`
      : source.kind === 'native' && source.imdb !== undefined
      ? `https://www.imdb.com/video/${source.id}/`
      : source.kind === 'measured' || source.kind === 'plain' || source.kind === 'native' || source.kind === 'external'
        ? `https://www.youtube.com/watch?v=${source.id}`
        : youtubeSearchUrl(title, year);

  return (
    <View style={styles.container}>
      <View style={[styles.frame, source.kind === 'search' && styles.frameTall, isTV && styles.frameFull]}>
        {WebView === null && (
          <View style={styles.overlay}>
            <Text style={styles.errorText}>Trailere fra YouTube kan ikke vises på Apple TV. Se den på telefonen.</Text>
          </View>
        )}
        {WebView !== null && !failed && webSource !== null && (
          <WebView
            key={
              source.kind === 'search'
                ? source.url
                : source.kind === 'looking' || source.kind === 'none'
                  ? source.kind
                  : `${source.kind}:${source.id}`
            }
            source={webSource}
            originWhitelist={['*']}
            style={styles.web}
            // Tving webvisningen op i et hardware-lag (GPU). Uden det
            // software-tegner nogle Android TV-bokse den store videoflade, og
            // saa hakker traileren ("slowmotion"), mens den native filmafspiller
            // koerer glat. Kun Android; ignoreres andre steder.
            androidLayerType="hardware"
            userAgent={isTV ? DESKTOP_USER_AGENT : BROWSER_USER_AGENT}
            // Sidens 1920 punkter (se viewport) skaleres ned til skaermen.
            scalesPageToFit
            thirdPartyCookiesEnabled
            sharedCookiesEnabled
            allowsFullscreenVideo
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled
            onMessage={onMessage}
            // Den maalte afspiller skjuler selv hjulet, naar forspringet er hentet
            // (beskeden `playing`); de andre naar siden er indlaest.
            onLoadEnd={() => {
              if (source.kind !== 'measured') setLoading(false);
            }}
            onError={() => {
              setFailed(true);
              setLoading(false);
            }}
          />
        )}
        {source.kind === 'native' && (
          <NativeTrailer
            key={`${source.id}:${source.attempt}`}
            uri={source.uri}
            resumeAt={source.resumeAt}
            expectedSeconds={source.seconds}
            contentType={source.contentType}
            onReady={() => setLoading(false)}
            onBroken={(position) => {
              if (source.apple === true) void start(new Set(['apple']));
              else if (source.imdb !== undefined) void recoverImdb(source, position);
              else void playNext();
            }}
            // Paa tv lukker traileren naar den er slut, som i Googles butik.
            onEnd={isTV ? onBack : undefined}
          />
        )}
        {source.kind === 'external' && (
          <View style={styles.overlay}>
            <Text style={styles.errorText}>Traileren spiller i YouTube-appen.</Text>
            <Text style={styles.overlayText}>Tryk Tilbage dér, når du har set den.</Text>
          </View>
        )}
        {source.kind === 'none' && (
          <View style={styles.overlay}>
            <Text style={styles.errorText}>Ingen trailer fundet til «{title}». Prøv "Åbn i YouTube" nedenfor.</Text>
          </View>
        )}
        {(loading || source.kind === 'looking') && !failed && (
          <View style={styles.overlay}>
            <ActivityIndicator color={colors.accent} />
            {source.kind === 'looking' && <Text style={styles.overlayText}>Leder efter en trailer …</Text>}
          </View>
        )}
        {failed && (
          <View style={styles.overlay}>
            <Text style={styles.errorText}>Traileren kunne ikke hentes fra YouTube.</Text>
          </View>
        )}
      </View>
      {/* Paa tv fylder traileren hele skaermen; titel og knap vises kun hvis
          den ikke kan spilles her. Tilbage paa fjernbetjeningen lukker den. */}
      {(!isTV || failed || source.kind === 'none') && (
      <>
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.hint}>{note ?? 'Trailer fra YouTube'}</Text>
      </View>
      <View style={[styles.actions, { paddingBottom: theme.spacing.md + insets.bottom }]}>
        {!isTV && (
          <TvPressable style={styles.button} onPress={onBack}>
            <Text style={styles.buttonText}>Tilbage</Text>
          </TvPressable>
        )}
        {/* Altid, ikke kun ved fejl: nogle trailere maa ifoelge deres ejer
            ikke vises uden for YouTube, og saa er det her den eneste vej. */}
        <TvPressable
          style={styles.button}
          onPress={() => {
            void Linking.openURL(openUrl).catch(() => undefined);
          }}
        >
          <Text style={styles.buttonText}>Åbn i YouTube</Text>
        </TvPressable>
      </View>
      </>
      )}
    </View>
  );
}

/**
 * Traileren i appens egen afspiller (ExoPlayer), fra DASH- eller HLS-manifestet.
 *
 * Buffer: den starter foerst naar fire sekunder er hentet (brugeren: "buffer
 * lidt foerst, saa det ikke hakker"), og holder et halvt minut klar foran.
 * Hjulet vises indtil afspilleren melder klar.
 *
 * Holder vagt, fordi traileren stoppede foer tid (v329): en fejl, en
 * afspilning der staar og henter i NATIVE_STALL_MS, eller en slutning mere
 * end et par sekunder foer videoens laengde meldes som `onBroken` med
 * positionen, og skaermen fortsaetter derfra med friske adresser.
 */
function NativeTrailer({
  uri,
  resumeAt,
  expectedSeconds,
  contentType,
  onReady,
  onBroken,
  onEnd,
}: {
  uri: string;
  /** Sekunder inde, hvor der fortsaettes efter en genopretning. */
  resumeAt: number;
  /** Kildens laengde, hvis afspilleren ikke selv kender den. */
  expectedSeconds: number | null;
  contentType: 'dash' | 'hls' | 'progressive';
  onReady: () => void;
  /** `reason`: kort kategori (fx "fejl 403", "stod stille"). */
  onBroken: (position: number, reason: string) => void;
  onEnd?: () => void;
}) {
  const source = useMemo(() => ({ uri, contentType }), [uri, contentType]);
  const player = useVideoPlayer(source, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 0.5;
    p.bufferOptions = {
      preferredForwardBufferDuration: 30,
      minBufferForPlayback: 4,
      prioritizeTimeOverSizeThreshold: true,
    };
    p.play();
  });
  const handlers = useRef({ onReady, onBroken, onEnd });
  handlers.current = { onReady, onBroken, onEnd };

  useEffect(() => {
    let ready = false;
    let done = false;
    /** Holdt her og ikke laest af afspilleren: den kan vaere frigivet naar vi skal bruge tallet. */
    let position = resumeAt;
    let duration = expectedSeconds ?? 0;
    let stall: ReturnType<typeof setTimeout> | null = null;
    const clearStall = (): void => {
      if (stall !== null) clearTimeout(stall);
      stall = null;
    };
    const broken = (reason: string): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearStall();
      handlers.current.onBroken(position, reason);
    };
    const timer = setTimeout(() => {
      if (!ready) broken('ikke klar');
    }, NATIVE_READY_TIMEOUT_MS);
    const status = player.addListener('statusChange', ({ status: next, error }) => {
      if (next === 'readyToPlay') {
        clearStall();
        if (!ready) {
          ready = true;
          clearTimeout(timer);
          try {
            if (player.duration > 0) duration = player.duration;
            if (resumeAt > 0) player.currentTime = resumeAt;
          } catch {
            // Frigivet i mellemtiden; vagten tager resten.
          }
          handlers.current.onReady();
        }
      } else if (next === 'loading' && ready) {
        clearStall();
        stall = setTimeout(() => broken('stod stille'), NATIVE_STALL_MS);
      } else if (next === 'error') {
        // Kun HTTP-koden; fejlteksten kan rumme adressen.
        const code = /\b([45]\d\d)\b/.exec(error?.message ?? '')?.[1];
        broken(code === undefined ? 'fejl' : `fejl ${code}`);
      }
    });
    const time = player.addListener('timeUpdate', ({ currentTime }) => {
      if (Number.isFinite(currentTime) && currentTime > 0) position = currentTime;
    });
    const end = player.addListener('playToEnd', () => {
      if (done) return;
      // Sluttede den mere end et par sekunder foer tid, er det ikke slutningen.
      if (duration > 0 && position < duration - 3) {
        broken(`sluttede ved ${clock(position)} af ${clock(duration)}`);
        return;
      }
      done = true;
      handlers.current.onEnd?.();
    });
    return () => {
      done = true;
      clearTimeout(timer);
      clearStall();
      status.remove();
      time.remove();
      end.remove();
    };
    // resumeAt er fast for denne afspiller (ny noegle ved hver genopretning).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  return (
    <VideoView
      style={StyleSheet.absoluteFill}
      player={player}
      nativeControls={!isTV}
      contentFit="contain"
      surfaceType={surfaceTypeForPlatform()}
    />
  );
}

/**
 * Siden afspilleren sidder paa. Kun id'et bygges ind, og det er et
 * YouTube-id paa elleve tegn — aldrig fri tekst — saa der kan ikke lukkes
 * noget ind i siden gennem det.
 */
export function embedPage(trailerId: string, wide = false): string {
  const id = safeId(trailerId);
  return `<!doctype html><html><head><meta name="viewport" content="${viewport(wide)}">
<style>html,body{margin:0;background:#000;height:100%;overflow:hidden}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style>
</head><body><iframe src="https://www.youtube.com/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1&vq=hd1080"
allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>`;
}

/**
 * Samme afspiller, men styret gennem YouTubes IFrame-API, som kan oplyse
 * varigheden og fortaelle naar en video ikke kan spilles. Siden sender tre
 * slags beskeder til appen: `duration` naar den kendes, `error` med YouTubes
 * egen kode, og `noapi` hvis API'et ikke er kommet op efter tolv sekunder —
 * saa appen kan falde tilbage paa den rene indlejring.
 *
 * `standby` (v333): siden goeres klar usynligt mens den native afspiller
 * spiller — starter lydloest ved `startAt`, pauser, henter et forspring og
 * melder `standby-ready`. Appen kalder saa `window.__go()`, naar den native
 * afspiller naar dertil: spol til `startAt`, lyd paa, spil.
 *
 * Varigheden er nul indtil videoen har hentet sine metadata; derfor
 * spoerges der baade naar afspilleren er klar og igen naar den begynder at
 * spille, og kun et tal over nul sendes.
 */
export function measuredEmbedPage(trailerId: string, wide = false, startAt = 0, standby = false): string {
  const id = safeId(trailerId);
  const start = Number.isFinite(startAt) && startAt > 0 ? Math.floor(startAt) : 0;
  return `<!doctype html><html><head><meta name="viewport" content="${viewport(wide)}">
<style>html,body{margin:0;background:#000;height:100%;overflow:hidden}#p{position:absolute;inset:0;width:100%;height:100%;border:0}</style>
</head><body><div id="p"></div>
<script>
var sent=false,primed=false,started=false,t0=0,P=null,primedAt=0,readySent=false,STANDBY=${standby ? 'true' : 'false'},START=${start},BUFFER_S=${BUFFER_SECONDS},MAX_WAIT=${MAX_BUFFER_WAIT_MS};
window.__go=function(){if(P){begin(P);}};
function post(m){if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify(m));}}
function report(player){if(sent)return;var d=player.getDuration();if(d>0){sent=true;post({type:'duration',seconds:d});}}
function begin(p){if(started)return;started=true;try{p.seekTo(START,true);}catch(x){}try{p.unMute();}catch(x){}p.playVideo();post({type:'playing'});}
function onYouTubeIframeAPIReady(){
  new YT.Player('p',{videoId:'${id}',playerVars:{autoplay:1,mute:1,playsinline:1,rel:0,modestbranding:1,vq:'hd1080',start:START},
    events:{
      onReady:function(e){var p=e.target;P=p;try{p.setPlaybackQuality('hd1080');}catch(x){}try{p.mute();}catch(x){}t0=Date.now();p.playVideo();report(p);
        var iv=setInterval(function(){
          if(started){clearInterval(iv);return;}
          if(STANDBY){if(primed&&!readySent&&Date.now()-primedAt>=3000){readySent=true;clearInterval(iv);post({type:'standby-ready'});}return;}
          var d=0,f=0;try{d=p.getDuration()||0;f=p.getVideoLoadedFraction()||0;}catch(x){}
          var enough=d>0&&d*f>=Math.min(BUFFER_S,d*0.9);
          if((primed&&enough)||Date.now()-t0>MAX_WAIT){clearInterval(iv);begin(p);}
        },250);},
      onStateChange:function(e){report(e.target);if(!primed&&e.data===1){primed=true;primedAt=Date.now();if(!started){e.target.pauseVideo();}}},
      onError:function(e){post({type:'error',code:e.data});}
    }});
}
setTimeout(function(){if(!window.YT||!window.YT.Player){post({type:'noapi'});}},12000);
</script>
<script src="https://www.youtube.com/iframe_api"></script>
</body></html>`;
}

/**
 * Forspring foer traileren starter, saa den ikke hakker: den startes lydloest,
 * pauses saa snart den spiller, og YouTube henter videre imens. Naar der er
 * BUFFER_SECONDS hentet (eller efter MAX_BUFFER_WAIT_MS, saa den aldrig
 * haenger), spoles til start og spilles med lyd. Appen viser hjulet imens
 * (beskeden `playing` skjuler det).
 */
const BUFFER_SECONDS = 15;
const MAX_BUFFER_WAIT_MS = 6000;

/**
 * Sidens bredde. Paa tv (`wide`) lader siden som om den er 1920 punkter bred
 * (fuld HD), og webvisningen skalerer den ned til skaermen. YouTubes afspiller
 * vaelger kvalitet efter afspillerens stoerrelse i web-punkter: med tv'ets egne
 * ~930 punkter valgte den 480p, selv i fuld skaerm ("ikke HD, meget mindre end
 * normalt"). Med 1920 er afspilleren 1920 x 1080, og saa vaelges 1080p.
 */
function viewport(wide: boolean): string {
  return wide ? 'width=1920' : 'width=device-width, initial-scale=1';
}

function safeId(trailerId: string): string {
  return trailerId.replace(/[^A-Za-z0-9_-]/g, '');
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  frame: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000000' },
  /** Soegesiden er en hel side, ikke en video; den faar det meste af skaermen. */
  frameTall: { aspectRatio: undefined, flex: 3 },
  /** Tv: traileren fylder hele skaermen, som i Googles butik. Tilbage lukker den. */
  frameFull: { aspectRatio: undefined, flex: 1 },
  web: { flex: 1, backgroundColor: '#000000' },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.md,
  },
  overlayText: { color: colors.textMuted, marginTop: theme.spacing.sm },
  /** YouTubes afspiller mens den goeres klar: usynlig, over den native video. */
  hidden: { opacity: 0 },
  /** Linjen ved et skift: lille, nederst til venstre. */
  note: {
    position: 'absolute',
    left: theme.spacing.sm,
    bottom: theme.spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  noteText: { color: '#FFFFFF', fontSize: 12 },
  errorText: { color: colors.text, textAlign: 'center' },
  info: { flex: 1, padding: theme.spacing.md, backgroundColor: colors.background },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  hint: { color: colors.textMuted, fontSize: 13, marginTop: 4, lineHeight: 18 },
  actions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    backgroundColor: colors.background,
  },
  button: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: theme.radius,
    paddingVertical: theme.spacing.sm + 2,
    paddingHorizontal: theme.spacing.md,
  },
  buttonText: { color: colors.text, fontSize: 14, fontWeight: '600' },
});
