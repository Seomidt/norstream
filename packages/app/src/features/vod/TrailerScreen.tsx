import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { File, Paths } from 'expo-file-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WebViewMessageEvent } from 'react-native-webview';
import type { AppSession } from '../../session.js';
import { getTmdbApiKey, getYoutubeApiKey } from '../../storage/settings.js';
import { findTmdbTrailers, tmdbFetch } from '../../sync/tmdb.js';
import { theme } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { isTV } from '../../ui/tv.js';
import { MIN_TRAILER_SECONDS, findLongerTrailer, searchYoutubeTrailers, youtubeSearchUrl } from './trailerSearch.js';
import type { FetchText } from './trailerSearch.js';
import { webView } from './webview.js';
import { resolveYoutubeStream } from './youtubeStream.js';
import type { PostJson } from './youtubeStream.js';
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
  /** Videofilen i appens egen afspiller, som Googles butik (se youtubeStream.ts). */
  | { kind: 'native'; id: string; uri: string; resumeAt: number; attempt: number }
  /** `startAt`: sekunder inde, naar den overtager fra den native afspiller. */
  | { kind: 'measured'; id: string; checkLength: boolean; startAt?: number }
  | { kind: 'plain'; id: string }
  | { kind: 'search'; url: string }
  | { kind: 'looking' }
  /** Tv: intet fundet, og ingen soegeside at vise. */
  | { kind: 'none' };

/**
 * Traileren, inde i appen.
 *
 * Paa Android foerst som rigtig video i appens egen afspiller (som Googles
 * tv-butik): videofilen hentes fra YouTube, se youtubeStream.ts. Det er
 * uofficielt og kan holde op med at virke naar YouTube aendrer noget; saa
 * spilles traileren i YouTubes egen indlejrede afspiller i en webvisning,
 * som beskrevet her.
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
/** Saa mange gange hentes nye adresser og fortsaettes, foer webvisningen tager over. */
const NATIVE_MAX_RECOVERIES = 3;

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

/**
 * Manifestet skal ligge i en fil: afspilleren tager en adresse. Én fil per
 * video, skrevet forfra hver gang (YouTubes adresser udloeber efter timer).
 */
function writeManifest(videoId: string, attempt: number, mpd: string): string | null {
  try {
    const file = new File(Paths.cache, `trailer-${videoId}-${attempt}.mpd`);
    if (file.exists) file.delete();
    file.create();
    file.write(mpd);
    return file.uri;
  } catch {
    return null;
  }
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
        if (NATIVE_TRAILERS) {
          const stream = await resolveYoutubeStream(postJson, next.id);
          if (!alive.current) return;
          // Spaerret i Danmark, fjernet: webvisningen ville fejle ligesaa.
          if (stream.kind === 'unavailable') continue;
          if (stream.kind === 'dash') {
            if (next.checkLength && stream.seconds !== null && stream.seconds < MIN_TRAILER_SECONDS) continue;
            const uri = writeManifest(next.id, 0, stream.mpd);
            if (uri !== null) {
              setLoading(true);
              setSource({ kind: 'native', id: next.id, uri, resumeAt: 0, attempt: 0 });
              return;
            }
          }
          // fallback: bot-tjek, netfejl, intet brugbart format — webvisningen.
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
   * Den native afspilning stoppede foer traileren var slut (fejl, gik i
   * staa, eller sluttede for tidligt). Brugeren: "det stopper inden
   * traileren er faerdig hver gang". Hent friske adresser hos YouTube og
   * fortsaet fra samme sted; efter nogle forsoeg tager webvisningen over.
   */
  async function recoverNative(id: string, position: number, attempt: number): Promise<void> {
    if (!alive.current) return;
    setLoading(true);
    if (attempt < NATIVE_MAX_RECOVERIES) {
      const stream = await resolveYoutubeStream(postJson, id);
      if (!alive.current) return;
      if (stream.kind === 'dash') {
        const uri = writeManifest(id, attempt + 1, stream.mpd);
        if (uri !== null) {
          setSource({ kind: 'native', id, uri, resumeAt: position, attempt: attempt + 1 });
          return;
        }
      }
    }
    setSource({ kind: 'measured', id, checkLength: false, startAt: position });
  }

  useEffect(() => {
    alive.current = true;
    void playNext();
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
    source.kind === 'measured' || source.kind === 'plain' || source.kind === 'native'
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
            onReady={() => setLoading(false)}
            onBroken={(position) => {
              void recoverNative(source.id, position, source.attempt);
            }}
            // Paa tv lukker traileren naar den er slut, som i Googles butik.
            onEnd={isTV ? onBack : undefined}
          />
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
 * Traileren i appens egen afspiller (ExoPlayer), fra DASH-manifestet.
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
  onReady,
  onBroken,
  onEnd,
}: {
  uri: string;
  /** Sekunder inde, hvor der fortsaettes efter en genopretning. */
  resumeAt: number;
  onReady: () => void;
  onBroken: (position: number) => void;
  onEnd?: () => void;
}) {
  const source = useMemo(() => ({ uri, contentType: 'dash' as const }), [uri]);
  const player = useVideoPlayer(source, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 1;
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
    let duration = 0;
    let stall: ReturnType<typeof setTimeout> | null = null;
    const clearStall = (): void => {
      if (stall !== null) clearTimeout(stall);
      stall = null;
    };
    const broken = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearStall();
      handlers.current.onBroken(position);
    };
    const timer = setTimeout(() => {
      if (!ready) broken();
    }, NATIVE_READY_TIMEOUT_MS);
    const status = player.addListener('statusChange', ({ status: next }) => {
      if (next === 'readyToPlay') {
        clearStall();
        if (!ready) {
          ready = true;
          clearTimeout(timer);
          try {
            duration = player.duration;
            if (resumeAt > 0) player.currentTime = resumeAt;
          } catch {
            // Frigivet i mellemtiden; vagten tager resten.
          }
          handlers.current.onReady();
        }
      } else if (next === 'loading' && ready) {
        clearStall();
        stall = setTimeout(broken, NATIVE_STALL_MS);
      } else if (next === 'error') {
        broken();
      }
    });
    const time = player.addListener('timeUpdate', ({ currentTime }) => {
      if (Number.isFinite(currentTime) && currentTime > 0) position = currentTime;
    });
    const end = player.addListener('playToEnd', () => {
      if (done) return;
      // Sluttede den mere end et par sekunder foer tid, er det ikke slutningen.
      if (duration > 0 && position < duration - 3) {
        broken();
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
 * Varigheden er nul indtil videoen har hentet sine metadata; derfor
 * spoerges der baade naar afspilleren er klar og igen naar den begynder at
 * spille, og kun et tal over nul sendes.
 */
export function measuredEmbedPage(trailerId: string, wide = false, startAt = 0): string {
  const id = safeId(trailerId);
  const start = Number.isFinite(startAt) && startAt > 0 ? Math.floor(startAt) : 0;
  return `<!doctype html><html><head><meta name="viewport" content="${viewport(wide)}">
<style>html,body{margin:0;background:#000;height:100%;overflow:hidden}#p{position:absolute;inset:0;width:100%;height:100%;border:0}</style>
</head><body><div id="p"></div>
<script>
var sent=false,primed=false,started=false,t0=0,START=${start},BUFFER_S=${BUFFER_SECONDS},MAX_WAIT=${MAX_BUFFER_WAIT_MS};
function post(m){if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify(m));}}
function report(player){if(sent)return;var d=player.getDuration();if(d>0){sent=true;post({type:'duration',seconds:d});}}
function begin(p){if(started)return;started=true;try{p.seekTo(START,true);}catch(x){}try{p.unMute();}catch(x){}p.playVideo();post({type:'playing'});}
function onYouTubeIframeAPIReady(){
  new YT.Player('p',{videoId:'${id}',playerVars:{autoplay:1,mute:1,playsinline:1,rel:0,modestbranding:1,vq:'hd1080'},
    events:{
      onReady:function(e){var p=e.target;try{p.setPlaybackQuality('hd1080');}catch(x){}try{p.mute();}catch(x){}t0=Date.now();p.playVideo();report(p);
        var iv=setInterval(function(){
          if(started){clearInterval(iv);return;}
          var d=0,f=0;try{d=p.getDuration()||0;f=p.getVideoLoadedFraction()||0;}catch(x){}
          var enough=d>0&&d*f>=Math.min(BUFFER_S,d*0.9);
          if((primed&&enough)||Date.now()-t0>MAX_WAIT){clearInterval(iv);begin(p);}
        },250);},
      onStateChange:function(e){report(e.target);if(!primed&&e.data===1){primed=true;if(!started){e.target.pauseVideo();}}},
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
