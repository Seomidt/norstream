import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { XtreamAuthError } from '@norstream/core';
import type { Programme } from '@norstream/core';
import type { AppSession } from '../../session.js';
import { listChannels } from '../../storage/channels.js';
import type { StoredChannel } from '../../storage/channels.js';
import { listProgrammes } from '../../storage/programmes.js';
import { deleteRecording, isScheduled, scheduleRecording } from '../../storage/recordings.js';
import { getTimeshiftDialect } from '../../storage/settings.js';
import { ensureFullEpg, ensureEpg } from '../../sync/epgCache.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { Notice } from '../../ui/Notice.js';
import type { NoticeState } from '../../ui/Notice.js';
import { theme } from '../../ui/theme.js';
import { canRecord } from '../recordings/plan.js';
import { ProgrammeSheet } from './ProgrammeSheet.js';
import { WINDOW_MINUTES, guideAction, guideWindow, layoutRow } from './layout.js';
import type { GuideCell } from './layout.js';

interface Props {
  session: AppSession;
  onPlay: (channel: StoredChannel) => void;
  onRestart: (channel: StoredChannel, programme: Programme) => void;
  onAuthError: () => void;
  onBrowse: () => void;
}

/** Bredden paa kanalkolonnen. Fast, saa alle raekker staar praecist under hinanden. */
const CHANNEL_COLUMN = 96;
const ROW_HEIGHT = 56;

/**
 * Guiden: vandret tid, lodret kanaler.
 *
 * Gitteret viser **favoritterne** — den maengde brugeren allerede er i — aldrig
 * alle 22.142 kanaler. Kun synlige raekker henter programdata, og de rammer
 * cachen i `epgCache`.
 *
 * **Der scrolles ikke vandret.** Vinduet er praecis skaermbredt og pages med
 * ‹ og ›. Alternativet — vandret scroll med en fastlaast kanalkolonne — kraever
 * at to lodrette lister holdes synkroniseret i haanden, og betaler for det med
 * en fejlkilde guiden ikke har brug for. Prisen er at man ikke kan svippe
 * gennem aftenen; til gengaeld staar kanalnavnet altid til venstre.
 */
export function GuideScreen({ session, onPlay, onRestart, onAuthError, onBrowse }: Props) {
  const [channels, setChannels] = useState<StoredChannel[]>([]);
  const [rows, setRows] = useState<Record<string, Programme[]>>({});
  const [dialect, setDialect] = useState<boolean>(false);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  /** Den celle bladet er aabnet for, eller null naar det er lukket. */
  const [sheet, setSheet] = useState<{
    channel: StoredChannel;
    cell: GuideCell;
    recorded: boolean;
  } | null>(null);

  // Nu-tidspunktet fastholdes mens skaermen er aaben, saa cellerne ikke
  // hopper mellem tilstande midt i et tryk. Det opdateres hvert minut.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const window = guideWindow(now, page);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [favourites, storedDialect] = await Promise.all([
          listChannels(session.db, { favouritesOnly: true }),
          getTimeshiftDialect(session.db),
        ]);
        if (cancelled) return;
        setChannels(favourites);
        setDialect(storedDialect !== null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.db]);

  /**
   * Bestiller en kommende udsendelse til optagelse.
   *
   * Bekraeftelsen staar i skaermen og ikke i en Alert: react-native-web
   * implementerer ikke Alert, og et tryk der ikke kvitterer for sig foeles
   * som et tryk der ikke virkede.
   */
  const openSheet = useCallback(
    async (channel: StoredChannel, cell: GuideCell): Promise<void> => {
      if (cell.programme === null) return;
      const recorded = await isScheduled(session.db, channel.id, cell.programme.start);
      setSheet({ channel, cell, recorded });
    },
    [session.db],
  );

  const record = useCallback(
    async (channel: StoredChannel, programme: Programme): Promise<void> => {
      const id = await scheduleRecording(session.db, channel, programme);
      setNotice({
        text: `“${programme.title}” hentes fra arkivet når den er sendt.`,
        actionLabel: 'Fortryd',
        onAction: () => {
          void deleteRecording(session.db, id);
          setNotice(null);
        },
      });
    },
    [session.db],
  );

  const runId = useRef(0);

  const loadVisible = useCallback(
    async (visible: StoredChannel[], from: Date, to: Date): Promise<void> => {
      if (visible.length === 0) return;
      const id = runId.current + 1;
      runId.current = id;
      const streamIds = visible.map((channel) => channel.id);

      /** Tegner det cachen har lige nu. Kaldes to gange: efter hver hentning. */
      const draw = async (): Promise<boolean> => {
        const loaded: Record<string, Programme[]> = {};
        for (const streamId of streamIds) {
          loaded[streamId] = await listProgrammes(session.db, streamId, from, to);
        }
        if (runId.current !== id) return false;
        setRows((previous) => ({ ...previous, ...loaded }));
        return true;
      };

      try {
        await ensureEpg(session.db, session.creds, session.fetchImpl, streamIds);
      } catch (cause) {
        if (cause instanceof XtreamAuthError) {
          onAuthError();
          return;
        }
        // Panelet kunne ikke naas; vi tegner hvad cachen har.
      }
      if (!(await draw())) return;

      // Foerst nu den fulde programtabel. Den er stoerre og langsommere, og
      // guiden skal ikke staa tom imens — men uden den er cellerne bag "nu"
      // tomme, og en udsendelse der allerede er sendt kan ikke startes.
      try {
        const result = await ensureFullEpg(
          session.db,
          session.creds,
          session.fetchImpl,
          visible,
        );
        if (result.programmes === 0) return;
      } catch (cause) {
        if (cause instanceof XtreamAuthError) onAuthError();
        return;
      }
      await draw();
    },
    [session, onAuthError],
  );

  const loadVisibleRef = useRef(loadVisible);
  useEffect(() => {
    loadVisibleRef.current = loadVisible;
  }, [loadVisible]);

  // Vinduet i primitive tal, saa effekten nedenfor ikke koerer igen bare fordi
  // guideWindow gav to nye Date-objekter med samme vaerdi.
  const windowStartMs = window.start.getTime();
  const windowEndMs = window.end.getTime();

  const visibleChannels = useRef<StoredChannel[]>([]);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 30 }).current;
  const onViewableItemsChanged = useRef(
    (info: { viewableItems: { item: StoredChannel }[] }): void => {
      visibleChannels.current = info.viewableItems
        .map((entry) => entry.item)
        .filter((channel): channel is StoredChannel => channel !== undefined);
    },
  ).current;

  // Foerste skaermfuld og hvert sideskift: hent for de raekker der er fremme.
  useEffect(() => {
    const visible =
      visibleChannels.current.length > 0 ? visibleChannels.current : channels.slice(0, 12);
    void loadVisibleRef.current(visible, new Date(windowStartMs), new Date(windowEndMs));
  }, [channels, windowStartMs, windowEndMs]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  if (channels.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>Guiden viser dine favoritter</Text>
        <Text style={styles.emptyText}>
          Læg nogle kanaler i favoritter, så står de her med aftenens programmer.
        </Text>
        <Pressable style={styles.button} onPress={onBrowse}>
          <Text style={styles.buttonText}>Gå til Kanaler</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {notice !== null && <Notice notice={notice} onDismiss={() => setNotice(null)} />}
      <View style={styles.toolbar}>
        <Pressable hitSlop={12} onPress={() => setPage((value) => value - 1)}>
          <Text style={styles.pager}>‹</Text>
        </Pressable>
        <Text style={styles.windowLabel}>
          {formatTime(window.start)} – {formatTime(window.end)}
          {page !== 0 ? ` · ${formatDay(window.start)}` : ''}
        </Text>
        <Pressable hitSlop={12} onPress={() => setPage((value) => value + 1)}>
          <Text style={styles.pager}>›</Text>
        </Pressable>
      </View>

      <View style={styles.timeHeader}>
        <View style={styles.timeSpacer} />
        {halfHourMarks(window.start).map((mark) => (
          <Text key={mark.getTime()} style={styles.timeMark}>
            {formatTime(mark)}
          </Text>
        ))}
      </View>

      {sheet !== null && sheet.cell.programme !== null && (
        <ProgrammeSheet
          channel={sheet.channel}
          programme={sheet.cell.programme}
          state={sheet.cell.state}
          hasDialect={dialect}
          alreadyRecorded={sheet.recorded}
          onClose={() => setSheet(null)}
          onPlay={() => {
            setSheet(null);
            onPlay(sheet.channel);
          }}
          onRestart={() => {
            const programme = sheet.cell.programme;
            setSheet(null);
            if (programme !== null) onRestart(sheet.channel, programme);
          }}
          onRecord={() => {
            const programme = sheet.cell.programme;
            setSheet(null);
            if (programme !== null) void record(sheet.channel, programme);
          }}
        />
      )}

      <FlatList
        data={channels}
        keyExtractor={(item) => item.id}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        getItemLayout={(_, index) => ({
          length: ROW_HEIGHT,
          offset: ROW_HEIGHT * index,
          index,
        })}
        renderItem={({ item }) => (
          <GuideRow
            channel={item}
            cells={layoutRow(rows[item.id] ?? [], window.start, window.end, now)}
            hasDialect={dialect}
            onOpen={(channel, cell) => {
              void openSheet(channel, cell);
            }}
          />
        )}
      />
    </View>
  );
}

function GuideRow({
  channel,
  cells,
  hasDialect,
  onOpen,
}: {
  channel: StoredChannel;
  cells: GuideCell[];
  hasDialect: boolean;
  onOpen: (channel: StoredChannel, cell: GuideCell) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.channelCell}>
        <ChannelLogo uri={channel.logoUrl} name={channel.name} size={26} />
        <View style={styles.channelText}>
          <Text style={styles.channelName} numberOfLines={2}>
            {channel.name}
          </Text>
          {/* Uret siger at kanalen kan startes forfra, prikken at den kan
              optages. Begge dele afhaenger af udbyderens arkiv, og det gaelder
              langtfra alle kanaler — foer kunne man kun se det ved at proeve. */}
          {hasDialect && (channel.hasArchive || canRecord(channel)) && (
            <Text style={styles.channelBadges}>
              {channel.hasArchive ? '⏱' : ''}
              {canRecord(channel) ? '●' : ''}
            </Text>
          )}
        </View>
      </View>
      <View style={styles.cells}>
        {cells.map((cell) => {
          const action = guideAction(cell, channel, hasDialect);
          return (
            <Pressable
              key={cell.key}
              style={[
                styles.cell,
                { flexGrow: cell.weight, flexShrink: cell.weight, flexBasis: 0 },
                cell.state === 'live' && styles.cellLive,
                action === 'restart' && styles.cellRestartable,
                action === 'record' && styles.cellRecordable,
                action === 'none' && styles.cellInactive,
              ]}
              disabled={cell.programme === null}
              onPress={() => onOpen(channel, cell)}
            >
              {/* Uden maerket kan man ikke se hvilke afsluttede udsendelser
                  der kan startes igen. Cellerne ser ens ud, og forskellen —
                  om kanalen har arkiv — er usynlig indtil man har trykket. */}
              <Text style={styles.cellText} numberOfLines={2}>
                {action === 'restart' ? '▶ ' : ''}
                {action === 'record' ? '● ' : ''}
                {cell.programme?.title ?? ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Kolonneoverskrifter for vinduet: én per halve time. */
function halfHourMarks(start: Date): Date[] {
  const marks: Date[] = [];
  for (let minutes = 0; minutes < WINDOW_MINUTES; minutes += 30) {
    marks.push(new Date(start.getTime() + minutes * 60_000));
  }
  return marks;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Enhedens lokale tid: guiden laeses af et menneske, ikke af panelet. */
function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDay(date: Date): string {
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.background,
  },
  emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '600' },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: 15,
    textAlign: 'center',
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
    lineHeight: 21,
  },
  button: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
  },
  buttonText: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  pager: { color: theme.colors.accent, fontSize: 26, paddingHorizontal: theme.spacing.sm },
  windowLabel: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  timeHeader: {
    flexDirection: 'row',
    paddingBottom: theme.spacing.xs,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  timeSpacer: { width: CHANNEL_COLUMN },
  timeMark: { flex: 1, color: theme.colors.textMuted, fontSize: 11 },
  row: { flexDirection: 'row', height: ROW_HEIGHT },
  channelCell: {
    width: CHANNEL_COLUMN,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.sm,
    borderRightColor: theme.colors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  channelText: { flex: 1, marginLeft: theme.spacing.xs },
  channelName: { color: theme.colors.text, fontSize: 11 },
  channelBadges: { color: theme.colors.accent, fontSize: 9, marginTop: 1 },
  cells: { flex: 1, flexDirection: 'row' },
  cell: {
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xs,
    marginRight: 1,
    marginVertical: 1,
    borderRadius: 4,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
  },
  cellLive: { backgroundColor: theme.colors.surfaceRaised },
  cellRestartable: { borderLeftColor: theme.colors.accent, borderLeftWidth: 2 },
  cellRecordable: { borderLeftColor: theme.colors.textMuted, borderLeftWidth: 2 },
  cellInactive: { opacity: 0.45 },
  cellText: { color: theme.colors.text, fontSize: 11 },
});
