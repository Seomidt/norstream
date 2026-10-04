import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
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
import { TvPressable } from '../../ui/TvPressable.js';
import { isTV } from '../../ui/tv.js';
import { PosterGrid } from './VodScreen.js';
import { SORT_LABELS, loadVodFilter, saveVodFilter, yearChoices, yearLabel } from './vodFilterState.js';

/**
 * Udvalg under Film/Serier (v367): lande, genrer, aar og sortering paa én
 * gang, "thriller · 2026 · DK + UK + US" paa fire tryk.
 *
 * Fire knapper oeverst viser det valgte; et tryk aabner raekken af valg
 * nedenunder (én aaben ad gangen), og gitteret under den tegnes om med det
 * samme. Lande og genrer kan vaelges flere af; aar og sortering ét. Valget
 * huskes. Paa tv er alle valg TvPressables i en ombrudt raekke, saa
 * fjernbetjeningen kommer rundt uden lister inde i lister.
 */
const PAGE = 120;
/** Hvor mange titler der slaas op hos TMDB naar skaermen aabnes, saa udvalget bliver bedre mens man ser paa det. */
const ENRICH_ON_OPEN = 150;

type Panel = 'services' | 'countries' | 'genres' | 'years' | 'sort' | null;

/** Tjeneste-opslagets svar: ingen tjeneste valgt, undervejs, eller panelets noegler. */
type ServiceKeys = null | 'loading' | { keys: string[]; listed: number };

interface Props {
  session: AppSession;
  kind: VodKind;
  onOpen: (item: StoredVodItem) => void;
}

export function VodFilterScreen({ session, kind, onOpen }: Props) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const [filter, setFilter] = useState<VodFilter | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
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

  const header = (
    <View>
      <View style={styles.bar}>
        <Toggle label="Tjeneste" value={serviceLabel} open={panel === 'services'} onPress={() => setPanel(panel === 'services' ? null : 'services')} preferFocus />
        <Toggle label="Land" value={countryLabel} open={panel === 'countries'} onPress={() => setPanel(panel === 'countries' ? null : 'countries')} />
        <Toggle label="Genre" value={genreLabel} open={panel === 'genres'} onPress={() => setPanel(panel === 'genres' ? null : 'genres')} />
        <Toggle label="År" value={yearLabel(filter, years)} open={panel === 'years'} onPress={() => setPanel(panel === 'years' ? null : 'years')} />
        <Toggle label="Sortér" value={SORT_LABELS[filter.sort]} open={panel === 'sort'} onPress={() => setPanel(panel === 'sort' ? null : 'sort')} />
      </View>
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
      {panel === 'genres' && (
        <View style={styles.chips}>
          <Chip label="Alle genrer" selected={filter.genres.length === 0} onPress={() => update({ ...filter, genres: [] })} />
          {genreNames.map((genre) => (
            <Chip
              key={genre.key}
              label={genre.name}
              selected={filter.genres.includes(genre.key)}
              onPress={() => update({ ...filter, genres: toggle<GenreKey>(filter.genres, genre.key) })}
            />
          ))}
        </View>
      )}
      {panel === 'years' && (
        <View style={styles.chips}>
          {years.map((choice) => (
            <Chip
              key={choice.label}
              label={choice.label}
              selected={filter.yearFrom === choice.from && filter.yearTo === choice.to}
              onPress={() => update({ ...filter, yearFrom: choice.from, yearTo: choice.to })}
            />
          ))}
        </View>
      )}
      {panel === 'sort' && (
        <View style={styles.chips}>
          {(Object.keys(SORT_LABELS) as VodSort[]).map((sort) => (
            <Chip key={sort} label={SORT_LABELS[sort]} selected={filter.sort === sort} onPress={() => update({ ...filter, sort })} />
          ))}
        </View>
      )}
      <Text style={styles.count}>
        {serviceKeys === 'loading'
          ? 'Slår tjenesten op og tjekker mod din pakke …'
          : total === null
            ? ' '
            : `${total} ${kind === 'movie' ? 'film' : total === 1 ? 'serie' : 'serier'}${
                serviceKeys !== null ? ` i din pakke af ${serviceKeys.listed} på tjenestens liste` : ''
              }`}
        {filter.genres.length > 0 && serviceKeys !== 'loading' ? ' · genren kendes fra kategorien, TMDB og panelets detaljer; flere kommer til efterhånden' : ''}
      </Text>
    </View>
  );

  const footer =
    total !== null && items.length < total ? (
      <TvPressable style={styles.more} onPress={() => void reload(effective, items.length)}>
        <Text style={styles.moreText}>Vis flere ({total - items.length} til)</Text>
      </TvPressable>
    ) : null;

  return (
    <View style={styles.container}>
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

function Toggle({ label, value, open, onPress, preferFocus = false }: { label: string; value: string; open: boolean; onPress: () => void; preferFocus?: boolean }) {
  const styles = useStyles(makeStyles);
  return (
    <TvPressable style={[styles.toggle, open && styles.toggleOpen]} onPress={onPress} hasTVPreferredFocus={isTV && preferFocus}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Text style={styles.toggleValue} numberOfLines={1}>
        {value}
      </Text>
    </TvPressable>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  return (
    <TvPressable style={[styles.chip, selected && styles.chipSelected]} onPress={onPress} flat>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{selected ? `✓ ${label}` : label}</Text>
    </TvPressable>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1 },
    spinner: { marginTop: theme.spacing.xl },
    bar: { flexDirection: 'row', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md, marginBottom: theme.spacing.sm },
    toggle: {
      flex: 1,
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: theme.radius,
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.sm + 2,
    },
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
