import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TVFocusGuideView, View } from 'react-native';
import type { VodKind } from '@norstream/core';
import type { AppSession } from '../../session.js';
import type { CountryGroup } from '../../storage/countries.js';
import { getHomeProviders, getTmdbApiKey } from '../../storage/settings.js';
import type { HomeProvider } from '../../storage/settings.js';
import { titlesInPackage } from './serviceMatch.js';
import { setKnownServices } from '../../ui/serviceBadges.js';
import { countVodItemsFiltered, filterGenres, listVodCountryGroups, listVodItemsFiltered } from '../../storage/vod.js';
import type { StoredVodItem, VodFilter, VodSort } from '../../storage/vod.js';
import type { GenreKey } from '../../storage/genres.js';
import { enrichVodMeta } from '../../sync/vodMeta.js';
import { tmdbFetch } from '../../sync/tmdb.js';
import { theme } from '../../ui/theme.js';
import type { ThemeColors } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import { TvTextInput } from '../../ui/TvTextInput.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { refocusLastPressed } from '../../ui/refocus.js';
import { isTV, useCanvasSize } from '../../ui/tv.js';
import { PosterGrid } from './VodScreen.js';
import { SORT_LABELS, defaultVodFilter, loadVodFilter, saveVodFilter, yearChoices, yearLabel } from './vodFilterState.js';

/** Filtre i et fokusfaeldet panel; kataloget forbliver synligt bagved.
 * Valg gemmes lokalt og resultater hentes fra databasen, ikke paa nettet. */
const PAGE = 120;
/** Hvor mange titler der slaas op hos TMDB naar skaermen aabnes, saa udvalget bliver bedre mens man ser paa det. */
const ENRICH_ON_OPEN = 150;

type Panel = 'services' | 'countries' | 'genres' | 'years' | 'sort' | null;

/** Tjeneste-opslagets svar: ingen tjeneste valgt, undervejs, eller panelets noegler. */
type ServiceKeys = null | 'loading' | { keys: string[]; listed: number };

interface Props {
  session: AppSession;
  active: boolean;
  kind: VodKind;
  onOpen: (item: StoredVodItem) => void;
}

export function VodFilterScreen({ session, active, kind, onOpen }: Props) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const [filter, setFilter] = useState<VodFilter | null>(null);
  const [panel, setPanel] = useState<Panel>('genres');
  const [drawer, setDrawer] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchText, setSearchText] = useState('');
  // Home bevarer fanen monteret. En skjult fane maa ikke bevare et native
  // modalvindue, der fanger Tilbage og fokus paa en anden destination.
  useEffect(() => {
    if (active) return;
    setDrawer(false);
    setSearching(false);
  }, [active]);
  const canvas = useCanvasSize();
  function closeDrawer(): void {
    setDrawer(false);
    requestAnimationFrame(() => { refocusLastPressed(); });
  }
  const [countries, setCountries] = useState<CountryGroup[]>([]);
  /** Tjenesterne valgt under Indstillinger (forsidens hylder). */
  const [services, setServices] = useState<HomeProvider[]>([]);
  const [hasTmdbKey, setHasTmdbKey] = useState(true);
  const [serviceKeys, setServiceKeys] = useState<ServiceKeys>(null);
  const [items, setItems] = useState<StoredVodItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const years = useRef(yearChoices()).current;
  const generation = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadVodFilter(session.db, kind), listVodCountryGroups(session.db, kind), getHomeProviders(session.db), getTmdbApiKey(session.db)]).then(
      ([loaded, groups, providers, apiKey]) => {
        if (cancelled) return;
        setFilter(loaded);
        setCountries(groups);
        setServices(providers);
        setKnownServices(providers);
        setHasTmdbKey(apiKey !== null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [session.db, kind]);

  const reload = useCallback(
    async (current: VodFilter, offset: number): Promise<void> => {
      const own = ++generation.current;
      if (offset === 0) setLoading(true);
      const [page, count] = await Promise.all([
        listVodItemsFiltered(session.db, current, PAGE, offset),
        offset === 0 ? countVodItemsFiltered(session.db, current) : Promise.resolve(null),
      ]);
      if (own !== generation.current) return;
      setItems((previous) => (offset === 0 ? page : [...previous, ...page]));
      if (count !== null) setTotal(count);
      setLoading(false);
    },
    [session.db],
  );

  // Tjenester (v368): TMDB's liste over det tjenesten har i Danmark, skaaret
  // ned til pakken. Svaret bliver `keys` paa udvalget; resten af valgene
  // laegges oveni i SQL. Brugeren: "vi skal kun se det vi har."
  const chosen = filter === null ? [] : (filter.providers ?? []);
  const chosenKey = chosen.join(',');
  useEffect(() => {
    if (chosen.length === 0) {
      setServiceKeys(null);
      return;
    }
    let cancelled = false;
    setServiceKeys('loading');
    void (async () => {
      const apiKey = await getTmdbApiKey(session.db);
      const providers = (await getHomeProviders(session.db)).filter((p) => chosen.includes(p.id));
      if (apiKey === null || providers.length === 0) {
        if (!cancelled) setServiceKeys({ keys: [], listed: 0 });
        return;
      }
      const result = await titlesInPackage(session.db, tmdbFetch, apiKey, providers, kind).catch(() => ({ keys: [], listed: 0 }));
      if (!cancelled) setServiceKeys(result);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenKey, kind, session.db]);

  useEffect(() => {
    if (filter === null || serviceKeys === 'loading') return;
    void reload(serviceKeys === null ? { ...filter, keys: undefined } : { ...filter, keys: serviceKeys.keys }, 0);
  }, [filter, serviceKeys, reload]);

  // Genre og aar fra TMDB for de nyeste titler af slagsen, saa udvalget
  // vokser mens skaermen er aaben; gitteret tegnes om naar opslagene er inde.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const apiKey = await getTmdbApiKey(session.db);
      if (apiKey === null || cancelled) return;
      const result = await enrichVodMeta(session.db, tmdbFetch, apiKey, { kind, limit: ENRICH_ON_OPEN }).catch(() => ({ looked: 0, found: 0 }));
      if (cancelled || result.found === 0) return;
      setFilter((current) => (current === null ? current : { ...current }));
    })();
    return () => {
      cancelled = true;
    };
  }, [session.db, kind]);

  function update(next: VodFilter): void {
    setFilter(next);
    void saveVodFilter(session.db, next);
  }

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  if (filter === null) return <ActivityIndicator color={colors.accent} style={styles.spinner} />;

  const countryLabel =
    filter.countries.length === 0
      ? 'Alle lande'
      : filter.countries
          .map((key) => countries.find((c) => c.key === key)?.flag ?? key)
          .join(' ');
  const genreNames = filterGenres();
  const genreLabel =
    filter.genres.length === 0
      ? 'Alle genrer'
      : filter.genres.length <= 2
        ? filter.genres.map((key) => genreNames.find((g) => g.key === key)?.name ?? key).join(', ')
        : `${filter.genres.length} genrer`;

  const serviceLabel =
    chosen.length === 0
      ? 'Alle'
      : chosen.length <= 2
        ? chosen.map((id) => services.find((s) => s.id === id)?.name ?? String(id)).join(', ')
        : `${chosen.length} tjenester`;
  const effective = serviceKeys === null || serviceKeys === 'loading' ? filter : { ...filter, keys: serviceKeys.keys };

  function closeSearch(): void { setSearching(false); requestAnimationFrame(() => { refocusLastPressed(); }); }
  function submitSearch(): void { update({ ...filter!, search: searchText.trim() }); closeSearch(); }

  const activeCount = (filter.search ? 1 : 0) + filter.genres.length + filter.countries.length + chosen.length + (filter.yearFrom !== null || filter.yearTo !== null ? 1 : 0);
  const header = (
    <View>
      <View style={styles.bar}>
        <Toggle horizontal label="Søg" value={filter.search || (kind === 'movie' ? 'Søg efter film' : 'Søg efter serier')} open={false} onPress={() => { setSearchText(filter.search ?? ''); setSearching(true); }} />
        <Toggle horizontal label="Filtre" value={activeCount === 0 ? 'Alle titler' : `${activeCount} valgt`} open={drawer} onPress={() => { setPanel('genres'); setDrawer(true); }} preferFocus={active} />
        <Toggle horizontal label="Sortér" value={SORT_LABELS[filter.sort]} open={false} onPress={() => { setPanel('sort'); setDrawer(true); }} />
      </View>
      <View style={styles.chips}>
        {filter.search && <Chip label={`${filter.search} ×`} selected={false} onPress={() => update({ ...filter, search: undefined })} />}
        {filter.genres.map((key) => <Chip key={key} label={`${genreNames.find((g) => g.key === key)?.name ?? key} ×`} selected={false} onPress={() => update({ ...filter, genres: filter.genres.filter((g) => g !== key) })} />)}
        {(filter.yearFrom !== null || filter.yearTo !== null) && <Chip label={`${yearLabel(filter, years)} ×`} selected={false} onPress={() => update({ ...filter, yearFrom: null, yearTo: null })} />}
        {filter.countries.map((key) => <Chip key={key} label={`${countries.find((c) => c.key === key)?.name ?? key} ×`} selected={false} onPress={() => update({ ...filter, countries: filter.countries.filter((c) => c !== key) })} />)}
        {chosen.map((id) => <Chip key={id} label={`${services.find((p) => p.id === id)?.name ?? id} ×`} selected={false} onPress={() => update({ ...filter, providers: chosen.filter((p) => p !== id) })} />)}
        {activeCount > 0 && <Chip label="Ryd filtre" selected={false} onPress={() => update({ ...defaultVodFilter(kind), sort: filter.sort })} />}
      </View>
      <Text style={styles.count}>{serviceKeys === 'loading' ? 'Tjekker tjenesten mod din pakke …' : loading ? 'Opdaterer udvalg …' : `${total ?? 0} ${kind === 'movie' ? 'film' : 'serier'}`}</Text>
    </View>
  );
  const filterDrawer = (
    <Modal visible={active && drawer} transparent animationType="fade" onRequestClose={closeDrawer}>
      <View style={styles.backdrop}>
        <TVFocusGuideView trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={[styles.drawer, { width: canvas.width >= 700 ? 360 : '100%', maxHeight: canvas.height }]}>
          <Text style={styles.drawerTitle}>Filtre</Text>
          <ScrollView style={styles.drawerScroll} contentContainerStyle={styles.drawerContent}>
        <Toggle label="Genre" value={genreLabel} open={panel === 'genres'} onPress={() => setPanel(panel === 'genres' ? null : 'genres')} preferFocus={true} />
      {panel === 'genres' && (
        <View style={styles.chips}>
          <Chip label="Alle genrer" selected={filter.genres.length === 0} onPress={() => update({ ...filter, genres: [] })} />
          {genreNames.map((genre) => (
            <Chip
              key={genre.key}
              label={genre.name}
              column
              selected={filter.genres.includes(genre.key)}
              onPress={() => update({ ...filter, genres: toggle<GenreKey>(filter.genres, genre.key) })}
            />
          ))}
        </View>
      )}

        <Toggle label="År" value={yearLabel(filter, years)} open={panel === 'years'} onPress={() => setPanel(panel === 'years' ? null : 'years')} preferFocus={false} />
      {panel === 'years' && (
        <View style={styles.chips}>
          {years.map((choice) => (
            <Chip
              key={choice.label}
              label={choice.label}
              column
              selected={filter.yearFrom === choice.from && filter.yearTo === choice.to}
              onPress={() => update({ ...filter, yearFrom: choice.from, yearTo: choice.to })}
            />
          ))}
        </View>
      )}

        <Toggle label="Land i pakken" value={countryLabel} open={panel === 'countries'} onPress={() => setPanel(panel === 'countries' ? null : 'countries')} preferFocus={false} />
      {panel === 'countries' && (
        <View style={styles.chips}>
          <Chip label="Alle lande" selected={filter.countries.length === 0} onPress={() => update({ ...filter, countries: [] })} />
          {countries.map((country) => (
            <Chip
              key={country.key}
              label={`${country.flag} ${country.name}`}
              selected={filter.countries.includes(country.key)}
              onPress={() => update({ ...filter, countries: toggle(filter.countries, country.key) })}
            />
          ))}
        </View>
      )}

        <Toggle label="Tjeneste" value={serviceLabel} open={panel === 'services'} onPress={() => setPanel(panel === 'services' ? null : 'services')} preferFocus={false} />
      {panel === 'services' && (
        <View style={styles.chips}>
          <Chip label="Alle" selected={chosen.length === 0} onPress={() => update({ ...filter, providers: [] })} />
          {services.map((service) => (
            <Chip
              key={service.id}
              label={service.name}
              selected={chosen.includes(service.id)}
              onPress={() => update({ ...filter, providers: toggle(chosen, service.id) })}
            />
          ))}
          {services.length === 0 && <Text style={styles.hint}>Vælg tjenester under Indstillinger → Forsiden (Netflix, Prime Video …), så kan de vælges her.</Text>}
          {services.length > 0 && !hasTmdbKey && <Text style={styles.hint}>Kræver en TMDB-nøgle under Indstillinger.</Text>}
        </View>
      )}

        <Toggle label="Sortér" value={SORT_LABELS[filter.sort]} open={panel === 'sort'} onPress={() => setPanel(panel === 'sort' ? null : 'sort')} preferFocus={false} />
      {panel === 'sort' && (
        <View style={styles.chips}>
          {(Object.keys(SORT_LABELS) as VodSort[]).map((sort) => (
            <Chip key={sort} label={SORT_LABELS[sort]} selected={filter.sort === sort} onPress={() => update({ ...filter, sort })} />
          ))}
        </View>
      )}

            <Text style={styles.hint}>Genre kommer fra validerede filmdata, ellers filmens egne detaljer. Land følger din pakkes grupper.</Text>
          </ScrollView>
          <View style={styles.drawerFooter}>
            <Chip label={loading || serviceKeys === 'loading' ? 'Vis udvalg' : `Vis ${total ?? 0} ${kind === 'movie' ? 'film' : 'serier'}`} selected onPress={closeDrawer} />
            <Chip label="Ryd alle filtre" selected={false} onPress={() => update({ ...defaultVodFilter(kind), sort: filter.sort })} />
          </View>
        </TVFocusGuideView>
      </View>
    </Modal>
  );

  const footer =
    total !== null && items.length < total ? (
      <TvPressable style={styles.more} onPress={() => void reload(effective, items.length)}>
        <Text style={styles.moreText}>Vis flere ({total - items.length} til)</Text>
      </TvPressable>
    ) : null;

  return (
    <View style={styles.container}>
      {filterDrawer}
      <Modal visible={active && searching} transparent animationType="fade" onRequestClose={closeSearch}>
        <View style={styles.backdrop}>
          <TVFocusGuideView trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={[styles.drawer, { width: canvas.width >= 700 ? 360 : '100%', maxHeight: canvas.height }]}>
            <Text style={styles.drawerTitle}>Søg i udvalget</Text>
            <View style={styles.drawerContent}>
              <TvTextInput style={styles.searchInput} autoFocus value={searchText} onChangeText={setSearchText} onSubmitEditing={submitSearch}
                placeholder={kind === 'movie' ? 'Filmtitel' : 'Serietitel'} returnKeyType="search" autoCorrect={false} />
              <Chip label="Søg" selected onPress={submitSearch} />
              <Chip label="Ryd søgning" selected={false} onPress={() => { update({ ...filter, search: undefined }); closeSearch(); }} />
            </View>
          </TVFocusGuideView>
        </View>
      </Modal>
      {loading && items.length === 0 ? (
        <View>
          {header}
          <ActivityIndicator color={colors.accent} style={styles.spinner} />
        </View>
      ) : (
        <PosterGrid
          items={items}
          onOpen={onOpen}
          emptyText={serviceKeys !== null && serviceKeys !== 'loading' && serviceKeys.keys.length === 0 ? 'Ingen af tjenestens titler er i din pakke endnu.' : 'Ingen titler matcher udvalget.'}
          header={header}
          footer={footer}
        />
      )}
    </View>
  );
}

function Toggle({ label, value, open, onPress, preferFocus = false, horizontal = false }: { label: string; value: string; open: boolean; onPress: () => void; preferFocus?: boolean; horizontal?: boolean }) {
  const styles = useStyles(makeStyles);
  return (
    <TvPressable style={[styles.toggle, horizontal && styles.horizontalToggle, open && styles.toggleOpen]} onPress={onPress} hasTVPreferredFocus={isTV && preferFocus}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Text style={styles.toggleValue} numberOfLines={1}>
        {value}
      </Text>
    </TvPressable>
  );
}

function Chip({ label, selected, onPress, column = false }: { label: string; selected: boolean; onPress: () => void; column?: boolean }) {
  const styles = useStyles(makeStyles);
  return (
    <TvPressable style={[styles.chip, column && styles.chipColumn, selected && styles.chipSelected]} onPress={onPress} accessibilityRole={column ? 'checkbox' : 'button'} accessibilityState={column ? { checked: selected } : undefined} flat>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{selected ? `✓ ${label}` : label}</Text>
    </TvPressable>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1 },
    backdrop: { flex: 1, alignItems: 'flex-end', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
    drawer: { height: '100%', backgroundColor: colors.background, paddingVertical: 12, borderLeftWidth: 1, borderColor: colors.border },
    searchInput: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: theme.radius, padding: 12, fontSize: 16 },
    drawerTitle: { color: colors.text, fontSize: 22, fontWeight: '700', paddingHorizontal: 16, marginBottom: 10 },
    drawerScroll: { flex: 1 },
    drawerContent: { paddingHorizontal: 12, gap: 10, paddingBottom: 12 },
    drawerFooter: { gap: 8, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1, borderColor: colors.border },
    spinner: { marginTop: theme.spacing.xl },
    bar: { flexDirection: 'row', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md, marginBottom: theme.spacing.sm },
    toggle: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: theme.radius,
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.sm + 2,
    },
    horizontalToggle: { flex: 1, minWidth: 0 },
    toggleOpen: { borderColor: colors.accent },
    toggleLabel: { color: colors.textMuted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
    toggleValue: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 2 },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      paddingBottom: theme.spacing.sm,
    },
    chip: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 999,
      paddingVertical: 6,
      paddingHorizontal: theme.spacing.md,
    },
    chipColumn: { flexBasis: '46%', borderRadius: theme.radius, minHeight: 38, justifyContent: 'center' },
    chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.text, fontSize: 14 },
    chipTextSelected: { color: '#fff', fontWeight: '700' },
    count: { color: colors.textMuted, fontSize: 12, paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.xs },
    hint: { color: colors.textMuted, fontSize: 13, width: '100%', paddingVertical: theme.spacing.xs },
    more: {
      alignSelf: 'center',
      marginVertical: theme.spacing.lg,
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: theme.radius,
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.lg,
    },
    moreText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  });
