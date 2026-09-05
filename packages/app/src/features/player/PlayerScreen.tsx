import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { buildLiveUrl, buildTimeshiftUrl } from '@norstream/core';
import type { Programme } from '@norstream/core';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';
import { getNowNext } from '../../storage/programmes.js';
import { getPanelOffsetMinutes, getTimeshiftDialect } from '../../storage/settings.js';
import { theme } from '../../ui/theme.js';
import { FALLBACK_FORMAT, formatForPlatform, hasFormatFallback } from './format.js';

interface Props {
  session: AppSession;
  channel: StoredChannel;
  onBack: () => void;
  /**
   * Programmet der skal afspilles fra begyndelsen. Saettes af guiden, hvor
   * start-forfra har sit synlige hjem: man trykker paa et afsluttet program,
   * ikke paa en knap man skal vide findes.
   */
  startFrom?: Programme;
}

const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 1500;
/** Hvor laenge afspilleren maa haenge i buffering foer vi kalder det et udfald. */
const STALL_TIMEOUT_MS = 15_000;

export function PlayerScreen({ session, channel, onBack, startFrom }: Props) {
  /**
   * Null indtil arkiv-URLen er bygget, naar afspilningen kommer fra guiden.
   *
   * Panelet tillader én samtidig forbindelse. Startede vi paa live-URLen og
   * skiftede bagefter, ville arkiv-streamen bede om forbindelse nummer to og
   * blive afvist — af den stream vi selv lige havde aabnet.
   */
  const [source, setSource] = useState<string | null>(() =>
    startFrom !== undefined ? null : buildLiveUrl(session.creds, channel.id, formatForPlatform()),
  );
  const [now, setNow] = useState<Programme | null>(null);
  const [next, setNext] = useState<Programme | null>(null);
  const [canRestart, setCanRestart] = useState(false);
  // Kommer vi fra guiden med et program, er afspilningen en start-forfra fra
  // foerste billede — ogsaa foer dialekten er laest, saa format-fallbacket
  // aldrig naar at slaa til paa en timeshift-URL.
  const [restarted, setRestarted] = useState(startFrom !== undefined);
  const [triedFallback, setTriedFallback] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  const player = useVideoPlayer(source, (p) => {
    p.loop = false;
    p.play();
  });

  useEffect(() => {
    let cancelled = false;

    async function loadEpg(): Promise<void> {
      // Opslaget sker paa kanalens eget id — Xtreams stream_id. I v1 gik det
      // gennem epg_channel_id, som 87 % af panelets kanaler ikke har, saa
      // start-forfra var utilgaengeligt for dem uanset deres arkiv.
      const result = await getNowNext(session.db, channel.id, new Date());
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
    if (source === null) return;
    player.replace(source);
    player.play();
  }, [player, source]);

  // Spec sec.9: IPTV-streams falder ud hele tiden. To forsoeg med backoff,
  // derefter fallback til det andet containerformat der hvor et saadant
  // findes, og automatisk genforbindelse naar afspilningen stopper eller
  // haenger midt i. Uden det opfoerer appen sig som de Norlys-anmeldelser
  // der klagede over konstante udfald.
  useEffect(() => {
    if (source === null) return;

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

  const playFromStart = useCallback(
    async (programme: Programme): Promise<void> => {
      const dialect = await getTimeshiftDialect(session.db);
      if (dialect === null) {
        // Uden dialekt kan arkiv-URLen ikke bygges. Kom vi fra guiden, staar
        // skaermen sort uden dette: fald tilbage paa live frem for ingenting.
        setSource((current) =>
          current ?? buildLiveUrl(session.creds, channel.id, formatForPlatform()),
        );
        setRestarted(false);
        return;
      }
      const offset = await getPanelOffsetMinutes(session.db);

      const durationMinutes = Math.ceil(
        (programme.stop.getTime() - programme.start.getTime()) / 60_000,
      );
      setSource(
        buildTimeshiftUrl(
          session.creds,
          channel.id,
          programme.start,
          durationMinutes,
          dialect,
          offset,
        ),
      );
      setRestarted(true);
    },
    [session.db, session.creds, channel.id],
  );

  // Guiden aabner afspilleren med et afsluttet program: byg arkiv-URLen med
  // det samme, i stedet for at vente paa at brugeren finder en knap.
  const startFromHandled = useRef(false);
  useEffect(() => {
    if (startFrom === undefined || startFromHandled.current) return;
    startFromHandled.current = true;
    void playFromStart(startFrom);
  }, [startFrom, playFromStart]);

  return (
    <View style={styles.container}>
      {/* allowsFullscreen findes ikke i den installerede expo-video (57.0.3) —
          fuldskaerm er slaaet til som standard via fullscreenOptions.enable. */}
      <VideoView style={styles.video} player={player} nativeControls />

      <View style={styles.info}>
        <Text style={styles.channelName}>{channel.name}</Text>
        {/* Kommer vi fra guiden, er det programmet der genafspilles der staar
            oeverst — ikke det der sendes lige nu. */}
        <Text style={styles.nowTitle}>
          {startFrom?.title ?? now?.title ?? 'Ingen programdata'}
        </Text>
        {startFrom === undefined && next !== null && (
          <Text style={styles.nextTitle}>Derefter: {next.title}</Text>
        )}
        {restarted && <Text style={styles.badge}>Afspilles fra begyndelsen</Text>}
        {streamError !== null && <Text style={styles.error}>{streamError}</Text>}
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.button} onPress={onBack}>
          <Text style={styles.buttonText}>Tilbage</Text>
        </Pressable>
        {canRestart && !restarted && now !== null && (
          <Pressable
            style={[styles.button, styles.buttonAccent]}
            onPress={() => {
              void playFromStart(now);
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
