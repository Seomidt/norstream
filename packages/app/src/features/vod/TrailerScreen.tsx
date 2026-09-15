import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WebViewMessageEvent } from 'react-native-webview';
import type { AppSession } from '../../session.js';
import { getTmdbApiKey, getYoutubeApiKey } from '../../storage/settings.js';
import { findTmdbTrailer, tmdbFetch } from '../../sync/tmdb.js';
import { theme } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { isTV } from '../../ui/tv.js';
import { MIN_TRAILER_SECONDS, findLongerTrailer, youtubeSearchUrl } from './trailerSearch.js';
import { webView } from './webview.js';
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
  | { kind: 'measured'; id: string }
  | { kind: 'plain'; id: string }
  | { kind: 'search'; url: string }
  | { kind: 'looking' }
  /** Tv: intet fundet, og ingen soegeside at vise. */
  | { kind: 'none' };

/**
 * Traileren, inde i appen.
 *
 * YouTubes egen indlejrede afspiller i en webvisning. Det er den maade
 * YouTube selv stiller til raadighed — at traekke videofilen ud og spille den
 * i appens afspiller goer de ikke, og det ville braekke naar de aendrer noget.
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
const EMBED_ORIGIN = 'https://norstream.app';

export function TrailerScreen({ session, trailerId, title, year, kind, onBack }: Props) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Der begyndes altid med at lede: TMDB er foerste valg naar noeglen er der.
  const [source, setSource] = useState<Source>({ kind: 'looking' });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** Der soeges hoejst én gang; ellers kunne en fundet video sende os i ring. */
  const searched = useRef(false);

  /** TMDB er spurgt én gang; den svarer ikke anderledes anden gang. */
  const tmdbTried = useRef(false);

  /**
   * Foerste valg: TMDB. Den ved hvad der er en trailer og hvad der er en
   * teaser, saa der er intet at maale. Kender den ikke titlen, eller er der
   * ingen noegle, spilles udbyderens eget bud og maales som foer.
   */
  async function start(): Promise<void> {
    const tmdbKey = await getTmdbApiKey(session.db);
    if (tmdbKey !== null) {
      tmdbTried.current = true;
      const name = year === null ? title : `${title} (${year})`;
      const found = await findTmdbTrailer(tmdbFetch, tmdbKey, kind, name);
      if (found !== null) {
        setNote(`Trailer fra TMDB: ${found.name}.`);
        setSource({ kind: 'plain', id: found.youtubeId });
        return;
      }
    }
    if (trailerId !== null) {
      setNote(tmdbKey === null ? 'Udbyderens trailer.' : 'TMDB kender ingen trailer til titlen; udbyderens spilles.');
      setSource({ kind: 'measured', id: trailerId });
      return;
    }
    await lookForBetter('Udbyderen har ingen trailer til titlen.');
  }

  async function lookForBetter(reason: string): Promise<void> {
    if (searched.current) return;
    searched.current = true;
    setSource({ kind: 'looking' });
    const tmdbKey = tmdbTried.current ? null : await getTmdbApiKey(session.db);
    if (tmdbKey !== null) {
      tmdbTried.current = true;
      const name = year === null ? title : `${title} (${year})`;
      const found = await findTmdbTrailer(tmdbFetch, tmdbKey, kind, name);
      if (found !== null && found.youtubeId !== trailerId) {
        setNote(`${reason} Traileren er fundet gennem TMDB: ${found.name}.`);
        setLoading(true);
        setSource({ kind: 'plain', id: found.youtubeId });
        return;
      }
    }
    const apiKey = await getYoutubeApiKey(session.db);
    if (apiKey !== null) {
      const found = await findLongerTrailer(session.fetchImpl, apiKey, title, year, trailerId);
      if (found !== null) {
        setNote(`${reason} Fundet på YouTube: ${found.title} (${Math.round(found.seconds / 60)} min).`);
        setLoading(true);
        setSource({ kind: 'plain', id: found.id });
        return;
      }
      setNote(`${reason} Søgningen fandt ingen lang nok, så her er YouTubes egen søgning.`);
    } else {
      setNote(
        `${reason} ${tmdbTried.current ? 'TMDB kender ingen trailer til titlen, så' : 'Uden en TMDB-nøgle under Indstillinger'} vælger du selv her.`,
      );
    }
    // Paa tv er YouTubes soegeside inde i appen ikke til at bruge med en
    // fjernbetjening: den saa ud som "en masse forslag, som om man ikke
    // har noget". Der siges i stedet hvad der er proevet, og knappen
    // Aabn i YouTube aabner soegningen i YouTube-appen.
    if (isTV) {
      setLoading(false);
      setSource({ kind: 'none' });
      return;
    }
    setLoading(true);
    setSource({ kind: 'search', url: youtubeSearchUrl(title, year) });
  }

  useEffect(() => {
    void start();
    // Kun ved foerste visning; id'et aendrer sig ikke mens skaermen er aaben.
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
    if (message.type === 'duration' && typeof message.seconds === 'number' && message.seconds > 0) {
      if (message.seconds < MIN_TRAILER_SECONDS) {
        void lookForBetter(`Udbyderens trailer var kun ${Math.round(message.seconds)} sekunder.`);
      }
    } else if (message.type === 'noapi') {
      // Afspiller-API'et kom ikke op. Den rene indlejring virker uden det.
      setLoading(true);
      setSource({ kind: 'plain', id: source.id });
    } else if (message.type === 'error') {
      void lookForBetter('Udbyderens trailer kan ikke vises her.');
    }
  }

  const webSource =
    source.kind === 'measured'
      ? { html: measuredEmbedPage(source.id), baseUrl: EMBED_ORIGIN }
      : source.kind === 'plain'
        ? { html: embedPage(source.id), baseUrl: EMBED_ORIGIN }
        : source.kind === 'search'
          ? { uri: source.url }
          : null;
  const openUrl =
    source.kind === 'measured' || source.kind === 'plain'
      ? `https://www.youtube.com/watch?v=${source.id}`
      : youtubeSearchUrl(title, year);

  return (
    <View style={styles.container}>
      <View style={[styles.frame, source.kind === 'search' && styles.frameTall]}>
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
            allowsFullscreenVideo
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled
            onMessage={onMessage}
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setFailed(true);
              setLoading(false);
            }}
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
    </View>
  );
}

/**
 * Siden afspilleren sidder paa. Kun id'et bygges ind, og det er et
 * YouTube-id paa elleve tegn — aldrig fri tekst — saa der kan ikke lukkes
 * noget ind i siden gennem det.
 */
export function embedPage(trailerId: string): string {
  const id = safeId(trailerId);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;background:#000;height:100%;overflow:hidden}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style>
</head><body><iframe src="https://www.youtube.com/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1"
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
export function measuredEmbedPage(trailerId: string): string {
  const id = safeId(trailerId);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;background:#000;height:100%;overflow:hidden}#p{position:absolute;inset:0;width:100%;height:100%;border:0}</style>
</head><body><div id="p"></div>
<script>
var sent=false;
function post(m){if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify(m));}}
function report(player){if(sent)return;var d=player.getDuration();if(d>0){sent=true;post({type:'duration',seconds:d});}}
function onYouTubeIframeAPIReady(){
  new YT.Player('p',{videoId:'${id}',playerVars:{autoplay:1,playsinline:1,rel:0,modestbranding:1},
    events:{
      onReady:function(e){e.target.playVideo();report(e.target);},
      onStateChange:function(e){report(e.target);},
      onError:function(e){post({type:'error',code:e.data});}
    }});
}
setTimeout(function(){if(!window.YT||!window.YT.Player){post({type:'noapi'});}},12000);
</script>
<script src="https://www.youtube.com/iframe_api"></script>
</body></html>`;
}

function safeId(trailerId: string): string {
  return trailerId.replace(/[^A-Za-z0-9_-]/g, '');
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  frame: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000000' },
  /** Soegesiden er en hel side, ikke en video; den faar det meste af skaermen. */
  frameTall: { aspectRatio: undefined, flex: 3 },
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
