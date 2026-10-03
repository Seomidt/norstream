import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View, useTVEventHandler } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useKeepAwake } from 'expo-keep-awake';
import { File, Paths } from 'expo-file-system';
import type { AppSession } from '../../session.js';
import { getTmdbApiKey, getYoutubeApiKey } from '../../storage/settings.js';
import { cleanVodTitle, findTitleInfo, findTmdbTrailers } from '../../sync/tmdb.js';
import { theme } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { isTV } from '../../ui/tv.js';
import { findLongerTrailer, searchYoutubeTrailers } from './trailerSearch.js';
import { YoutubeProof } from './YoutubeProof.js';
import { YoutubeTrailer } from './YoutubeTrailer.js';
import { buildHlsMaster } from './youtubeStream.js';
import { findAppleTrailers } from './appleTrailer.js';
import { findImdbTrailers } from './imdbTrailer.js';
import { logEvent } from '../../diagnostics/log.js';
import { surfaceTypeForPlatform } from '../player/format.js';
import { TvPressable } from '../../ui/TvPressable.js';

interface Props {
  session: AppSession;
  trailerId: string | null;
  title: string;
  year: number | null;
  kind: 'movie' | 'series';
  onBack: () => void;
}

interface NativeSource {
  kind: 'native';
  id: string;
  uri: string;
  resumeAt: number;
  attempt: number;
  seconds: number | null;
  contentType: 'hls' | 'progressive' | 'dash';
  provider: 'Apple TV' | 'IMDb' | 'YouTube PO';
  imdbTitleId?: string;
}
interface Candidate { id: string; checkLength: boolean }
type Source = NativeSource | ({ kind: 'youtube' | 'proof'; resumeAt?: number } & Candidate) | { kind: 'looking' } | { kind: 'none' };
const NATIVE_READY_TIMEOUT_MS = 20_000;
const NATIVE_STALL_MS = 15_000;
const LOOKUP_TIMEOUT_MS = 8_000;

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Apple/IMDb som native video, paa Google TV derefter YouTube med bevis
 * og hele lokale filer. Officiel indlejring er reserven.
 * Alle kandidater proeves herinde. Ingen automatisk ekstern app, heller
 * ikke naar en video er fjernet eller ikke maa indlejres.
 */
export function TrailerScreen({ session, trailerId, title, year, kind, onBack }: Props) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const [source, setSource] = useState<Source>({ kind: 'looking' });
  const [loading, setLoading] = useState(true);
  const nativeQueue = useRef<NativeSource[]>([]);
  const queue = useRef<Candidate[]>([]);
  const tried = useRef(new Set<string>());
  const stage = useRef(0);
  const aliases = useRef<string[]>([cleanVodTitle(title).title]);
  const resolvedYear = useRef(year ?? cleanVodTitle(title).year);
  const alive = useRef(false);
  const busy = useRef(false);
  const requests = useRef(new Set<AbortController>());
  const manifests = useRef<File[]>([]);
  const tmdbKey = useRef<string | null>(null);

  /** Tidsbegraens alle opslag og afbryd dem naar trailerskaermen lukkes. */
  async function request(url: string, init?: RequestInit): Promise<Response> {
    if (!alive.current) throw new Error('Traileren er lukket');
    const controller = new AbortController();
    requests.current.add(controller);
    const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      // Kroppen laeses inden tidsuret ryddes. Response.text/json efter
      // fetch alene ville lade et svar med haengende krop blokere koeen.
      const body = await response.text();
      return new Response(body, { status: response.status, headers: response.headers });
    } finally {
      clearTimeout(timer);
      requests.current.delete(controller);
    }
  }
  async function getText(url: string, headers?: Record<string, string>): Promise<string | null> {
    try { const r = await request(url, { headers }); return r.ok ? await r.text() : null; }
    catch { return null; }
  }
  async function getJson(url: string): Promise<unknown> {
    try {
      const r = await request(url, { headers: { Accept: 'application/json', Origin: 'https://tv.apple.com' } });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  }
  async function postJson(url: string, headers: Record<string, string>, body: string): Promise<unknown> {
    try { const r = await request(url, { method: 'POST', headers, body }); return r.ok ? await r.json() : null; }
    catch { return null; }
  }
  const metadataFetch = (url: string, headers?: Record<string, string>): Promise<Response> => request(url, { headers });
  function manifest(id: string, text: string): string | null {
    try {
      const file = new File(Paths.cache, `trailer-${id.replace(/[^A-Za-z0-9]/g, '')}-${Date.now()}.m3u8`);
      manifests.current.push(file);
      file.create();
      file.write(text);
      return file.uri;
    } catch { return null; }
  }

  async function refill(): Promise<boolean> {
    const step = stage.current++;
    switch (step) {
      case 0: {
        if (tmdbKey.current === null) return true;
        const name = resolvedYear.current === null ? aliases.current[0] ?? title : `${aliases.current[0] ?? title} (${resolvedYear.current})`;
        const found = await findTmdbTrailers(metadataFetch, tmdbKey.current, kind, name);
        for (const video of found) queue.current.push({ id: video.youtubeId, checkLength: true });
        logEvent('trailer', `TMDB: ${found.length} bud`);
        return true;
      }
      case 1:
        if (trailerId !== null && /^[A-Za-z0-9_-]{11}$/.test(trailerId)) queue.current.push({ id: trailerId, checkLength: true });
        return true;
      case 2: {
        const apiKey = await getYoutubeApiKey(session.db);
        if (apiKey === null) return true;
        for (const alias of aliases.current) {
          if (!alive.current) return false;
          const found = await findLongerTrailer(request, apiKey, alias, resolvedYear.current, null);
          if (found !== null) queue.current.push({ id: found.id, checkLength: false });
        }
        logEvent('trailer', `YouTube Data API: ${queue.current.length} bud`);
        return true;
      }
      case 3: {
        for (const alias of aliases.current) {
          if (!alive.current) return false;
          const found = await searchYoutubeTrailers(getText, alias, resolvedYear.current);
          for (const video of found) queue.current.push({ id: video.id, checkLength: false });
        }
        logEvent('trailer', `YouTube-soegning: ${queue.current.length} bud`);
        return true;
      }
      default: return false;
    }
  }

  /** En enkelt koe ejer kilde-skiftet; dublerede fejl kan ikke springe et bud over. */
  async function playNext(): Promise<void> {
    if (!alive.current || busy.current) return;
    busy.current = true;
    setSource({ kind: 'looking' });
    setLoading(true);
    try {
      const native = nativeQueue.current.shift();
      if (native !== undefined) {
        setSource(native);
        return;
      }
      for (;;) {
        if (!alive.current) return;
        const next = queue.current.shift();
        if (next !== undefined) {
          if (tried.current.has(next.id) || !/^[A-Za-z0-9_-]{11}$/.test(next.id)) continue;
          tried.current.add(next.id);
          logEvent('trailer', isTV && Platform.OS === 'android' ? 'YouTube: proever bevis paa boksen' : 'YouTube: officiel indlejring i appen');
          setLoading(false);
          setSource({ kind: isTV && Platform.OS === 'android' ? 'proof' : 'youtube', ...next });
          return;
        }
        if (!await refill()) break;
      }
      if (alive.current) { setLoading(false); setSource({ kind: 'none' }); }
    } catch {
      if (alive.current) { setLoading(false); setSource({ kind: 'none' }); }
    } finally { busy.current = false; }
  }

  async function start(): Promise<void> {
    tmdbKey.current = await getTmdbApiKey(session.db);
    const clean = cleanVodTitle(title);
    const name = year === null ? title : `${title} (${year})`;
    const info = tmdbKey.current === null ? null : await findTitleInfo(metadataFetch, tmdbKey.current, kind, name);
    if (!alive.current) return;
    aliases.current = [...new Set([info?.englishTitle, info?.originalTitle, clean.title].filter((t): t is string => typeof t === 'string' && t.length > 0))].slice(0, 3);
    resolvedYear.current = info?.year ?? year ?? clean.year;
    if (Platform.OS === 'android') {
      // Uafhaengige kilder spoerges samtidig; Apple er stadig foerstevalg.
      const [apple, imdb] = await Promise.all([
        findAppleTrailers(getJson, kind, aliases.current, resolvedYear.current),
        info?.imdbId ? findImdbTrailers(postJson, info.imdbId) : Promise.resolve([]),
      ]);
      if (!alive.current) return;
      logEvent('trailer', `Apple TV: ${apple.length} bud, IMDb: ${imdb.length} bud`);
      for (const video of apple.slice(0, 3)) {
        const master = await getText(video.url);
        if (!alive.current) return;
        const built = master === null ? null : buildHlsMaster(master, video.url);
        const uri = built === null ? null : manifest(video.id, built.playlist);
        if (uri !== null) nativeQueue.current.push({ kind: 'native', id: video.id, uri, seconds: video.seconds, provider: 'Apple TV', contentType: 'hls', resumeAt: 0, attempt: 0 });
      }
      for (const video of imdb) nativeQueue.current.push({ kind: 'native', id: video.videoId, uri: video.url, seconds: video.seconds, provider: 'IMDb', contentType: video.contentType, imdbTitleId: info?.imdbId ?? undefined, resumeAt: 0, attempt: 0 });
    }
    await playNext();
  }

  async function recoverNative(from: NativeSource, position: number, reason: string): Promise<void> {
    if (!alive.current || busy.current) return;
    logEvent('trailer', `${from.provider}: ${reason} ved ${Math.round(position)} s`);
    if (from.provider === 'YouTube PO') {
      setLoading(false);
      setSource({ kind: 'youtube', id: from.id, checkLength: false, resumeAt: position });
      return;
    }
    // Frisk IMDb-adresse, samme video og position, hoejst to gange i alt.
    if (from.imdbTitleId !== undefined && from.attempt < 2) {
      busy.current = true;
      setSource({ kind: 'looking' });
      setLoading(true);
      try {
        const refreshed = (await findImdbTrailers(postJson, from.imdbTitleId)).find((t) => t.videoId === from.id);
        if (!alive.current) return;
        if (refreshed !== undefined) {
          setSource({ ...from, uri: refreshed.url, contentType: refreshed.contentType, resumeAt: position, attempt: from.attempt + 1 });
          return;
        }
      } finally { busy.current = false; }
    }
    await playNext();
  }

  useEffect(() => {
    alive.current = true;
    void start().catch(() => { if (alive.current) void playNext(); });
    return () => {
      alive.current = false;
      for (const controller of requests.current) controller.abort();
      for (const file of manifests.current) { try { if (file.exists) file.delete(); } catch { /* Cache ryddes ogsaa af OS. */ } }
    };
    // En trailerskaerm tilhoerer én titel og afmonteres naar den lukkes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      <View style={[styles.frame, isTV && styles.frameFull]}>
        {source.kind === 'proof' && <YoutubeProof key={source.id} id={source.id}
          onFallback={() => setSource({ kind: 'youtube', id: source.id, checkLength: source.checkLength })}
          onResolved={(result) => {
            manifests.current.push(...result.files);
            setLoading(true);
            setSource({ kind: 'native', id: source.id, uri: result.uri, seconds: result.seconds, contentType: 'dash', provider: 'YouTube PO', resumeAt: 0, attempt: 0 });
          }}
        />}
        {source.kind === 'youtube' && <YoutubeTrailer
          key={source.id}
          id={source.id}
          checkLength={source.checkLength}
          resumeAt={source.resumeAt}
          onUnavailable={() => { void playNext(); }}
          onEnd={() => { if (isTV) onBack(); }}
        />}
        {source.kind === 'native' && <NativeTrailer
          key={`${source.id}:${source.attempt}`}
          uri={source.uri}
          resumeAt={source.resumeAt}
          expectedSeconds={source.seconds}
          contentType={source.contentType}
          onReady={() => setLoading(false)}
          onBroken={(position, reason) => { void recoverNative(source, position, reason); }}
          onEnd={isTV ? onBack : undefined}
        />}
        {(source.kind === 'looking' || (source.kind === 'native' && loading)) && <View style={styles.overlay}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.hint}>Leder efter en trailer …</Text>
        </View>}
        {source.kind === 'none' && <View style={styles.overlay}>
          <Text style={styles.title}>Ingen trailer kunne afspilles til «{title}».</Text>
          <Text style={styles.hint}>Prøv en anden titel, eller gå tilbage og prøv igen.</Text>
          <TvPressable style={styles.button} hasTVPreferredFocus={isTV} onPress={() => {
            nativeQueue.current = []; queue.current = []; tried.current.clear(); stage.current = 0;
            setLoading(true); setSource({ kind: 'looking' });
            void start().catch(() => { if (alive.current) void playNext(); });
          }}><Text style={styles.buttonText}>Prøv igen</Text></TvPressable>
        </View>}
      </View>
      {!isTV && <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        <Text style={styles.hint}>{source.kind === 'native' ? `Trailer fra ${source.provider}` : 'Trailer i appen'}</Text>
        <TvPressable style={styles.button} onPress={onBack}><Text style={styles.buttonText}>Tilbage</Text></TvPressable>
      </View>}
    </View>
  );
}

function KeepAwake() { useKeepAwake('norstream-native-trailer'); return null; }
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
  const styles = useStyles(makeStyles);
  const [playing, setPlaying] = useState(true);
  const [initialFocus, setInitialFocus] = useState(isTV);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setInitialFocus(false));
    return () => cancelAnimationFrame(frame);
  }, []);
  const source = useMemo(() => ({ uri, contentType, useCaching: contentType === 'progressive' }), [uri, contentType]);
  const player = useVideoPlayer(source, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 0.5;
    p.bufferOptions = {
      preferredForwardBufferDuration: 120,
      minBufferForPlayback: 4,
      maxBufferBytes: 64 * 1024 * 1024,
      prioritizeTimeOverSizeThreshold: false,
    };
    p.play();
  });
  const handlers = useRef({ onReady, onBroken, onEnd });
  handlers.current = { onReady, onBroken, onEnd };
  function toggle(): void { if (player.playing) player.pause(); else player.play(); }
  function seek(by: number): void {
    player.currentTime = Math.max(0, Math.min(player.currentTime + by, Math.max(0, player.duration - 1)));
  }
  useTVEventHandler((event) => {
    if (!isTV || event.eventKeyAction === 0) return;
    if (event.eventType === 'playPause') toggle();
    if (event.eventType === 'rewind') seek(-10);
    if (event.eventType === 'fastForward') seek(10);
  });

  useEffect(() => {
    let ready = false;
    let done = false;
    /** Holdt her og ikke laest af afspilleren: den kan vaere frigivet naar vi skal bruge tallet. */
    let position = resumeAt;
    let duration = expectedSeconds ?? 0;
    let lastProgress = Date.now();
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
    const updateStatus = (next: string, error?: { message?: string } | null): void => {
      if (next === 'readyToPlay') {
        clearStall();
        if (!ready) {
          ready = true;
          lastProgress = Date.now();
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
        if (stall === null) stall = setTimeout(() => broken('stod stille'), NATIVE_STALL_MS);
      } else if (next === 'error') {
        // Kun HTTP-koden; fejlteksten kan rumme adressen.
        const code = /\b([45]\d\d)\b/.exec(error?.message ?? '')?.[1];
        broken(code === undefined ? 'fejl' : `fejl ${code}`);
      }
    };
    const status = player.addListener('statusChange', ({ status: next, error }) => updateStatus(next, error));
    // ready kan allerede vaere sket inden listeneren blev registreret.
    updateStatus(player.status);
    const time = player.addListener('timeUpdate', ({ currentTime }) => {
      if (Number.isFinite(currentTime) && currentTime >= 0) {
        if (Math.abs(currentTime - position) >= 0.25) lastProgress = Date.now();
        position = currentTime;
      }
    });
    const changes = player.addListener('playingChange', ({ isPlaying }) => {
      setPlaying(isPlaying);
      lastProgress = Date.now();
      if (!isPlaying) clearStall();
    });
    const progress = setInterval(() => {
      if (done || !ready) return;
      if (!player.playing) { lastProgress = Date.now(); return; }
      if (Date.now() - lastProgress >= NATIVE_STALL_MS) broken('position stod stille');
    }, 1000);
    const end = player.addListener('playToEnd', () => {
      if (done) return;
      // Sluttede den mere end et par sekunder foer tid, er det ikke slutningen.
      if (!ready) return;
      if (duration > 0 && position < duration - 3) {
        broken(`sluttede ved ${clock(position)} af ${clock(duration)}`);
        return;
      }
      done = true;
      setPlaying(false);
      clearTimeout(timer);
      clearStall();
      handlers.current.onEnd?.();
    });
    return () => {
      done = true;
      clearTimeout(timer);
      clearStall();
      clearInterval(progress);
      changes.remove();
      status.remove();
      time.remove();
      end.remove();
    };
    // resumeAt er fast for denne afspiller (ny noegle ved hver genopretning).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  return (
    <View style={styles.nativeFrame}>
    {playing && <KeepAwake />}
    <VideoView
      style={styles.nativeVideo}
      player={player}
      nativeControls={!isTV}
      contentFit="contain"
      surfaceType={surfaceTypeForPlatform()}
    />
    {isTV && <View style={styles.nativeControls}>
      <TvPressable style={styles.controlButton} hasTVPreferredFocus={initialFocus} onPress={toggle}><Text style={styles.buttonText}>{playing ? 'Pause' : 'Afspil'}</Text></TvPressable>
      <TvPressable style={styles.controlButton} onPress={() => seek(-10)}><Text style={styles.buttonText}>−10 s</Text></TvPressable>
      <TvPressable style={styles.controlButton} onPress={() => seek(10)}><Text style={styles.buttonText}>+10 s</Text></TvPressable>
    </View>}
    </View>
  );
}


const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  frame: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000000' },
  frameFull: { aspectRatio: undefined, flex: 1 },
  overlay: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.md },
  info: { flex: 1, padding: theme.spacing.md, backgroundColor: colors.background },
  title: { color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  hint: { color: colors.textMuted, fontSize: 13, marginTop: 8, textAlign: 'center' },
  button: { backgroundColor: colors.surfaceRaised, borderRadius: theme.radius, paddingVertical: 10, paddingHorizontal: 16, marginTop: 16 },
  buttonText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  nativeFrame: { flex: 1 },
  nativeVideo: { flex: 1 },
  nativeControls: { height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 12 },
  controlButton: { backgroundColor: colors.surfaceRaised, borderRadius: 4, paddingHorizontal: 14, paddingVertical: 6 },
});
