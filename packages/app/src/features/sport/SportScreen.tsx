import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';
import { addReminder, listReminders, removeReminder } from '../../storage/reminders.js';
import { getSportAutoRemind, getSportTeams, setSportAutoRemind, setSportTeams } from '../../storage/sport.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { Notice } from '../../ui/Notice.js';
import type { NoticeState } from '../../ui/Notice.js';
import { theme } from '../../ui/theme.js';
import type { ThemeColors } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import { isTV } from '../../ui/tv.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { TvTextInput } from '../../ui/TvTextInput.js';
import { keepInMiddle, useTvListTail } from '../../ui/tvScroll.js';
import { autoRemindTeams, findMatches, refreshSportEpg } from './findMatches.js';
import { panelEpgInFlight, startPanelEpg } from '../../sync/panelEpg.js';
import type { Match } from './findMatches.js';
import { normalizeText, whenLabel } from './sportSearch.js';

interface Props {
  session: AppSession;
  /** Skift til kanalen (en kamp der koerer nu). */
  onPlay: (channel: StoredChannel, neighbours: StoredChannel[]) => void;
  /** Taelles op naar pil-hoejre fra menuen skal give skaermen fokus. */
  focusFirstSignal?: number;
}

const SEARCH_DEBOUNCE_MS = 350;
/** Forslag naar man ingen hold har endnu. */
const SUGGESTIONS = ['Superliga', 'Premier League', 'Champions League', 'Formel 1', 'Håndbold', 'Tennis'];

/**
 * "Find kampen" (v339): soeg efter et hold, en liga eller en sport i
 * programoversigten paa tvaers af kanalerne.
 *
 * - Hver kamp er én raekke med kanalerne der viser den, favoritterne foerst.
 *   Kanalerne er knapperne: OK paa en kamp der koerer, skifter til kanalen;
 *   paa en kommende saetter eller fjerner den en paamindelse.
 * - "Mine hold" er knapper over listen; uden soegning vises deres kampe.
 * - Paa tv er soegefeltet skjult bag en knap (et fast felt over en liste
 *   tager fokus og kalder tastaturet frem, se ANDROID-TV.md). Mikrofonen paa
 *   fjernbetjeningen virker i feltet.
 * - Der soeges kun i programoversigten der er hentet: favoritterne og
 *   sportskanalerne hentes her (hoejst hvert tyvende minut).
 */
export function SportScreen({ session, onPlay, focusFirstSignal = 0 }: Props) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const tail = useTvListTail();
  const listRef = useRef<FlatList<Match>>(null);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(!isTV);
  const [teams, setTeams] = useState<string[]>([]);
  const [autoRemind, setAutoRemindState] = useState(false);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [reminders, setReminders] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [now, setNow] = useState(Date.now());

  // Fra menuen (pil-hoejre): soegeknappen beder om fokus i én tegning.
  const consumed = useRef(focusFirstSignal);
  const [enterFocus, setEnterFocus] = useState(false);
  useEffect(() => {
    if (!isTV || focusFirstSignal === consumed.current) return;
    consumed.current = focusFirstSignal;
    setEnterFocus(true);
  }, [focusFirstSignal]);
  useEffect(() => {
    if (!enterFocus) return;
    const frame = requestAnimationFrame(() => setEnterFocus(false));
    return () => cancelAnimationFrame(frame);
  }, [enterFocus]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const loadReminders = useCallback(async () => {
    const list = await listReminders(session.db).catch(() => []);
    setReminders(new Set(list.map((r) => `${r.channelId}@${r.startMs}`)));
  }, [session.db]);

  useEffect(() => {
    void (async () => {
      setTeams(await getSportTeams(session.db));
      setAutoRemindState(await getSportAutoRemind(session.db));
      await loadReminders();
    })();
  }, [session.db, loadReminders]);

  const search = useCallback(async (): Promise<void> => {
    const at = Date.now();
    setNow(at);
    try {
      if (query.length > 0) {
        setMatches(await findMatches(session.db, query, { now: at }));
        return;
      }
      // Uden soegning: mine holds kampe, samlet og uden dubletter.
      const seen = new Set<string>();
      const all: Match[] = [];
      for (const team of teams) {
        for (const match of await findMatches(session.db, team, { now: at, limit: 20 })) {
          if (seen.has(match.key)) continue;
          seen.add(match.key);
          all.push(match);
        }
      }
      setMatches(all.sort((a, b) => Number(b.live) - Number(a.live) || a.startMs - b.startMs));
    } catch {
      setMatches([]);
    }
  }, [query, teams, session.db]);

  useEffect(() => {
    void search();
  }, [search]);

  // Programoversigten for sportskanalerne, i baggrunden: panelet per kanal
  // (refreshSportEpg) og panelets XMLTV-fil (v342: de fleste sportskanaler
  // har intet EPG-id og faar kun programmer derfra). Naar begge er faerdige,
  // soeges der igen — uanset hvad de gav, det er billigt.
  const searchRef = useRef(search);
  searchRef.current = search;
  useEffect(() => {
    let cancelled = false;
    setRefreshing(true);
    void (async () => {
      await refreshSportEpg(session);
      const file =
        startPanelEpg(
          session.db,
          session.sources.flatMap((access) =>
            access.source.kind === 'xtream' && access.creds !== null ? [{ sourceId: access.source.id, creds: access.creds }] : [],
          ),
        ) ?? panelEpgInFlight();
      if (file !== null) await file.catch(() => undefined);
      if (cancelled) return;
      setRefreshing(false);
      await searchRef.current();
      await autoRemindTeams(session.db).catch(() => 0);
      await loadReminders();
    })();
    return () => {
      cancelled = true;
    };
  }, [session, loadReminders]);

  const normalizedQuery = normalizeText(query);
  const savedTeam = teams.find((team) => normalizeText(team) === normalizedQuery) ?? null;

  const toggleTeam = async (): Promise<void> => {
    if (query.length === 0) return;
    const next = savedTeam === null ? [...teams, query] : teams.filter((team) => team !== savedTeam);
    await setSportTeams(session.db, next);
    setTeams(await getSportTeams(session.db));
    setNotice({ text: savedTeam === null ? `${query} er gemt under Mine hold.` : `${savedTeam} er fjernet fra Mine hold.` });
    if (savedTeam === null) {
      await autoRemindTeams(session.db).catch(() => 0);
      await loadReminders();
    }
  };

  const toggleAutoRemind = async (): Promise<void> => {
    const next = !autoRemind;
    await setSportAutoRemind(session.db, next);
    setAutoRemindState(next);
    if (next) {
      const added = await autoRemindTeams(session.db).catch(() => 0);
      await loadReminders();
      setNotice({
        text:
          added > 0
            ? `Du bliver mindet om ${added === 1 ? 'én kamp' : `${added} kampe`} i dag, 3 min før start.`
            : 'Appen minder dig om dine holds kampe, 3 min før start.',
      });
    }
  };

  const pressChannel = async (match: Match, channel: StoredChannel): Promise<void> => {
    if (match.startMs <= Date.now()) {
      onPlay(channel, match.channels);
      return;
    }
    const key = `${channel.id}@${match.startMs}`;
    if (reminders.has(key)) {
      await removeReminder(session.db, channel.id, match.startMs);
      setNotice({ text: `Påmindelsen om ${match.title} er fjernet.` });
    } else {
      await addReminder(session.db, channel.id, {
        channelId: channel.id,
        title: match.title,
        description: match.description,
        start: new Date(match.startMs),
        stop: new Date(match.stopMs),
      });
      setNotice({ text: `Du bliver mindet om ${match.title} på ${channel.name}, 3 min før start.` });
    }
    await loadReminders();
  };

  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>Find kampen</Text>
      {editing ? (
        <TvTextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Hold, liga eller sport — fx Brøndby"
          autoFocus={isTV}
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => {
            setQuery(text.trim());
            if (isTV) setEditing(false);
          }}
          onBlur={() => {
            if (isTV) setEditing(false);
          }}
        />
      ) : (
        <TvPressable style={styles.searchButton} hasTVPreferredFocus={enterFocus} onPress={() => setEditing(true)}>
          <Text style={styles.searchText} numberOfLines={1}>
            🔍 {query.length > 0 ? query : 'Søg efter hold, liga eller sport'}
          </Text>
        </TvPressable>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {query.length > 0 && (
          <TvPressable style={[styles.chip, styles.chipAction]} onPress={() => void toggleTeam()}>
            <Text style={styles.chipText}>{savedTeam === null ? '☆ Gem som mit hold' : '★ Fjern fra Mine hold'}</Text>
          </TvPressable>
        )}
        {query.length > 0 && (
          <TvPressable
            style={styles.chip}
            onPress={() => {
              setText('');
              setQuery('');
            }}
          >
            <Text style={styles.chipText}>Mine hold</Text>
          </TvPressable>
        )}
        {(teams.length > 0 ? teams : SUGGESTIONS).map((name) => (
          <TvPressable
            key={name}
            style={[styles.chip, normalizeText(name) === normalizedQuery && styles.chipActive]}
            onPress={() => {
              setText(name);
              setQuery(name);
            }}
          >
            <Text style={styles.chipText}>{teams.length > 0 ? `★ ${name}` : name}</Text>
          </TvPressable>
        ))}
      </ScrollView>

      {teams.length > 0 && (
        <TvPressable style={styles.toggle} onPress={() => void toggleAutoRemind()}>
          <Text style={styles.toggleText}>Mind mig automatisk om mine holds kampe</Text>
          <Text style={[styles.toggleValue, autoRemind && styles.toggleOn]}>{autoRemind ? 'Til' : 'Fra'}</Text>
        </TvPressable>
      )}

      <Notice notice={notice} onDismiss={() => setNotice(null)} />
      {refreshing && (
        <View style={styles.status}>
          <ActivityIndicator color={colors.accent} size="small" />
          <Text style={styles.statusText}>Henter programoversigten for sportskanalerne …</Text>
        </View>
      )}
    </View>
  );

  const empty = (): string => {
    if (matches === null) return '';
    if (query.length === 0 && teams.length === 0) {
      return 'Skriv et hold, en liga eller en sport, eller vælg et af forslagene. Gem dine hold med ☆, så står deres kampe her og på forsiden.';
    }
    if (query.length === 0) return 'Ingen kampe for dine hold de næste 7 dage.';
    return `Ingen kampe med "${query}" de næste 7 dage. Der søges i programoversigten for dine favoritter og sportskanalerne.`;
  };

  return (
    <View style={styles.container}>
      <FlatList
        ref={listRef}
        data={matches ?? []}
        keyExtractor={(match) => match.key}
        ListHeaderComponent={header}
        ListEmptyComponent={
          matches === null ? <ActivityIndicator color={colors.accent} style={styles.spinner} /> : <Text style={styles.empty}>{empty()}</Text>
        }
        contentContainerStyle={[styles.content, tail]}
        keyboardShouldPersistTaps="handled"
        onScrollToIndexFailed={() => undefined}
        renderItem={({ item, index }) => (
          <MatchRow
            match={item}
            now={now}
            reminders={reminders}
            onPress={(channel) => void pressChannel(item, channel)}
            onFocus={() => keepInMiddle(listRef.current, index)}
          />
        )}
      />
    </View>
  );
}

function MatchRow({
  match,
  now,
  reminders,
  onPress,
  onFocus,
}: {
  match: Match;
  now: number;
  reminders: ReadonlySet<string>;
  onPress: (channel: StoredChannel) => void;
  onFocus: () => void;
}) {
  const styles = useStyles(makeStyles);
  const live = match.startMs <= now && now < match.stopMs;
  return (
    <View style={styles.match}>
      <View style={styles.matchHead}>
        <Text style={[styles.when, live && styles.live]}>{whenLabel(match.startMs, match.stopMs, now)}</Text>
        {match.replay && <Text style={styles.tag}>Genudsendelse</Text>}
      </View>
      <Text style={styles.matchTitle} numberOfLines={2}>
        {match.title}
      </Text>
      {match.description !== null && match.description.length > 0 && (
        <Text style={styles.matchDescription} numberOfLines={isTV ? 1 : 2}>
          {match.description}
        </Text>
      )}
      <View style={styles.channels}>
        {match.channels.map((channel) => {
          const reminded = reminders.has(`${channel.id}@${match.startMs}`);
          return (
            <TvPressable key={channel.id} style={styles.channel} onPress={() => onPress(channel)} onFocus={onFocus}>
              <ChannelLogo uris={channel.logoUrls} name={channel.name} memoryKey={channel.id} size={28} />
              <View style={styles.channelText}>
                <Text style={styles.channelName} numberOfLines={1}>
                  {channel.name}
                </Text>
                <Text style={[styles.channelAction, live && styles.live]}>
                  {live ? '▶ Se nu' : reminded ? '🔔 Mindes' : 'Mind mig'}
                </Text>
              </View>
            </TvPressable>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: theme.spacing.md, gap: theme.spacing.sm },
    header: { gap: theme.spacing.sm, marginBottom: theme.spacing.xs },
    title: { color: colors.text, fontSize: 20, fontWeight: '700' },
    input: {
      backgroundColor: colors.surface,
      color: colors.text,
      borderRadius: theme.radius,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      fontSize: 16,
    },
    searchButton: {
      backgroundColor: colors.surface,
      borderRadius: theme.radius,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm + 2,
    },
    searchText: { color: colors.text, fontSize: 16 },
    chips: { gap: theme.spacing.sm, paddingVertical: 2 },
    chip: {
      backgroundColor: colors.surface,
      borderRadius: 999,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.xs + 2,
    },
    chipActive: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.accent },
    chipAction: { backgroundColor: colors.accent },
    chipText: { color: colors.text, fontSize: 14, fontWeight: '600' },
    toggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
      borderRadius: theme.radius,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      gap: theme.spacing.sm,
    },
    toggleText: { color: colors.text, fontSize: 14, flex: 1 },
    toggleValue: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },
    toggleOn: { color: colors.accent },
    status: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
    statusText: { color: colors.textMuted, fontSize: 13 },
    spinner: { marginTop: theme.spacing.lg },
    empty: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginTop: theme.spacing.md },
    match: {
      backgroundColor: colors.surface,
      borderRadius: theme.radius,
      padding: theme.spacing.sm + 2,
      gap: 4,
    },
    matchHead: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
    when: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
    live: { color: colors.danger },
    tag: {
      color: colors.textMuted,
      fontSize: 11,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 4,
      paddingHorizontal: 4,
    },
    matchTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
    matchDescription: { color: colors.textMuted, fontSize: 13 },
    channels: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginTop: 4 },
    channel: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
      backgroundColor: colors.background,
      borderRadius: theme.radius,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      maxWidth: 220,
    },
    channelText: { flexShrink: 1 },
    channelName: { color: colors.text, fontSize: 13, fontWeight: '600' },
    channelAction: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  });
