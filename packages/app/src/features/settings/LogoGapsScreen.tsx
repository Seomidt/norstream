import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AppSession } from '../../session.js';
import { forgetLogoSearches, listChannelsWithoutArchiveLogo } from '../../storage/logoOverrides.js';
import type { ChannelWithoutLogo } from '../../storage/logoOverrides.js';
import { getGoogleSearchKeys } from '../../storage/settings.js';
import { replaceLogo, resetLogo } from '../../ui/logoCache.js';
import { theme } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { autoSearchLogos } from './logoAutoSearch.js';
import type { AutoSearchHandle, AutoSearchProgress } from './logoAutoSearch.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { keepInMiddle, useTvListTail } from '../../ui/tvScroll.js';
import { isTV } from '../../ui/tv.js';

interface Props {
  session: AppSession;
  onBack: () => void;
  onPick: (channelKey: string) => void;
  /** Aendres naar et logo er valgt, saa listen tegnes igen. */
  reloadToken: number;
  /** Kaldes naar den automatiske soegning har givet kanaler et logo. */
  onChanged: () => void;
}

/** Hvor mange kanaler den automatiske soegning tager med paa ét tryk. */
const AUTO_SEARCH_LIMIT = 2_000;

const SEARCH_DEBOUNCE_MS = 200;

/**
 * Kanalerne der staar uden logo fra nogen af arkiverne — favoritterne
 * foerst. Ét tryk aabner valget. Listen bliver kortere for hver kanal man
 * giver et logo.
 */
export function LogoGapsScreen({ session, onBack, onPick, reloadToken, onChanged }: Props) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const tail = useTvListTail();
  const listRef = useRef<FlatList<ChannelWithoutLogo>>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<ChannelWithoutLogo[] | null>(null);
  const [progress, setProgress] = useState<AutoSearchProgress | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  /** Hvor mange sidste soegning sprang over; giver knappen til at proeve dem igen. */
  const [skipped, setSkipped] = useState(0);
  const running = useRef<AutoSearchHandle | null>(null);

  // Lukkes skaermen midt i det, standser soegningen; det der er fundet, er gemt.
  useEffect(() => () => running.current?.cancel(), []);

  async function searchAll(): Promise<void> {
    if (running.current !== null) return;
    setSummary(null);
    const [all, google] = await Promise.all([
      listChannelsWithoutArchiveLogo(session.db, { favouritesOnly: true, limit: AUTO_SEARCH_LIMIT }),
      getGoogleSearchKeys(session.db),
    ]);
    const handle = autoSearchLogos(
      { db: session.db, google, replaceLogo, resetLogo },
      all,
      (p) => {
        setProgress(p);
        // Listen tegnes om undervejs, saa man ser kanalerne forsvinde.
        if (p.found > 0 && p.done % 5 === 0) void load();
      },
    );
    running.current = handle;
    const result = await handle.result;
    running.current = null;
    setProgress(null);
    setSkipped(result.skipped);
    setSummary(
      result.tried === 0 && result.skipped > 0
        ? `Ingen undersøgt: alle ${result.skipped} blev sprunget over, fordi de blev søgt for nylig uden held. Tryk nedenfor for at prøve dem igen.`
        : `Fandt ${result.found} logo${result.found === 1 ? '' : 'er'} til ${result.tried} undersøgt${result.tried === 1 ? '' : 'e'}.` +
            (result.withBids > result.found
              ? ` Nettet havde et bud til ${result.withBids - result.found} mere, men billedet kunne ikke hentes.`
              : '') +
            (result.found === 0 && result.problem !== null ? ` Sidste fejl fra nettet: ${result.problem}.` : '') +
            (result.skipped > 0 ? ` ${result.skipped} blev sprunget over, søgt for nylig.` : ''),
    );
    if (result.found > 0) onChanged();
    void load();
  }

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async (): Promise<void> => {
    setRows(await listChannelsWithoutArchiveLogo(session.db, { favouritesOnly: true, search: query, limit: 300 }));
  }, [session.db, query]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  return (
    <View style={styles.container}>
      <TvPressable style={styles.crumb} focusable={!isTV} onPress={onBack} hitSlop={8}>
        <Text style={styles.crumbBack}>‹</Text>
        <Text style={styles.crumbLabel}>Favoritter uden logo</Text>
      </TvPressable>
      <Text style={styles.hint}>
        Dine favoritter, som ingen af arkiverne kender et logo til. Tryk på en kanal for at
        vælge et logo selv, eller lad appen søge på nettet efter dem alle.
      </Text>
      {progress === null ? (
        <TvPressable
          style={styles.button}
          // Paa tv lander fjernbetjeningen paa den primaere handling naar
          // skaermen aabner, saa man ikke skal lede efter et startpunkt.
          hasTVPreferredFocus={isTV}
          onPress={() => {
            void searchAll();
          }}
        >
          <Text style={styles.buttonText}>Søg logoer på nettet til favoritterne</Text>
        </TvPressable>
      ) : (
        <View style={styles.progress}>
          <ActivityIndicator color={colors.accent} />
          <View style={styles.progressText}>
            <Text style={styles.progressLine}>
              {progress.done} af {progress.total} · {progress.found} fundet
            </Text>
            <Text style={styles.progressCurrent} numberOfLines={1}>
              {progress.current}
            </Text>
          </View>
          <TvPressable hitSlop={8} onPress={() => running.current?.cancel()}>
            <Text style={styles.stop}>Stop</Text>
          </TvPressable>
        </View>
      )}
      {summary !== null && <Text style={styles.summary}>{summary}</Text>}
      {summary !== null && skipped > 0 && progress === null && (
        <TvPressable
          style={styles.retry}
          onPress={() => {
            void forgetLogoSearches(session.db).then(() => searchAll());
          }}
        >
          <Text style={styles.retryText}>Prøv de {skipped} oversprungne igen</Text>
        </TvPressable>
      )}
      <TextInput
        style={styles.input}
        value={search}
        onChangeText={setSearch}
        placeholder="Søg"
        placeholderTextColor={colors.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
      />
      <FlatList
        removeClippedSubviews={false}
        ref={listRef}
        data={rows ?? []}
        keyExtractor={(row) => row.id}
        contentContainerStyle={tail}
        onScrollToIndexFailed={() => undefined}
        ListEmptyComponent={
          <Text style={styles.hint}>
            {rows === null ? 'Tæller …' : 'Ingen — alle dine favoritter har et logo fra et arkiv eller dit eget valg.'}
          </Text>
        }
        renderItem={({ item, index }) => (
          <TvPressable
            style={styles.row}
            onFocus={isTV ? () => keepInMiddle(listRef.current, index) : undefined}
            onPress={() => onPick(item.id)}
          >
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </TvPressable>
        )}
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  crumb: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  crumbBack: { color: colors.accent, fontSize: 26, marginRight: theme.spacing.sm },
  crumbLabel: { color: colors.text, fontSize: 17, fontWeight: '700' },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18, paddingHorizontal: theme.spacing.md, marginBottom: theme.spacing.sm },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    color: colors.text,
    padding: theme.spacing.sm + 2,
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    fontSize: 15,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 4,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: theme.radius,
    padding: theme.spacing.sm + 2,
    alignItems: 'center',
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  buttonText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  progress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    padding: theme.spacing.sm,
    borderRadius: theme.radius,
    backgroundColor: colors.surface,
  },
  progressText: { flex: 1 },
  progressLine: { color: colors.text, fontSize: 14, fontWeight: '600' },
  progressCurrent: { color: colors.textMuted, fontSize: 12 },
  stop: { color: colors.danger, fontSize: 15, fontWeight: '600' },
  summary: { color: colors.accent, fontSize: 13, paddingHorizontal: theme.spacing.md, marginBottom: theme.spacing.sm },
  retry: { paddingHorizontal: theme.spacing.md, marginBottom: theme.spacing.sm },
  retryText: { color: colors.text, fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
  star: { color: colors.accent, width: 20, fontSize: 14 },
  name: { flex: 1, color: colors.text, fontSize: 15 },
  chevron: { color: colors.textMuted, fontSize: 22 },
});
