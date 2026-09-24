import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { deriveCountry } from '@norstream/core';
import type { AppSession } from '../../session.js';
import { vodCounts } from '../../storage/vod.js';
import { countRadioChannels } from '../../storage/channels.js';
import { parseBackup, restoreBackup } from '../../storage/backup.js';
import { forgetLogoMisses, resetLogo } from '../../ui/logoCache.js';
import { setPosterApiKey } from '../../ui/posterFill.js';
import { listHiddenCountries, unhideCountry } from '../../storage/countries.js';
import { OTHER_COUNTRY_KEY } from '../../storage/countries.js';
import { clearSourceCredentials } from '../../storage/credentials.js';
import { deleteSource, listSources } from '../../storage/sources.js';
import {
  clearLastSyncMs,
  getGoogleSearchFields,
  getLastSyncMs,
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
  getPanelEpgEnabled,
  setPanelEpgEnabled,
  getGuideInfoMode,
  setGuideInfoMode,
  setStreamFormatSetting,
  getThemeMode,
  getThemePlace,
  setThemeMode,
  setThemePlace,
} from '../../storage/settings.js';
import type { GuideInfoMode, HomeProvider, StreamFormatSetting, SubtitlePreference, VideoSurface } from '../../storage/settings.js';
import { tmdbFetch } from '../../sync/tmdb.js';
import { weatherFetchedAt } from '../../sync/weather.js';
import { newsFetchedAt } from '../../sync/news.js';
import { PLACES, THEME_MODES, setThemePreference, themePreference } from '../../ui/themeMode.js';
import type { ThemeMode } from '../../ui/themeMode.js';
import { listTmdbProvidersWithUk } from '../../sync/tmdbHome.js';
import { applyStreamFormatSetting, applyVideoSurfaceSetting } from '../player/format.js';
import { theme } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { isTV } from '../../ui/tv.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { TvTextInput } from '../../ui/TvTextInput.js';
import { CloudBackup } from './CloudBackup.js';
import { checkForUpdate, currentVersionCode, downloadAndInstall } from './appUpdate.js';
import type { UpdateInfo } from './appUpdate.js';

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

const GUIDE_INFO_CHOICES: readonly { value: GuideInfoMode; label: string }[] = [
  { value: 'clock', label: 'Ur og vejr' },
  { value: 'news', label: 'Nyhedsstribe' },
  { value: 'off', label: 'Fra' },
];

const STREAM_FORMATS: readonly { value: StreamFormatSetting; label: string }[] = [
  { value: 'auto', label: 'Automatisk' },
  { value: 'ts', label: 'TS' },
  { value: 'm3u8', label: 'HLS' },
];

/** "for 5 min siden", "for 3 timer siden", "for 2 dage siden" — eller "aldrig". */
function relativeTime(ms: number | null, now: number = Date.now()): string {
  if (ms === null || ms <= 0) return 'aldrig';
  const diff = Math.max(0, now - ms);
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'lige nu';
  if (minutes < 60) return `for ${minutes} min siden`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `for ${hours} ${hours === 1 ? 'time' : 'timer'} siden`;
  const days = Math.round(hours / 24);
  return `for ${days} ${days === 1 ? 'dag' : 'dage'} siden`;
}

/** Noeglen sloeret: foerste og sidste fire tegn, resten som prikker. */
function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '••••';
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

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
  /**
   * Noeglen er laast som udgangspunkt, naar der staar en. Saa kan et
   * uheldigt tastetryk ikke aendre et enkelt tegn (det giver 401 og en tom
   * biograf); man laaser op med vilje foer man retter.
   */
  const [tmdbLocked, setTmdbLocked] = useState(true);
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
  /** Opdatering: hvad opslaget fandt, og en status-linje. */
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [providersOpen, setProvidersOpen] = useState(false);
  /** De avancerede fejlfindings-knapper er foldet sammen som standard. */
  const [advancedOpen, setAdvancedOpen] = useState(false);
  /** EPG fra panelets egen fil til favoritter der mangler den (UK, US m.fl.). */
  const [panelEpg, setPanelEpg] = useState(true);
  const [videoSurface, setVideoSurfaceState] = useState<VideoSurface>('surface');
  const [guideInfo, setGuideInfo] = useState<GuideInfoMode>('clock');
  /** Hvornaar kanaler, vejr og nyheder sidst blev hentet — til status-linjerne. */
  const [status, setStatus] = useState<{ channels: number | null; weather: number | null; news: number | null }>(
    { channels: null, weather: null, news: null },
  );
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
    setTmdbLocked((tmdb ?? '').trim().length > 0);
    setPosterApiKey(tmdb);
    setSubtitles(preferredSubtitles);
    setVod(counts);
    setThemeModeState(await getThemeMode(session.db));
    const surface = await getVideoSurface(session.db);
    setVideoSurfaceState(surface);
    applyVideoSurfaceSetting(surface);
    setThemePlaceState((await getThemePlace(session.db)) ?? themePreference().placeKey);
    setGuideInfo(await getGuideInfoMode(session.db));
    setPanelEpg(await getPanelEpgEnabled(session.db));
    // Hentetiden gemmes PER kilde (last_sync_ms:<id>), ikke som én faelles
    // vaerdi. Status skal vise den nyeste paa tvaers af kilderne; laeste den den
    // faelles (uden kilde-id), stod der "aldrig hentet" selv om kanalerne var
    // hentet for laengst.
    const [perSource, weatherAt, newsAt] = await Promise.all([
      Promise.all(session.sources.map((access) => getLastSyncMs(session.db, access.source.id))),
      weatherFetchedAt(session.db),
      newsFetchedAt(session.db),
    ]);
    const channelsAt = perSource.reduce<number | null>(
      (newest, value) => (value !== null && (newest === null || value > newest) ? value : newest),
      null,
    );
    setStatus({ channels: channelsAt, weather: weatherAt, news: newsAt });
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

  async function lookForUpdate(): Promise<void> {
    setUpdateBusy(true);
    setUpdateMessage('Søger …');
    try {
      const found = await checkForUpdate();
      setUpdate(found);
      setUpdateMessage(found.available ? null : 'Du har den nyeste udgave.');
    } catch (cause) {
      setUpdateMessage(cause instanceof Error ? cause.message : 'Kunne ikke søge efter opdatering.');
    } finally {
      setUpdateBusy(false);
    }
  }

  async function installUpdate(): Promise<void> {
    if (update === null) return;
    setUpdateBusy(true);
    setUpdateMessage('Henter …');
    try {
      await downloadAndInstall(update.url);
      setUpdateMessage('Følg installationen på skærmen.');
    } catch (cause) {
      setUpdateMessage(cause instanceof Error ? cause.message : 'Kunne ikke installere.');
    } finally {
      setUpdateBusy(false);
    }
  }

  async function restoreFromText(text: string): Promise<void> {
    {
      const result = await restoreBackup(session.db, parseBackup(text), { matchByName: true });
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

  async function chooseGuideInfo(mode: GuideInfoMode): Promise<void> {
    setGuideInfo(mode);
    await setGuideInfoMode(session.db, mode);
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

      {isTV && (
        <>
          <Text style={styles.sectionTitle}>Guidens info-område</Text>
          <Text style={styles.hint}>
            Ved siden af forhåndsvisningen i guiden: ur med vejr, nyhedsstribe, eller intet.
          </Text>
          <View style={styles.choices}>
            {GUIDE_INFO_CHOICES.map((option) => (
              <TvPressable
                key={option.value}
                style={[styles.choice, guideInfo === option.value && styles.choiceSelected]}
                onPress={() => {
                  void chooseGuideInfo(option.value);
                }}
              >
                <Text style={[styles.choiceText, guideInfo === option.value && styles.choiceTextSelected]}>
                  {option.label}
                </Text>
              </TvPressable>
            ))}
          </View>
        </>
      )}

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

      <Text style={styles.sectionTitle}>Kanallogoer</Text>
      <TvPressable style={styles.row} onPress={onOpenLogos}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Favoritter uden logo</Text>
          <Text style={styles.rowHint}>
            {isTV
              ? 'Dine favoritter som arkiverne ikke har et logo til. Lad appen søge dem alle på nettet på én gang, eller vælg selv på den enkelte kanal.'
              : 'Logoerne hentes selv, én gang, og gemmes på telefonen. Dem arkiverne ikke kender til dine favoritter, kan appen søge efter på nettet, alle på én gang — eller du vælger selv. Du kan også holde fingeren på en kanal i listerne.'}
          </Text>
        </View>
        <Text style={styles.actionText}>Åbn</Text>
      </TvPressable>
      {/* Google-noeglerne tastes paa telefonen; paa tv soeges der kun i
          Wikidata, som ikke kraever en noegle. */}
      {!isTV && (
        <>
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
      <Text style={styles.hint}>Følg solen: lyst om dagen, mørkt om aftenen.</Text>
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
        Sproget der vælges automatisk. Findes det ikke, prøves engelsk. Du kan skifte spor i afspilleren.
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

      <Text style={styles.sectionTitle}>Programoversigt</Text>
      <TvPressable
        style={styles.row}
        onPress={() => {
          const next = !panelEpg;
          setPanelEpg(next);
          void setPanelEpgEnabled(session.db, next);
        }}
      >
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Hent fra panelets store EPG-fil</Text>
          <Text style={styles.rowHint}>
            Giver programmer til favoritter, panelet ellers ikke har EPG på (fx UK og US). Hentes i baggrunden
            én gang i døgnet. Slå fra, hvis boksen bliver langsom.
          </Text>
        </View>
        <Switch
          value={panelEpg}
          focusable={false}
          onValueChange={(value) => {
            setPanelEpg(value);
            void setPanelEpgEnabled(session.db, value);
          }}
          trackColor={{ true: colors.accent, false: colors.border }}
        />
      </TvPressable>

      <Text style={styles.sectionTitle}>Avanceret</Text>
      <TvPressable style={styles.row} onPress={() => setAdvancedOpen((open) => !open)}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Streamformat og videogengivelse</Text>
          <Text style={styles.rowHint}>Til fejlfinding. Brug kun, hvis billede eller undertekster driller.</Text>
        </View>
        <Text style={styles.actionText}>{advancedOpen ? '▴ Skjul' : '▾ Vis'}</Text>
      </TvPressable>
      {advancedOpen && (
        <>
          <Text style={styles.subLabel}>Streamformat</Text>
          <Text style={styles.hint}>
            Automatisk plejer at virke. Løber underteksterne foran billedet, er HLS værd at prøve.
            Gælder næste kanal du åbner.
          </Text>
          <View style={styles.choices}>
            {STREAM_FORMATS.map((option) => (
              <TvPressable
                key={option.value}
                style={[styles.choice, streamFormat === option.value && styles.choiceSelected]}
                onPress={() => {
                  void chooseStreamFormat(option.value);
                }}
              >
                <Text style={[styles.choiceText, streamFormat === option.value && styles.choiceTextSelected]}>
                  {option.label}
                </Text>
              </TvPressable>
            ))}
          </View>

          <Text style={styles.subLabel}>Videogengivelse</Text>
          <Text style={styles.hint}>
            Grøn skærm med lyd? Prøv Alternativ. Standard er bedst til HDR. Gælder næste kanal.
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
        </>
      )}

      <Text style={styles.sectionTitle}>Plakater</Text>
      <Text style={styles.hint}>
        Med en gratis TMDB-nøgle henter appen de plakater panelet mangler, én gang hver.
      </Text>
      {tmdbLocked && tmdbKey.trim().length > 0 ? (
        <TvPressable style={styles.row} onPress={() => setTmdbLocked(false)}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Nøglen er låst</Text>
            <Text style={styles.rowHint}>{maskKey(tmdbKey)} · virker. Lås op for at ændre den.</Text>
          </View>
          <Text style={styles.actionText}>Lås op</Text>
        </TvPressable>
      ) : (
        <>
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
          {tmdbKey.trim().length > 0 && (
            <TvPressable style={styles.row} onPress={() => setTmdbLocked(true)}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Lås nøglen</Text>
                <Text style={styles.rowHint}>Så kan den ikke ændres ved et uheld.</Text>
              </View>
              <Text style={styles.actionText}>Lås</Text>
            </TvPressable>
          )}
        </>
      )}
      <Text style={styles.hint}>
        Nøglen laves gratis på themoviedb.org: opret en konto, gå til Settings → API, og kopiér
        enten "API Key" eller "API Read Access Token". Begge virker; du skal kun bruge én.
        {isTV ? ' Den gemmes kun på denne enhed.' : ' Den gemmes kun på telefonen og i din sikkerhedskopi.'}
      </Text>

      <Text style={styles.sectionTitle}>Forside</Text>
      <Text style={styles.hint}>
        Vælg de streamingtjenester du har. Forsiden viser populære titler fra hver. Kræver TMDB-nøglen ovenfor.
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

        </>
      )}

      <Text style={styles.sectionTitle}>Opdatering</Text>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.versionValue}>Udgave {currentVersionCode()}</Text>
          <Text style={styles.rowHint}>
            {isTV
              ? 'Det er den udgave, boksen kører nu. Den henter selv en nyere ved opstart.'
              : 'Det er den udgave, du kører nu.'}
          </Text>
        </View>
      </View>
      <Text style={styles.hint}>
        Appen kommer ikke fra Play Store — den henter selv nye udgaver.
        Første gang skal enheden tillade “installér ukendte apps” for NorStream.
      </Text>
      <TvPressable style={styles.row} disabled={updateBusy} onPress={() => void lookForUpdate()}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Søg efter opdatering</Text>
          <Text style={styles.rowHint}>Se om der er en nyere udgave end {currentVersionCode()}.</Text>
        </View>
        <Text style={styles.actionText}>Søg</Text>
      </TvPressable>
      {update !== null && update.available && (
        <TvPressable style={styles.row} disabled={updateBusy} onPress={() => void installUpdate()}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Hent og installér udgave {update.versionCode}</Text>
            <Text style={styles.rowHint}>Henter APK’en og starter installationen.</Text>
          </View>
          <Text style={styles.actionText}>Hent</Text>
        </TvPressable>
      )}
      {updateMessage !== null && <Text style={styles.hint}>{updateMessage}</Text>}

      <CloudBackup
        session={session}
        onRestore={async (json) => {
          await restoreFromText(json);
        }}
      />

      <Text style={styles.sectionTitle}>Status</Text>
      <Text style={styles.hint}>
        Hvornår appen sidst hentede sit indhold. Ser noget forældet ud, siger det
        her det — i stedet for at man skal gætte, om noget er gået i stå.
      </Text>
      <View style={styles.row}>
        <Text style={styles.rowTitle}>Kanaler, film og serier</Text>
        <Text style={styles.actionText}>{relativeTime(status.channels)}</Text>
      </View>
      {isTV && (
        <>
          <View style={styles.row}>
            <Text style={styles.rowTitle}>Vejr</Text>
            <Text style={styles.actionText}>
              {guideInfo === 'off' ? 'Slået fra' : relativeTime(status.weather)}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowTitle}>Nyheder</Text>
            <Text style={styles.actionText}>
              {guideInfo === 'news' ? relativeTime(status.news) : 'Slået fra'}
            </Text>
          </View>
        </>
      )}
      <Text style={styles.hint}>
        Program­oversigten (EPG) hentes løbende for de kanaler, du kigger på i guiden, og
        vises ikke her.
      </Text>

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
  // En tydelig overskrift med en streg over: saa staar sektionerne ikke bare
  // lige efter hinanden, men er til at skimme og finde rundt i.
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
    paddingTop: theme.spacing.md,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  /** Underoverskrift inde i en sektion (fx Tema, Undertekster under Udseende). */
  subLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xs,
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
  versionValue: { color: colors.text, fontSize: 22, fontWeight: '700' },
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
