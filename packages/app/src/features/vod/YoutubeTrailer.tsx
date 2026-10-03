import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, useTVEventHandler } from 'react-native';
import type { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useKeepAwake } from 'expo-keep-awake';
import { useStyles } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { isTV } from '../../ui/tv.js';
import { logEvent } from '../../diagnostics/log.js';
import { webView } from './webview.js';
import { trailerCommandScript, youtubeEmbedPage, youtubeEmbedNavigationAllowed, YoutubePlaybackWatch, YOUTUBE_EMBED_ORIGIN, YOUTUBE_MAX_RELOADS } from './youtubeEmbed.js';
import type { TrailerCommand } from './youtubeEmbed.js';

const EmbeddedWebView = webView();

function KeepAwake() {
  useKeepAwake('norstream-trailer');
  return null;
}

/**
 * Kun denne komponent ejer YouTubes livscyklus. HTML/source forbliver samme
 * objekt ved status-opdateringer, saa WebView ikke genindlaeses undervejs.
 * Et nyt forsoeg afmonterer den gamle afspiller inden den naeste starter.
 */
export function YoutubeTrailer({ id, checkLength, resumeAt = 0, onUnavailable, onEnd }: {
  id: string;
  checkLength: boolean;
  resumeAt?: number;
  onUnavailable: () => void;
  onEnd: () => void;
}) {
  const styles = useStyles(makeStyles);
  const [attempt, setAttempt] = useState({ number: 0, startAt: resumeAt });
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState('Starter trailer …');
  const [initialFocus, setInitialFocus] = useState(isTV);
  const [controlsShown, setControlsShown] = useState(true);
  const [activity, setActivity] = useState(0);
  const [quality, setQuality] = useState('');
  const controlsShownRef = useRef(controlsShown);
  controlsShownRef.current = controlsShown;
  const web = useRef<WebView>(null);
  const handlers = useRef({ onUnavailable, onEnd });
  handlers.current = { onUnavailable, onEnd };
  const watch = useRef(new YoutubePlaybackWatch(Date.now()));
  const handled = useRef(false);
  const lastQuality = useRef('');
  const source = useMemo(() => ({
    html: youtubeEmbedPage(id, isTV, attempt.startAt, attempt.number),
    baseUrl: YOUTUBE_EMBED_ORIGIN,
  }), [id, attempt]);

  function command(value: TrailerCommand): void {
    web.current?.injectJavaScript(trailerCommandScript(value));
  }

  function recover(reason: string): void {
    if (handled.current) return;
    handled.current = true;
    setPlaying(false);
    setQuality('');
    setControlsShown(true);
    const position = watch.current.position;
    logEvent('trailer', `YouTube ${reason} ved ${Math.round(position)} s, forsoeg ${attempt.number + 1}`);
    if (attempt.number < YOUTUBE_MAX_RELOADS) {
      setNotice('Genoptager trailer …');
      setAttempt({ number: attempt.number + 1, startAt: position });
    } else {
      handlers.current.onUnavailable();
    }
  }

  useEffect(() => {
    handled.current = false;
    watch.current = new YoutubePlaybackWatch(Date.now(), attempt.startAt);
    lastQuality.current = '';
    if (EmbeddedWebView === null) {
      handled.current = true;
      handlers.current.onUnavailable();
      return;
    }
    const timer = setInterval(() => {
      const problem = watch.current.problem(Date.now());
      if (problem !== null) recover(problem);
    }, 1000);
    return () => {
      handled.current = true;
      clearInterval(timer);
    };
    // Forsoeg er en ny afspiller; callbacks laeses gennem handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, attempt]);

  useEffect(() => {
    if (!isTV) return;
    setInitialFocus(true);
    const frame = requestAnimationFrame(() => setInitialFocus(false));
    return () => cancelAnimationFrame(frame);
  }, [attempt, controlsShown]);

  useEffect(() => {
    if (!isTV || !playing || !controlsShown) return;
    const timer = setTimeout(() => setControlsShown(false), 5000);
    return () => clearTimeout(timer);
  }, [playing, controlsShown, activity]);

  useTVEventHandler((event) => {
    if (!isTV || event.eventKeyAction === 0) return;
    const type = event.eventType;
    if (!['select', 'up', 'down', 'left', 'right', 'playPause', 'rewind', 'fastForward'].includes(type)) return;
    const hidden = !controlsShownRef.current;
    if (type === 'playPause' || (hidden && type === 'select')) command('toggle');
    if (type === 'rewind' || (hidden && type === 'left')) command('backward');
    if (type === 'fastForward' || (hidden && type === 'right')) command('forward');
    if (hidden && (type === 'left' || type === 'right')) return;
    setControlsShown(true);
    setActivity((value) => value + 1);
  });

  function onMessage(event: WebViewMessageEvent): void {
    if (handled.current) return;
    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(event.nativeEvent.data);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      message = parsed as Record<string, unknown>;
    } catch { return; }
    if (message.attempt !== attempt.number) return;
    if (message.type === 'status') {
      if (typeof message.state !== 'number' || typeof message.position !== 'number' || typeof message.seconds !== 'number') return;
      watch.current.update({ state: message.state, position: message.position, seconds: message.seconds }, Date.now());
      if (checkLength && message.seconds > 0 && message.seconds < 60) {
        handled.current = true;
        logEvent('trailer', `YouTube: klip paa ${message.seconds} s, proever naeste`);
        handlers.current.onUnavailable();
        return;
      }
      setPlaying(message.state === 1);
      setNotice(message.state === 3 ? 'Henter trailer …' : message.state === 2 ? 'Pause' : message.state === 1 ? '' : 'Starter trailer …');
    } else if (message.type === 'ended') {
      if (watch.current.problem(Date.now()) === 'early-end') { recover('early-end'); return; }
      handled.current = true;
      setPlaying(false);
      handlers.current.onEnd();
    } else if (message.type === 'error') {
      logEvent('trailer', `YouTube indlejring: fejl ${Number(message.code) || 0}`);
      // Fjernet/regionsspaerret/ejeren afviser indlejring: genindlaesning hjaelper ikke.
      if ([2, 100, 101, 150].includes(Number(message.code))) {
        handled.current = true;
        handlers.current.onUnavailable();
      } else recover(`fejl ${Number(message.code) || 0}`);
    } else if (message.type === 'noapi') recover('ingen IFrame-API');
    else if (message.type === 'autoplay-blocked') {
      // Brugerens afspil-tryk er noedvendigt; en vagt maa ikke springe videre imens.
      watch.current.update({ state: 2, position: watch.current.position, seconds: watch.current.seconds }, Date.now());
      setControlsShown(true);
      setNotice('Tryk Afspil for at starte');
    } else if (message.type === 'quality' && typeof message.quality === 'string' && message.quality !== lastQuality.current) {
      lastQuality.current = message.quality;
      const labels: Record<string, string> = { hd2160: '2160p', hd1440: '1440p', hd1080: '1080p', hd720: '720p', large: '480p', medium: '360p', small: '240p', tiny: '144p' };
      setQuality(labels[message.quality] ?? 'Automatisk kvalitet');
      logEvent('trailer', `YouTube kvalitet: ${message.quality.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)}`);
    }
  }

  return (
    <View style={styles.root}>
      {playing && <KeepAwake />}
      {EmbeddedWebView !== null && <EmbeddedWebView
        key={`${id}:${attempt.number}`}
        ref={web}
        source={source}
        style={styles.video}
        originWhitelist={['https://*']}
        androidLayerType="hardware"
        applicationNameForUserAgent="NorStream"
        scalesPageToFit
        thirdPartyCookiesEnabled
        sharedCookiesEnabled
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        allowsFullscreenVideo={false}
        setSupportMultipleWindows={false}
        javaScriptEnabled
        domStorageEnabled
        onMessage={onMessage}
        onError={() => recover('webvisning fejlede')}
        onRenderProcessGone={() => recover('webvisning lukket af Android')}
        onContentProcessDidTerminate={() => recover('webvisning lukket')}
        // Ingen intents, top-navigation eller nye vinduer ud af appen.
        onShouldStartLoadWithRequest={(request) => youtubeEmbedNavigationAllowed(request.url)}
      />}
      {isTV && !controlsShown && <View style={styles.focusKeeper} focusable hasTVPreferredFocus />}
      {/* Bjaelken ligger uden for YouTube og klapper sammen under afspilning.
          WebView forbliver monteret; en aendret hoejde maa ikke genstarte filmen. */}
      <View style={[styles.controls, isTV && !controlsShown && styles.controlsHidden]} pointerEvents={isTV && !controlsShown ? "none" : "auto"}>
        <TvPressable hasTVPreferredFocus={initialFocus && controlsShown} focusable={!isTV || controlsShown} style={styles.button} onPress={() => command('toggle')}>
          <Text style={styles.text}>{playing ? 'Pause' : 'Afspil'}</Text>
        </TvPressable>
        {isTV && <>
          <TvPressable focusable={controlsShown} style={styles.button} onPress={() => command('backward')}><Text style={styles.text}>−10 s</Text></TvPressable>
          <TvPressable focusable={controlsShown} style={styles.button} onPress={() => command('forward')}><Text style={styles.text}>+10 s</Text></TvPressable>
        </>}
        <Text style={styles.status} numberOfLines={1}>{notice || (quality ? `YouTube • ${quality}` : 'YouTube • Automatisk kvalitet')}</Text>
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  video: { flex: 1, backgroundColor: '#000000' },
  controls: { height: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, backgroundColor: '#000000' },
  controlsHidden: { height: 0, opacity: 0, overflow: 'hidden' },
  focusKeeper: { position: 'absolute', width: 1, height: 1, bottom: 0, left: 0 },
  button: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 4, backgroundColor: colors.surfaceRaised },
  text: { color: colors.text, fontSize: 14, fontWeight: '600' },
  status: { flex: 1, color: colors.textMuted, fontSize: 13 },
});
