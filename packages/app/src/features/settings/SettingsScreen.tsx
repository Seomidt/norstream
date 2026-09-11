import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { deriveCountry } from '@norstream/core';
import type { AppSession } from '../../session.js';
import { vodCounts } from '../../storage/vod.js';
import { countRadioChannels } from '../../storage/channels.js';
import { createBackup, parseBackup, restoreBackup, serialiseBackup } from '../../storage/backup.js';
import { forgetLogoMisses, resetLogo } from '../../ui/logoCache.js';
import { setPosterApiKey } from '../../ui/posterFill.js';
import { readChosenBackupFile, saveBackupToChosenFolder } from './backupFiles.js';
import { listHiddenCountries, unhideCountry } from '../../storage/countries.js';
import { OTHER_COUNTRY_KEY } from '../../storage/countries.js';
import { clearSourceCredentials } from '../../storage/credentials.js';
import { deleteSource, listSources } from '../../storage/sources.js';
import {
  clearLastSyncMs,
  getGoogleSearchFields,
  getSetting,
  getHomeProviders,
  getStreamFormatSetting,
  getVideoSurface,
  setVideoSurface,
  getSubtitlePreference,
  getTmdbApiKey,
  getYoutubeApiKey,
  setGoogleSearchCx,
  setGoogleSearchKey,
  setHomeProviders,
  setSubtitlePreference,
  setTmdbApiKey,
  setYoutubeApiKey,
  setMiniPreviewEnabled,
  setStreamFormatSetting,
  getThemeMode,
  getThemePlace,
  setThemeMode,
  setThemePlace,
} from '../../storage/settings.js';
import type { HomeProvider, StreamFormatSetting, SubtitlePreference, VideoSurface } from '../../storage/settings.js';
import { tmdbFetch } from '../../sync/tmdb.js';
import { PLACES, THEME_MODES, setThemePreference, themePreference } from '../../ui/themeMode.js';
import type { ThemeMode } from '../../ui/themeMode.js';
import { listTmdbProvidersWithUk } from '../../sync/tmdbHome.js';
import { applyStreamFormatSetting, applyVideoSurfaceSetting } from '../player/format.js';
import { theme } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { isTV } from '../../ui/tv.js';
import { TvPressable } from '../../ui/TvPressable.js';

interface Props {
  session: AppSession;
  /** Henter kanaler, film og serier forfra. Paa tv er det den eneste vej: der er intet traek-ned. */
  onRefresh: () => void;
  /** Sand mens hentningen koerer; naar den slutter, laeses tallene igen. */
  refreshing: boolean;
  onOpenSources: () => void;
  /** Aabner listen over kanaler uden logo, hvor man kan vaelge selv. */
  onOpenLogos: () => void;
  /** Aabner maalingen af vejen til panelet. */
  onOpenCheck: () => void;
  previewEnabled: boolean;
  onPreviewEnabledChange: (enabled: boolean) => void;
  onSignedOut: (notice: string) => void;
  /** En sikkerhedskopi er lagt ind: favoritter, logoer og indstillinger skal laeses igen. */
  onRestored: () => void;
}

const SIGNED_OUT_MESSAGE = 'Du er logget ud. Log ind igen for at fortsætte.';

const THEME_LABELS: Record<ThemeMode, string> = {
  sun: 'Følg solen',
  system: 'Følg telefonen',
  dark: 'Mørk',
  light: 'Lys',
};

const SUBTITLE_CHOICES: readonly { value: SubtitlePreference; label: string }[] = [
  { value: 'auto', label: 'Telefonens sprog' },
  { value: 'da', label: 'Dansk' },
  { value: 'en', label: 'Engelsk' },
  { value: 'sv', label: 'Svensk' },
  { value: 'no', label: 'Norsk' },
  { value: 'de', label: 'Tysk' },
  { value: 'off', label: 'Ingen' },
];

const VIDEO_SURFACES: readonly { value: VideoSurface; label: string }[] = [
  { value: 'surface', label: 'Standard' },
  { value: 'texture', label: 'Alternativ' },
];

const STREAM_FORMATS: readonly { value: StreamFormatSetting; label: string }[] = [
  { value: 'auto', label: 'Automatisk' },
  { value: 'ts', label: 'TS' },
  { value: 'm3u8', label: 'HLS' },
];

export function SettingsScreen({
  session,
  onRefresh,
  refreshing,
  onOpenSources,
  onOpenLogos,
  onOpenCheck,
  previewEnabled,
  onPreviewEnabledChange,
  onSignedOut,
  onRestored,
}: Props) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const [hidden, setHidden] = useState<string[]>([]);
  // Bekraeftelsen ligger i skaermen, ikke i en Alert: react-native-web
  // implementerer ikke Alert, saa udlogning ville doe stille paa web.
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [streamFormat, setStreamFormat] = useState<StreamFormatSetting>('auto');
  const [vod, setVod] = useState<{ movies: number; series: number } | null>(null);
  /** Hvad der gik galt sidst film og serier blev hentet, per kilde. Tom naar det gik godt. */
  const [vodErrors, setVodErrors] = useState<string[]>([]);
  const [radio, setRadio] = useState<number | null>(null);
  /** Brugerens egen noegle til YouTubes Data API, til at soege efter trailere. */
  const [youtubeKey, setYoutubeKey] = useState('');
  /** Brugerens egen noegle til TMDB, til plakater panelet ikke gav. */
  const [tmdbKey, setTmdbKey] = useState('');
  /** Noegle og soegemaskine-id til Googles billedsoegning, til logoer. */
  const [googleKey, setGoogleKey] = useState('');
  const [googleCx, setGoogleCx] = useState('');
  const [subtitles, setSubtitles] = useState<SubtitlePreference>('auto');
  /** Tjenesterne forsiden viser hylder for, og dem TMDB kender i landet. */
  const [chosenProviders, setChosenProviders] = useState<HomeProvider[]>([]);
  const [providers, setProviders] = useState<HomeProvider[] | null>(null);
  const [providerSearch, setProviderSearch] = useState('');
  /** Hvad sidste sikkerhedskopiering eller gendannelse endte med. */
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [providersOpen, setProvidersOpen] = useState(false);
  const [videoSurface, setVideoSurfaceState] = useState<VideoSurface>('surface');
  const [themeMode, setThemeModeState] = useState<ThemeMode>(themePreference().mode);
  const [themePlace, setThemePlaceState] = useState(themePreference().placeKey);

  const load = useCallback(async (): Promise<void> => {
    const [hiddenCountries, format, key, tmdb, preferredSubtitles, counts, google] = await Promise.all([
      listHiddenCountries(session.db),
      getStreamFormatSetting(session.db),
      getYoutubeApiKey(session.db),
      getTmdbApiKey(session.db),
      getSubtitlePreference(session.db),
      vodCounts(session.db),
      getGoogleSearchFields(session.db),
    ]);
    setGoogleKey(google.key);
    setGoogleCx(google.cx);
    setChosenProviders(await getHomeProviders(session.db));
    setHidden(hiddenCountries);
    setStreamFormat(format);
    setYoutubeKey(key ?? '');
    setTmdbKey(tmdb ?? '');
    setPosterApiKey(tmdb);
    setSubtitles(preferredSubtitles);
    setVod(counts);
    setThemeModeState(await getThemeMode(session.db));
    const surface = await getVideoSurface(session.db);
    setVideoSurfaceState(surface);
    applyVideoSurfaceSetting(surface);
    setThemePlaceState((await getThemePlace(session.db)) ?? themePreference().placeKey);
    setRadio(await countRadioChannels(session.db));
    const errors: string[] = [];
    for (const access of session.sources) {
      const error = await getSetting(session.db, `last_vod_error:${access.source.id}`);
      if (error !== null && error.length > 0) errors.push(`${access.source.name}: ${error}`);
    }
    setVodErrors(errors);
  }, [session.db, session.sources]);

  useEffect(() => {
    void load();
  }, [load]);

  // Hentningen er slut: tallene og en eventuel fejl skal staa her med det
  // samme, ikke foerst naeste gang siden aabnes.
  const wasRefreshing = useRef(false);
  useEffect(() => {
    if (wasRefreshing.current && !refreshing) void load();
    wasRefreshing.current = refreshing;
  }, [refreshing, load]);

  // Tjenesterne i landet hentes naar der er en noegle, og igen naar den skiftes.
  useEffect(() => {
    if (tmdbKey.trim().length === 0) {
      setProviders(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void listTmdbProvidersWithUk(tmdbFetch, tmdbKey).then((list) => {
        if (!cancelled) setProviders(list);
      });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tmdbKey]);

  async function toggleProvider(provider: HomeProvider): Promise<void> {
    const next = chosenProviders.some((entry) => entry.id === provider.id)
      ? chosenProviders.filter((entry) => entry.id !== provider.id)
      : [...chosenProviders, provider];
    setChosenProviders(next);
    await setHomeProviders(session.db, next);
  }

  async function saveBackup(): Promise<void> {
    setBackupBusy(true);
    try {
      const json = serialiseBackup(await createBackup(session.db));
      const saved = await saveBackupToChosenFolder(json);
      setBackupMessage(saved ? 'Sikkerhedskopien er gemt i den valgte mappe.' : null);
    } catch {
      setBackupMessage('Sikkerhedskopien kunne ikke gemmes.');
    } finally {
      setBackupBusy(false);
    }
  }

  async function restoreFromFile(): Promise<void> {
    setBackupBusy(true);
    try {
      const text = await readChosenBackupFile();
      if (text === null) return;
      const result = await restoreBackup(session.db, parseBackup(text));
      // De valgte logoer hentes om, saa filen paa telefonen er den valgte.
      for (const key of result.overrideKeys) await resetLogo(key);
      await forgetLogoMisses();
      await load();
      onRestored();
      const parts = [
        `${result.favorites} favoritter`,
        `${result.logoOverrides} egne logoer`,
        `${result.settings} indstillinger`,
      ];
      const missing =
        result.missingSources.length === 0
          ? ''
          : ` Kilden ${result.missingSources.join(', ')} findes ikke her, så dens favoritter blev sprunget over — log ind på den først, og gendan igen.`;
      setBackupMessage(`Gendannet: ${parts.join(', ')}.${missing}`);
    } catch (cause) {
      setBackupMessage(cause instanceof Error ? cause.message : 'Filen kunne ikke læses.');
    } finally {
      setBackupBusy(false);
    }
  }

  function chooseVideoSurface(value: VideoSurface): void {
    setVideoSurfaceState(value);
    applyVideoSurfaceSetting(value);
    void setVideoSurface(session.db, value);
  }

  function chooseTheme(mode: ThemeMode): void {
    setThemeModeState(mode);
    setThemePreference({ mode });
    void setThemeMode(session.db, mode);
  }

  function choosePlace(key: string): void {
    setThemePlaceState(key);
    setThemePreference({ placeKey: key });
    void setThemePlace(session.db, key);
  }

  async function chooseSubtitles(value: SubtitlePreference): Promise<void> {
    setSubtitles(value);
    await setSubtitlePreference(session.db, value);
  }

  async function togglePreview(enabled: boolean): Promise<void> {
    await setMiniPreviewEnabled(session.db, enabled);
    onPreviewEnabledChange(enabled);
  }

  async function chooseStreamFormat(value: StreamFormatSetting): Promise<void> {
    await setStreamFormatSetting(session.db, value);
    applyStreamFormatSetting(value);
    setStreamFormat(value);
  }

  async function signOut(): Promise<void> {
    // Rydder credentials **og** tidspunktet for sidste synkronisering. Uden
    // det sidste ville et nyt panel vise det gamles kanaler i op til et doegn,
    // fordi kanal-synken springes over naar last_sync_ms er frisk.
    const sources = await listSources(session.db);
    const results = await Promise.allSettled([
      ...sources.map((source) => clearSourceCredentials(source.id)),
      ...sources.map((source) => deleteSource(session.db, source.id)),
      clearLastSyncMs(session.db),
    ]);
    // En fejlende keychain-sletning maa ikke afbryde udlogningen stille: vi
    // logger brugeren ud uanset, men siger det hvis noget ikke lykkedes.
    const failed = results.some((result) => result.status === 'rejected');
    onSignedOut(
      failed
        ? 'Du er logget ud, men noget kunne ikke ryddes fra enheden. Log ind igen.'
        : SIGNED_OUT_MESSAGE,
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Forhåndsvisning</Text>
      {/* Hele raekken kan trykkes: paa tv kan fjernbetjeningen ikke lande
          paa en Switch, og saa kunne den hverken naas eller rulles til. */}
      <TvPressable style={styles.row} onPress={() => void togglePreview(!previewEnabled)}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Vis kanalen mens du bladrer</Text>
          <Text style={styles.rowHint}>
            Panelet tillader kun én forbindelse ad gangen. Slå fra, hvis
            afspilningen driller.
          </Text>
        </View>
        <Switch
          value={previewEnabled}
          focusable={false}
          onValueChange={(value) => {
            void togglePreview(value);
          }}
          trackColor={{ true: colors.accent, false: colors.border }}
        />
      </TvPressable>

      <Text style={styles.sectionTitle}>Kilder</Text>
      <TvPressable style={styles.row} disabled={refreshing} onPress={onRefresh}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Hent kanaler, film og serier nu</Text>
          <Text style={styles.rowHint}>
            {refreshing
              ? 'Henter fra panelet. Tallene nedenfor opdateres, når det er færdigt.'
              : isTV
                ? 'Henter alt forfra fra panelet. Tager et par minutter på et stort panel.'
                : 'Samme som at trække ned under Kanaler.'}
          </Text>
        </View>
        <Text style={styles.actionText}>{refreshing ? 'Henter…' : 'Hent'}</Text>
      </TvPressable>
      <TvPressable style={styles.row} onPress={onOpenSources}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Paneler og M3U-lister</Text>
          <Text style={styles.rowHint}>
            Tilføj flere udbydere. Kanalerne står side om side, og favoritter
            kan blandes på tværs.
          </Text>
        </View>
        <Text style={styles.actionText}>Åbn</Text>
      </TvPressable>
      <TvPressable style={styles.row} onPress={onOpenCheck}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Tjek forbindelsen til panelet</Text>
          <Text style={styles.rowHint}>
            {isTV
              ? 'Målingen siger om det er navnet, adressen eller panelet, der afviser.'
              : 'Virker appen på mobildata men ikke på Wi-Fi? Målingen siger om det er navnet, adressen eller panelet, der afviser.'}
          </Text>
        </View>
        <Text style={styles.actionText}>Åbn</Text>
      </TvPressable>
      {/* Tallet siger om film og serier faktisk kom med ved sidste hentning —
          det eneste sted man kan se det uden at gaa ind paa fanen. */}
      <Text style={styles.hint}>
        {vod === null
          ? ''
          : vod.movies + vod.series === 0
            ? 'Ingen film eller serier hentet endnu. Tryk på "Hent" ovenfor, eller vent til næste gang kanalerne opdateres.'
            : `${vod.movies} film og ${vod.series} serier hentet fra dine kilder.`}
        {radio === null ? '' : ` ${radio} kanaler ser ud til at være radio (kategori eller navn med "radio").`}
      </Text>
      {vodErrors.length > 0 && (
        <Text style={styles.hint}>Sidste hentning af film og serier fejlede. {vodErrors.join(' · ')}</Text>
      )}

      {/* Ikke paa tv: logoer vaelges ikke fra sofaen, og noeglerne tastes paa telefonen. */}
      {!isTV && (
        <>
      <Text style={styles.sectionTitle}>Kanallogoer</Text>
      <TvPressable style={styles.row} onPress={onOpenLogos}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Kanaler uden logo</Text>
          <Text style={styles.rowHint}>
            Logoerne hentes selv, én gang, og gemmes på telefonen. Dem arkiverne ikke kender, kan
            appen søge efter på nettet, alle på én gang — eller du vælger selv. Du kan også holde
            fingeren på en kanal i listerne.
          </Text>
        </View>
        <Text style={styles.actionText}>Åbn</Text>
      </TvPressable>
      <Text style={styles.hint}>
        Søgningen bruger Wikidata, som er gratis og uden nøgle. Vil du også have Googles
        billedsøgning med, laves en nøgle og en søgemaskine (cx) i Google Cloud Console under
        "Custom Search JSON API" og programmablesearchengine.google.com. Begge felter skal
        udfyldes.
      </Text>
      <TextInput
        style={styles.input}
        value={googleKey}
        onChangeText={(value) => {
          setGoogleKey(value);
          void setGoogleSearchKey(session.db, value);
        }}
        placeholder="Google API-nøgle (valgfri)"
        placeholderTextColor={colors.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        value={googleCx}
        onChangeText={(value) => {
          setGoogleCx(value);
          void setGoogleSearchCx(session.db, value);
        }}
        placeholder="Søgemaskinens id, cx (valgfri)"
        placeholderTextColor={colors.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
      />

        </>
      )}

      <Text style={styles.sectionTitle}>Tema</Text>
      <Text style={styles.hint}>
        Følg solen: lyst fra solopgang til solnedgang, mørkt når det er mørkt udenfor, så
        skærmen ikke trætter øjnene om aftenen.
      </Text>
      <View style={styles.choices}>
        {THEME_MODES.filter((mode) => mode !== 'system' || !isTV).map((mode) => (
          <TvPressable
            key={mode}
            style={[styles.choice, themeMode === mode && styles.choiceSelected]}
            onPress={() => chooseTheme(mode)}
          >
            <Text style={[styles.choiceText, themeMode === mode && styles.choiceTextSelected]}>{THEME_LABELS[mode]}</Text>
          </TvPressable>
        ))}
      </View>
      {themeMode === 'sun' && (
        <>
          <Text style={styles.hint}>Stedet solen regnes for.</Text>
          <View style={styles.choices}>
            {PLACES.map((place) => (
              <TvPressable
                key={place.key}
                style={[styles.choice, themePlace === place.key && styles.choiceSelected]}
                onPress={() => choosePlace(place.key)}
              >
                <Text style={[styles.choiceText, themePlace === place.key && styles.choiceTextSelected]}>{place.name}</Text>
              </TvPressable>
            ))}
          </View>
        </>
      )}

      <Text style={styles.sectionTitle}>Undertekster</Text>
      <Text style={styles.hint}>
        Sproget der vælges af sig selv, når en film eller et afsnit har det. Findes det ikke i
        filen, prøves engelsk. Du kan stadig skifte spor i afspilleren.
      </Text>
      <View style={styles.choices}>
        {SUBTITLE_CHOICES.map((option) => (
          <TvPressable
            key={option.value}
            style={[styles.choice, subtitles === option.value && styles.choiceSelected]}
            onPress={() => {
              void chooseSubtitles(option.value);
            }}
          >
            <Text
              style={[styles.choiceText, subtitles === option.value && styles.choiceTextSelected]}
            >
              {option.value === 'auto' && isTV ? 'Enhedens sprog' : option.label}
            </Text>
          </TvPressable>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Streamformat</Text>
      <Text style={styles.hint}>
        Automatisk vælger det formatet der plejer at virke bedst på enheden.
        Løber underteksterne foran billedet, er HLS værd at prøve: rå TS
        bærer ingen tidslinje, så afspilleren må gætte sig frem.
      </Text>
      <View style={styles.choices}>
        {STREAM_FORMATS.map((option) => (
          <TvPressable
            key={option.value}
            style={[
              styles.choice,
              streamFormat === option.value && styles.choiceSelected,
            ]}
            onPress={() => {
              void chooseStreamFormat(option.value);
            }}
          >
            <Text
              style={[
                styles.choiceText,
                streamFormat === option.value && styles.choiceTextSelected,
              ]}
            >
              {option.label}
            </Text>
          </TvPressable>
        ))}
      </View>
      <Text style={styles.hint}>
        Skiftet gælder næste gang du åbner en kanal, også når du starter forfra.
      </Text>

      <Text style={styles.sectionTitle}>Videogengivelse</Text>
      <Text style={styles.hint}>
        Grøn skærm med lyd, fx når en udsendelse startes forfra? Prøv Alternativ. Den tegner
        videoen på en anden måde; Standard er bedst til HDR. Gælder næste gang du åbner en kanal.
      </Text>
      <View style={styles.choices}>
        {VIDEO_SURFACES.map((option) => (
          <TvPressable
            key={option.value}
            style={[styles.choice, videoSurface === option.value && styles.choiceSelected]}
            onPress={() => chooseVideoSurface(option.value)}
          >
            <Text style={[styles.choiceText, videoSurface === option.value && styles.choiceTextSelected]}>{option.label}</Text>
          </TvPressable>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Plakater</Text>
      <Text style={styles.hint}>
        Udbyderen giver ikke alle film og serier en plakat, og nogle peger på en server der er
        død. Med en nøgle til The Movie Database (TMDB) slår appen dem op, der mangler, én gang
        hver, og husker svaret.
      </Text>
      <TextInput
        style={styles.input}
        value={tmdbKey}
        onChangeText={(value) => {
          // Gemmes ved hvert tastetryk. Kun ved tab af fokus var ikke nok:
          // gaar man ud af skaermen med tastaturet aabent, mister feltet
          // aldrig fokus, og noeglen stod der uden at vaere gemt.
          setTmdbKey(value);
          void setTmdbApiKey(session.db, value);
          setPosterApiKey(value);
        }}
        placeholder="TMDB API-nøgle (valgfri)"
        placeholderTextColor={colors.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
      />
      <Text style={styles.hint}>
        Nøglen laves gratis på themoviedb.org: opret en konto, gå til Settings → API, og kopiér
        enten "API Key" eller "API Read Access Token". Begge virker; du skal kun bruge én.
        {isTV ? ' Den gemmes kun på denne enhed.' : ' Den gemmes kun på telefonen og i din sikkerhedskopi.'}
      </Text>

      <Text style={styles.sectionTitle}>Forside</Text>
      <Text style={styles.hint}>
        Vælg de streamingtjenester du har. Forsiden viser en hylde for hver med det der er
        populært på den lige nu, og ugens mest sete. De danske står først; bagefter de
        britiske (BBC iPlayer, ITVX), mærket UK, med det de har derovre. Trykker du på en titel, spilles den fra din
        egen pakke når den findes der, ellers åbnes tjenestens app. Kræver TMDB-nøglen ovenfor.
      </Text>
      {tmdbKey.trim().length === 0 ? null : providers === null ? (
        <Text style={styles.hint}>Henter tjenesterne …</Text>
      ) : (
        <>
          {/* Foldet sammen som standard: over hundrede tjenester fyldte
              hele skaermen nedad. Raekken siger hvad der er valgt. */}
          <TvPressable style={styles.row} onPress={() => setProvidersOpen((open) => !open)}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>
                Streamingtjenester{chosenProviders.length > 0 ? ` · ${chosenProviders.length} valgt` : ''}
              </Text>
              <Text style={styles.rowHint} numberOfLines={2}>
                {chosenProviders.length === 0
                  ? 'Ingen valgt endnu. Tryk for at vælge.'
                  : chosenProviders.map((entry) => entry.name).join(', ')}
              </Text>
            </View>
            <Text style={styles.actionText}>{providersOpen ? '▴ Luk' : '▾ Vælg'}</Text>
          </TvPressable>
          {providersOpen && (
            <>
              <TextInput
                style={styles.input}
                value={providerSearch}
                onChangeText={setProviderSearch}
                placeholder="Find en tjeneste, fx SkyShowtime"
                placeholderTextColor={colors.textMuted}
                autoCorrect={false}
                autoCapitalize="none"
              />
              <View style={styles.choices}>
                {[...chosenProviders.filter((c) => !providers.some((p) => p.id === c.id)), ...providers]
                  .filter((provider) => {
                    const needle = providerSearch.trim().toLowerCase();
                    // De valgte staar der altid, saa man kan tage dem fra igen.
                    return (
                      needle.length === 0 ||
                      provider.name.toLowerCase().includes(needle) ||
                      chosenProviders.some((c) => c.id === provider.id)
                    );
                  })
                  .map((provider) => {
                    const selected = chosenProviders.some((entry) => entry.id === provider.id);
                    return (
                      <TvPressable
                        key={provider.id}
                        style={[styles.choice, selected && styles.choiceSelected]}
                        onPress={() => {
                          void toggleProvider(provider);
                        }}
                      >
                        <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>
                          {provider.region === 'DK' ? provider.name : `${provider.name} (UK)`}
                        </Text>
                      </TvPressable>
                    );
                  })}
              </View>
            </>
          )}
        </>
      )}

      {/* Ikke paa tv: YouTube-noeglen er kun til soegningen, som tv'et ikke viser, og filvaelgeren findes ikke paa Google TV. */}
      {!isTV && (
        <>
      <Text style={styles.sectionTitle}>Trailere</Text>
      <Text style={styles.hint}>
        Med TMDB-nøglen ovenfor er TMDB's officielle trailer altid første valg. Kender TMDB
        ikke titlen, spilles udbyderens egen trailer, og er den under et minut, ledes der
        videre: med en YouTube-nøgle her vælger appen selv en lang nok, og ellers åbnes
        YouTubes søgning inde i appen. Har du TMDB-nøglen, kan dette felt roligt stå tomt.
      </Text>
      <TextInput
        style={styles.input}
        value={youtubeKey}
        onChangeText={(value) => {
          setYoutubeKey(value);
          void setYoutubeApiKey(session.db, value);
        }}
        placeholder="YouTube API-nøgle (valgfri)"
        placeholderTextColor={colors.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
      />
      <Text style={styles.hint}>
        Nøglen laves gratis i Google Cloud Console: opret et projekt, slå "YouTube Data API v3"
        til, og opret en API-nøgle under Legitimationsoplysninger. Den gemmes kun på telefonen.
      </Text>

      <Text style={styles.sectionTitle}>Sikkerhedskopi</Text>
      <Text style={styles.hint}>
        Favoritter i din rækkefølge, egne logoer, skjulte lande, undertekster og de andre valg,
        min liste og hvor langt film er set. Ikke adgangskoder: dem taster du igen. Gem filen
        et sted du kan nå fra en ny telefon, og gendan efter du er logget ind på panelet.
      </Text>
      <TvPressable style={styles.row} disabled={backupBusy} onPress={() => void saveBackup()}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Gem sikkerhedskopi</Text>
          <Text style={styles.rowHint}>Vælg en mappe. Filen hedder norstream-sikkerhedskopi.json.</Text>
        </View>
        <Text style={styles.actionText}>Gem</Text>
      </TvPressable>
      <TvPressable style={styles.row} disabled={backupBusy} onPress={() => void restoreFromFile()}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Gendan fra fil</Text>
          <Text style={styles.rowHint}>
            Erstatter favoritter, egne logoer og skjulte lande med dem i filen.
          </Text>
        </View>
        <Text style={styles.actionText}>Vælg fil</Text>
      </TvPressable>
      {backupMessage !== null && <Text style={styles.hint}>{backupMessage}</Text>}

        </>
      )}

      <Text style={styles.sectionTitle}>Skjulte lande</Text>
      {hidden.length === 0 ? (
        <Text style={styles.hint}>
          {isTV ? 'Ingen. Hold OK nede på et land under Kanaler for at skjule det.' : 'Ingen. Hold fingeren nede på et land under Kanaler for at skjule det.'}
        </Text>
      ) : (
        hidden.map((key) => (
          <View key={key} style={styles.row}>
            <Text style={styles.rowTitle}>{countryLabel(key)}</Text>
            <TvPressable
              style={styles.action}
              onPress={() => {
                void (async () => {
                  await unhideCountry(session.db, key);
                  await load();
                })();
              }}
            >
              <Text style={styles.actionText}>Vis igen</Text>
            </TvPressable>
          </View>
        ))
      )}

      <Text style={styles.sectionTitle}>Konto</Text>
      {confirmingSignOut ? (
        <View style={styles.confirmBox}>
          <Text style={styles.confirmText}>
            Dine adgangsoplysninger slettes fra enheden.
          </Text>
          <View style={styles.confirmActions}>
            <TvPressable style={styles.action} onPress={() => setConfirmingSignOut(false)}>
              <Text style={styles.actionText}>Annullér</Text>
            </TvPressable>
            <TvPressable
              style={styles.action}
              onPress={() => {
                void signOut();
              }}
            >
              <Text style={styles.dangerText}>Log ud</Text>
            </TvPressable>
          </View>
        </View>
      ) : (
        <TvPressable style={styles.dangerButton} onPress={() => setConfirmingSignOut(true)}>
          <Text style={styles.dangerText}>Log ud</Text>
        </TvPressable>
      )}
    </ScrollView>
  );
}

/**
 * Landekoden tilbage til flag og dansk navn. `deriveCountry` genkender koden
 * selv — den staar i landets egen aliasliste — saa der er ingen anden tabel at
 * holde i takt.
 */
function countryLabel(key: string): string {
  if (key === OTHER_COUNTRY_KEY) return 'Øvrige';
  const country = deriveCountry(key);
  return country === null ? key : `${country.flag} ${country.name}`;
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    color: colors.text,
    padding: theme.spacing.sm + 2,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    fontSize: 15,
  },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  choice: {
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius,
    backgroundColor: colors.surface,
  },
  choiceSelected: { backgroundColor: colors.accent },
  choiceText: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
  choiceTextSelected: { color: colors.text },
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: theme.spacing.md, paddingBottom: theme.spacing.xl },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: theme.radius,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  rowText: { flex: 1, marginRight: theme.spacing.md },
  rowTitle: { flex: 1, color: colors.text, fontSize: 15 },
  rowHint: { color: colors.textMuted, fontSize: 13, marginTop: 2, lineHeight: 18 },
  hint: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  action: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: theme.radius,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  actionText: { color: colors.text, fontSize: 13 },
  confirmBox: {
    backgroundColor: colors.surface,
    borderRadius: theme.radius,
    padding: theme.spacing.md,
  },
  confirmText: { color: colors.text, fontSize: 14, marginBottom: theme.spacing.md },
  confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.spacing.sm },
  dangerButton: {
    backgroundColor: colors.surface,
    borderRadius: theme.radius,
    padding: theme.spacing.md,
    alignItems: 'center',
  },
  dangerText: { color: colors.danger, fontSize: 15, fontWeight: '600' },
});
