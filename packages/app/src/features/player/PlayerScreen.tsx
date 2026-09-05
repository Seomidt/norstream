import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { buildLiveUrl, buildTimeshiftUrl } from '@norstream/core';
import type { Programme, StreamFormat } from '@norstream/core';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';
import { getNowNext } from '../../storage/programmes.js';
import { getPanelOffsetMinutes, getTimeshiftDialect } from '../../storage/settings.js';
import { theme } from '../../ui/theme.js';

interface Props {
  session: AppSession;
  channel: StoredChannel;
  onBack: () => void;
}

/**
 * AVPlayer paa iOS og tvOS kan ikke afspille raa MPEG-TS over HTTP, saa
 * Apple-platforme og web skal have HLS. Android faar .ts for lavere latenstid.
 */
function formatForPlatform(): StreamFormat {
  return Platform.OS === 'android' ? 'ts' : 'm3u8';
}

/**
 * Der findes kun et brugbart fallback-format naar det primaere var .ts, altsaa
 * kun paa Android. Spec sec.8: AVPlayer kan ikke afspille raa MPEG-TS over
 * HTTP, saa paa iOS, tvOS og web ville et skift til .ts vaere en garanteret
 * fejl — og det ville braende det eneste fallback-forsoeg, saa en HLS-hikke
 * der kunne have rettet sig selv ender i en doed stream.
 */
function hasFormatFallback(): boolean {
  return formatForPlatform() === 'ts';
}

/** Det andet containerformat. Kun meningsfuldt naar hasFormatFallback() er sand. */
const FALLBACK_FORMAT: StreamFormat = 'm3u8';

const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 1500;
/** Hvor laenge afspilleren maa haenge i buffering foer vi kalder det et udfald. */
const STALL_TIMEOUT_MS = 15_000;

export function PlayerScreen({ session, channel, onBack }: Props) {
  const [source, setSource] = useState(() =>
    buildLiveUrl(session.creds, channel.id, formatForPlatform()),
  );
  const [now, setNow] = useState<Programme | null>(null);
  const [next, setNext] = useState<Programme | null>(null);
  const [canRestart, setCanRestart] = useState(false);
  const [restarted, setRestarted] = useState(false);
  const [triedFallback, setTriedFallback] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  const player = useVideoPlayer(source, (p) => {
    p.loop = false;
    p.play();
  });

  useEffect(() => {
    let cancelled = false;

    async function loadEpg(): Promise<void> {
      if (channel.epgChannelId === null) return;
      const result = await getNowNext(session.db, channel.epgChannelId, new Date());
      if (cancelled) return;
      setNow(result.now);
      setNext(result.next);

      const dialect = await getTimeshiftDialect(session.db);
      if (cancelled) return;
      setCanRestart(channel.hasArchive && dialect !== null && result.now !== null);
    }

    void loadEpg();
    return () => {
      cancelled = true;
    };
  }, [session.db, channel]);

  useEffect(() => {
    player.replace(source);
    player.play();
  }, [player, source]);

  // Spec sec.9: IPTV-streams falder ud hele tiden. To forsoeg med backoff,
  // derefter fallback til det andet containerformat der hvor et saadant
  // findes, og automatisk genforbindelse naar afspilningen stopper eller
  // haenger midt i. Uden det opfoerer appen sig som de Norlys-anmeldelser
  // der klagede over konstante udfald.
  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;

    function clearStallTimer(): void {
      if (stallTimer !== null) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
    }

    // Faelles vej for baade haarde fejl og stall.
    function handleFailure(): void {
      if (cancelled) return;
      clearStallTimer();

      attempt += 1;
      if (attempt <= MAX_RETRIES) {
        if (retryTimer !== null) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          if (cancelled) return;
          player.replace(source);
          player.play();
        }, attempt * RETRY_BACKOFF_MS);
        return;
      }

      // Foerst efter at begge forsoeg fejlede proever vi det andet format, og
      // kun hvor der findes et brugbart et — se hasFormatFallback(). Under
      // start-forfra springes fallback ogsaa over: timeshift-URLen er altid
      // HLS uanset platform.
      if (hasFormatFallback() && !triedFallback && !restarted) {
        setTriedFallback(true);
        attempt = 0;
        setSource(buildLiveUrl(session.creds, channel.id, FALLBACK_FORMAT));
        return;
      }

      // Den raa besked fra expo-video maa aldrig vises. Den stammer fra
      // ExoPlayer eller AVPlayer, som rutinemaessigt skriver den fejlende URI
      // ind i teksten — og live-URLen har panelets adgangskode som et
      // sti-segment. En fast dansk tekst i stedet, aldrig error.message.
      setStreamError('Streamen kunne ikke afspilles. Prøv igen.');
    }

    const subscription = player.addListener(
      'statusChange',
      ({ status }: { status: string }) => {
        if (cancelled) return;

        if (status === 'readyToPlay') {
          attempt = 0;
          clearStallTimer();
          setStreamError(null);
          return;
        }

        if (status === 'error') {
          handleFailure();
          return;
        }

        // Spec sec.9 kraever ogsaa genforbindelse paa buffer-haendelser:
        // bliver afspilleren haengende i 'loading' uden at komme videre, er
        // streamen faldet ud midt i afspilningen, selv om der aldrig kom en
        // egentlig fejl.
        if (status === 'loading' && stallTimer === null) {
          stallTimer = setTimeout(handleFailure, STALL_TIMEOUT_MS);
        }
      },
    );

    return () => {
      cancelled = true;
      clearStallTimer();
      if (retryTimer !== null) clearTimeout(retryTimer);
      subscription.remove();
    };
  }, [player, source, triedFallback, restarted, session.creds, channel.id]);

  async function restart(): Promise<void> {
    if (now === null) return;
    const dialect = await getTimeshiftDialect(session.db);
    if (dialect === null) return;
    const offset = await getPanelOffsetMinutes(session.db);

    const durationMinutes = Math.ceil(
      (now.stop.getTime() - now.start.getTime()) / 60_000,
    );
    setSource(
      buildTimeshiftUrl(
        session.creds,
        channel.id,
        now.start,
        durationMinutes,
        dialect,
        offset,
      ),
    );
    setRestarted(true);
  }

  return (
    <View style={styles.container}>
      {/* allowsFullscreen findes ikke i den installerede expo-video (57.0.3) —
          fuldskaerm er slaaet til som standard via fullscreenOptions.enable. */}
      <VideoView style={styles.video} player={player} nativeControls />

      <View style={styles.info}>
        <Text style={styles.channelName}>{channel.name}</Text>
        <Text style={styles.nowTitle}>{now?.title ?? 'Ingen programdata'}</Text>
        {next !== null && <Text style={styles.nextTitle}>Derefter: {next.title}</Text>}
        {restarted && <Text style={styles.badge}>Afspilles fra begyndelsen</Text>}
        {streamError !== null && <Text style={styles.error}>{streamError}</Text>}
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.button} onPress={onBack}>
          <Text style={styles.buttonText}>Tilbage</Text>
        </Pressable>
        {canRestart && !restarted && (
          <Pressable
            style={[styles.button, styles.buttonAccent]}
            onPress={() => {
              void restart();
            }}
          >
            <Text style={styles.buttonText}>Start forfra</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000000' },
  info: { padding: theme.spacing.md },
  channelName: { color: theme.colors.text, fontSize: 20, fontWeight: '600' },
  nowTitle: { color: theme.colors.text, fontSize: 15, marginTop: theme.spacing.xs },
  nextTitle: { color: theme.colors.textMuted, fontSize: 13, marginTop: 2 },
  badge: { color: theme.colors.accent, fontSize: 13, marginTop: theme.spacing.sm },
  error: { color: theme.colors.danger, fontSize: 13, marginTop: theme.spacing.sm },
  actions: { flexDirection: 'row', padding: theme.spacing.md, gap: theme.spacing.sm },
  button: {
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
  },
  buttonAccent: { backgroundColor: theme.colors.accent },
  buttonText: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
});
