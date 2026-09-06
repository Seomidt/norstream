import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import type { AppSession } from '../../session.js';
import { deleteRecording, listRecordings, updateRecording } from '../../storage/recordings.js';
import type { Recording } from '../../storage/recordings.js';
import { getPanelOffsetMinutes, getTimeshiftDialect } from '../../storage/settings.js';
import { runRecordings } from '../../sync/recorder.js';
import { theme } from '../../ui/theme.js';
import { describeRecording, formatBytes } from './plan.js';
import { availableBytes, createRecordingStore } from './store.js';

interface Props {
  session: AppSession;
}

/**
 * Optagelserne.
 *
 * Der optages ikke noget her. Panelet har ingen optagefunktion; det appen kan,
 * er at hente udsendelsen ned fra panelets arkiv naar den er sendt. Skaermen
 * siger det med rene ord i stedet for at lade folk opdage det selv naar
 * "optagelsen" af aftenens kamp aldrig dukker op.
 */
export function RecordingsScreen({ session }: Props) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [dialect, setDialect] = useState<'php' | 'path' | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [playing, setPlaying] = useState<Recording | null>(null);
  const [now, setNow] = useState(() => new Date());

  const store = useRef(createRecordingStore()).current;

  const reload = useCallback(async (): Promise<void> => {
    const [rows, storedDialect] = await Promise.all([
      listRecordings(session.db),
      getTimeshiftDialect(session.db),
    ]);
    setRecordings(rows);
    setDialect(storedDialect);
    setNow(new Date());
  }, [session.db]);

  useEffect(() => {
    void (async () => {
      try {
        await reload();
      } finally {
        setLoading(false);
      }
    })();
  }, [reload]);

  /**
   * Hentningen startes af brugeren, ikke af skaermen.
   *
   * Panelet tillader én forbindelse. Gik en hentning i gang af sig selv naar
   * fanen blev aabnet, ville den kunne afbryde den udsendelse man sad og saa —
   * og det ville se ud som et netvaerksproblem, ikke som noget appen gjorde.
   */
  const fetchNow = useCallback(async (): Promise<void> => {
    const storedDialect = await getTimeshiftDialect(session.db);
    if (storedDialect === null) return;
    setRunning(true);
    try {
      await runRecordings(
        session.db,
        session.creds,
        storedDialect,
        await getPanelOffsetMinutes(session.db),
        store,
        new Date(),
        () => {
          void reload();
        },
        (id, bytesWritten) => {
          setProgress((current) => ({ ...current, [id]: bytesWritten }));
        },
      );
    } finally {
      setRunning(false);
      setProgress({});
      await reload();
    }
  }, [session, store, reload]);

  async function remove(recording: Recording): Promise<void> {
    if (recording.fileUri !== null) await store.remove(recording.fileUri);
    await deleteRecording(session.db, recording.id);
    if (playing?.id === recording.id) setPlaying(null);
    await reload();
  }

  async function retry(recording: Recording): Promise<void> {
    await updateRecording(session.db, recording.id, { state: 'planned', error: null });
    await reload();
    await fetchNow();
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  if (playing !== null && playing.fileUri !== null) {
    return (
      <RecordingPlayer
        recording={playing}
        uri={playing.fileUri}
        onClose={() => setPlaying(null)}
      />
    );
  }

  const waiting = recordings.filter(
    (recording) => recording.state === 'planned' || recording.state === 'failed',
  ).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>
          {recordings.length === 0
            ? 'Ingen optagelser endnu'
            : `${recordings.length} optagelser · ${formatBytes(availableBytes())} fri plads`}
        </Text>
        {dialect === null ? (
          <Text style={styles.headerHint}>
            Optagelse kræver adgang til udbyderens arkiv, og appen har ikke fundet
            vejen til det endnu. Åbn en kanal med arkiv og tryk “Prøv igen” under
            Start forfra.
          </Text>
        ) : (
          <Text style={styles.headerHint}>
            Udsendelser hentes fra udbyderens arkiv efter de er sendt — ikke mens
            de sendes. Hentningen bruger den ene forbindelse panelet tillader, så
            start den når du ikke ser tv.
          </Text>
        )}
        {waiting > 0 && dialect !== null && (
          <Pressable
            style={[styles.button, running && styles.buttonBusy]}
            disabled={running}
            onPress={() => {
              void fetchNow();
            }}
          >
            {running ? (
              <ActivityIndicator color={theme.colors.text} />
            ) : (
              <Text style={styles.buttonText}>Hent nu ({waiting})</Text>
            )}
          </Pressable>
        )}
      </View>

      <FlatList
        data={recordings}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Tryk Optag på et program i guiden eller på afspilleren, så står det her.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {item.channelName} · {formatDayTime(item.start)}
              </Text>
              <Text style={styles.rowState}>
                {progress[item.id] !== undefined
                  ? `Henter … ${formatBytes(progress[item.id] ?? 0)}`
                  : describeRecording(item, now)}
              </Text>
            </View>
            <View style={styles.rowActions}>
              {item.state === 'done' && (
                <Pressable hitSlop={8} onPress={() => setPlaying(item)}>
                  <Text style={styles.action}>Se</Text>
                </Pressable>
              )}
              {(item.state === 'failed' || item.state === 'expired') && (
                <Pressable
                  hitSlop={8}
                  onPress={() => {
                    void retry(item);
                  }}
                >
                  <Text style={styles.action}>Prøv igen</Text>
                </Pressable>
              )}
              <Pressable
                hitSlop={8}
                onPress={() => {
                  void remove(item);
                }}
              >
                <Text style={styles.danger}>Slet</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </View>
  );
}

function RecordingPlayer({
  recording,
  uri,
  onClose,
}: {
  recording: Recording;
  uri: string;
  onClose: () => void;
}) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });

  return (
    <View style={styles.playerRoot}>
      <VideoView style={styles.video} player={player} nativeControls />
      <View style={styles.playerInfo}>
        <Text style={styles.rowTitle}>{recording.title}</Text>
        <Text style={styles.rowMeta}>
          {recording.channelName} · {formatDayTime(recording.start)}
        </Text>
      </View>
      <Pressable style={styles.button} onPress={onClose}>
        <Text style={styles.buttonText}>Tilbage</Text>
      </Pressable>
    </View>
  );
}

function formatDayTime(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}. kl. ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
  },
  header: {
    padding: theme.spacing.md,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerText: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  headerHint: {
    color: theme.colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: theme.spacing.xs,
  },
  button: {
    alignSelf: 'flex-start',
    marginTop: theme.spacing.md,
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    minWidth: 120,
    alignItems: 'center',
  },
  buttonBusy: { backgroundColor: theme.colors.surfaceRaised },
  buttonText: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  empty: {
    color: theme.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    padding: theme.spacing.lg,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, paddingRight: theme.spacing.sm },
  rowTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  rowMeta: { color: theme.colors.textMuted, fontSize: 13, marginTop: 2 },
  rowState: { color: theme.colors.accent, fontSize: 12, marginTop: 4 },
  rowActions: { flexDirection: 'row', gap: theme.spacing.md },
  action: { color: theme.colors.accent, fontSize: 14, fontWeight: '600' },
  danger: { color: theme.colors.danger, fontSize: 14, fontWeight: '600' },
  playerRoot: { flex: 1, backgroundColor: '#000000' },
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000000' },
  playerInfo: { padding: theme.spacing.md },
});
