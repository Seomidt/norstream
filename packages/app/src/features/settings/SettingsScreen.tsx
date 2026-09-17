import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { deriveCountry } from '@norstream/core';
import type { AppSession } from '../../session.js';
import { vodCounts } from '../../storage/vod.js';
import { countRadioChannels } from '../../storage/channels.js';
import { createBackup, parseBackup, restoreBackup, serialiseBackup } from '../../storage/backup.js';
import { forgetLogoMisses, resetLogo } from '../../ui/logoCache.js';
import { setPosterApiKey } from '../../ui/posterFill.js';
import { USB_FOLDER, pickBackupFolder, readBackupFromUsb, readChosenBackupFile, saveBackupToChosenFolder, usbBackupFolder, writeBackupToFolder } from './backupFiles.js';
import { fetchBackupFromLink } from './backupLink.js';
import { getAutoBackupState, runWeeklyBackup } from '../../storage/autoBackup.js';
import type { AutoBackupState } from '../../storage/autoBackup.js';
import { getBackupLink, setBackupFolderUri, setBackupLink } from '../../storage/settings.js';
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
import { TvTextInput } from '../../ui/TvTextInput.js';
import { LocalTransfer } from './LocalTransfer.js';
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

const STREAM_FORMATS: readonly { value: StreamFormatSetting; label: string }[] = [
  { value: 'auto', label: 'Automatisk' },
  { value: 'ts', label: 'TS' },
  { value: 'm3u8', label: 'HLS' },
];

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
  const [backupBusy, setBackupBusy] = useState(false);
  /** USB-drevet der sidder i, hvis der er et. Slaas op naar siden laeses og foer hvert tryk. */
  const [usb, setUsb] = useState<{ uri: string; name: string } | null>(null);
  /** Delelinket til filen, til Gendan fra link. Huskes, saa det kan hentes igen uden at taste. */
  const [backupLink, setBackupLinkState] = useState('');
  const changeBackupLink = (value: string): void => {
    setBackupLinkState(value);
    void setBackupLink(session.db, value);
  };
  /** Opdatering: hvad opslaget fandt, og en status-linje. */
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  /** Den automatiske ugentlige kopi: mappe, sidste skrivning, om den fejlede. */
  const [autoBackup, setAutoBackup] = useState<AutoBackupState>({ folderUri: null, lastMs: null, failed: false });
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
    setTmdbLocked((tmdb ?? '').trim().length > 0);
    setPosterApiKey(tmdb);
    setSubtitles(preferredSubtitles);
    setVod(counts);
    setThemeModeState(await getThemeMode(session.db));
    const surface = await getVideoSurface(session.db);
    setVideoSurfaceState(surface);
    applyVideoSurfaceSetting(surface);
    setThemePlaceState((await getThemePlace(session.db)) ?? themePreference().placeKey);
    setRadio(await countRadioChannels(session.db));
    setAutoBackup(await getAutoBackupState(session.db));
    setBackupLinkState(await getBackupLink(session.db));
    setUsb(usbBackupFolder());
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

  /**
   * Slaar den ugentlige kopi til ved at vaelge mappen én gang og skrive
   * med det samme; fra igen ved at glemme mappen. Filen i mappen bliver.
   */
  async function toggleAutoBackup(on: boolean): Promise<void> {
    setBackupBusy(true);
    try {
      if (!on) {
        await setBackupFolderUri(session.db, null);
        setAutoBackup(await getAutoBackupState(session.db));
        setBackupMessage('Den automatiske sikkerhedskopi er slået fra.');
        return;
      }
      const folderUri = await pickBackupFolder();
      if (folderUri === null) return;
      await setBackupFolderUri(session.db, folderUri);
      const result = await runWeeklyBackup(session.db, writeBackupToFolder, Date.now(), true);
      setAutoBackup(await getAutoBackupState(session.db));
      setBackupMessage(
        result === 'written'
          ? 'Sikkerhedskopien er gemt, og den fornys hver uge i den valgte mappe.'
          : 'Der kunne ikke skrives i mappen. Prøv en anden.',
      );
    } finally {
      setBackupBusy(false);
    }
  }

  async function restoreFromFile(): Promise<void> {
    setBackupBusy(true);
    try {
      const text = await readChosenBackupFile();
      if (text === null) return;
      await restoreFromText(text);
    } catch (cause) {
      setBackupMessage(cause instanceof Error ? cause.message : 'Filen kunne ikke læses.');
    } finally {
      setBackupBusy(false);
    }
  }

  /** Tv'ets foerste vej: filen paa USB-drevet, uden Drev og uden link. */
  async function saveToUsb(): Promise<void> {
    setBackupBusy(true);
    try {
      const found = usbBackupFolder();
      setUsb(found);
      await writeBackupToFolder(USB_FOLDER, serialiseBackup(await createBackup(session.db)));
      setBackupMessage(`Sikkerhedskopien er gemt på ${found?.name ?? 'USB-drevet'}.`);
    } catch (cause) {
      setBackupMessage(cause instanceof Error ? cause.message : 'Kopien kunne ikke skrives til USB-drevet.');
    } finally {
      setBackupBusy(false);
    }
  }

  async function restoreFromUsb(): Promise<void> {
    setBackupBusy(true);
    try {
      setUsb(usbBackupFolder());
      await restoreFromText(await readBackupFromUsb());
    } catch (cause) {
      setBackupMessage(cause instanceof Error ? cause.message : 'Kopien på USB-drevet kunne ikke læses.');
    } finally {
      setBackupBusy(false);
    }
  }

  /** Ugentlig kopi paa USB: skriver med det samme, og igen hver uge ved start naar drevet sidder i. */
  async function toggleUsbWeekly(on: boolean): Promise<void> {
    setBackupBusy(true);
    try {
      if (!on) {
        await setBackupFolderUri(session.db, null);
        setAutoBackup(await getAutoBackupState(session.db));
        setBackupMessage('Den automatiske sikkerhedskopi er slået fra.');
        return;
      }
      setUsb(usbBackupFolder());
      await setBackupFolderUri(session.db, USB_FOLDER);
      const result = await runWeeklyBackup(session.db, writeBackupToFolder, Date.now(), true);
      setAutoBackup(await getAutoBackupState(session.db));
      setBackupMessage(
        result === 'written'
          ? 'Sikkerhedskopien er gemt på USB-drevet, og den fornys hver uge når drevet sidder i.'
          : 'Der kunne ikke skrives til USB-drevet. Sidder det i? Den prøver igen ved næste start.',
      );
    } finally {
      setBackupBusy(false);
    }
  }

  /** Tv'ets anden vej: filen hentes fra et delelink (Drev, Dropbox, OneDrive) i stedet for en filvaelger. */
  async function restoreFromLink(): Promise<void> {
    setBackupBusy(true);
    setBackupMessage('Henter filen …');
    try {
      await restoreFromText(await fetchBackupFromLink(backupLink));
    } catch (cause) {
      setBackupMessage(cause instanceof Error ? cause.message : 'Filen kunne ikke hentes.');
    } finally {
      setBackupBusy(false);
    }
  }

  async function restoreFromText(text: string): Promise<void> {
    {
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

      <Text style={styles.sectionTitle}>Kanallogoer</Text>
      <TvPressable style={styles.row} onPress={onOpenLogos}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Kanaler uden logo</Text>
          <Text style={styles.rowHint}>
            {isTV
              ? 'Kanalerne som arkiverne ikke har et logo til. Lad appen søge dem alle på nettet på én gang, eller vælg selv på den enkelte kanal.'
              : 'Logoerne hentes selv, én gang, og gemmes på telefonen. Dem arkiverne ikke kender, kan appen søge efter på nettet, alle på én gang — eller du vælger selv. Du kan også holde fingeren på en kanal i listerne.'}
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
      <TvPressable style={styles.row} disabled={backupBusy} onPress={() => void toggleAutoBackup(autoBackup.folderUri === null)}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Automatisk sikkerhedskopi hver uge</Text>
          <Text style={styles.rowHint}>
            {autoBackup.folderUri === null
              ? 'Vælg en mappe én gang, så fornys filen der af sig selv.'
              : autoBackup.failed
                ? 'Mappen kunne ikke nås sidst. Slå fra og til igen for at vælge en ny.'
                : autoBackup.lastMs === null
                  ? 'Slået til. Første kopi skrives ved næste start.'
                  : `Sidst gemt ${new Date(autoBackup.lastMs).toLocaleDateString('da-DK', { day: 'numeric', month: 'long' })}.`}
          </Text>
        </View>
        <Switch
          value={autoBackup.folderUri !== null}
          focusable={false}
          disabled={backupBusy}
          onValueChange={(value) => {
            void toggleAutoBackup(value);
          }}
          trackColor={{ true: colors.accent, false: colors.border }}
        />
      </TvPressable>
        </>
      )}
      {isTV && (
        <>
          <Text style={styles.sectionTitle}>Sikkerhedskopi</Text>
          <Text style={styles.hint}>
            Favoritter i din rækkefølge, grupper, egne logoer, skjulte lande og indstillinger. Ikke
            adgangskoder. Nemmest med et USB-drev i en hub med strøm igennem: kopien ligger på drevet,
            og på en ny boks er det log ind, sæt drevet i, Gendan fra USB. Ellers hentes den fra et
            link til filen i Google Drev, Dropbox eller OneDrive (delt med "Alle med linket");
            Google TV-appen på telefonen kan skrive linket.
          </Text>
        </>
      )}
      {(isTV || usb !== null) && (
        <>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>USB-drev</Text>
              <Text style={styles.rowHint}>
                {usb === null
                  ? 'Intet USB-drev fundet. Sæt det i en hub med strøm igennem, og åbn Indstillinger igen.'
                  : `${usb.name} sidder i. Filen ligger i Android/data/dk.seomidt.norstream/files på drevet.`}
              </Text>
            </View>
          </View>
          <TvPressable style={styles.row} disabled={backupBusy || usb === null} onPress={() => void saveToUsb()}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Gem på USB nu</Text>
              <Text style={styles.rowHint}>Skriver norstream-sikkerhedskopi.json på drevet.</Text>
            </View>
            <Text style={styles.actionText}>Gem</Text>
          </TvPressable>
          <TvPressable style={styles.row} disabled={backupBusy} onPress={() => void toggleUsbWeekly(autoBackup.folderUri !== USB_FOLDER)}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Automatisk hver uge på USB</Text>
              <Text style={styles.rowHint}>
                {autoBackup.folderUri !== USB_FOLDER
                  ? 'Lad drevet sidde i, så fornys filen af sig selv.'
                  : autoBackup.failed
                    ? 'Drevet sad ikke i sidst. Den prøver igen ved næste start.'
                    : autoBackup.lastMs === null
                      ? 'Slået til. Første kopi skrives ved næste start.'
                      : `Sidst gemt ${new Date(autoBackup.lastMs).toLocaleDateString('da-DK', { day: 'numeric', month: 'long' })}.`}
              </Text>
            </View>
            <Switch
              value={autoBackup.folderUri === USB_FOLDER}
              focusable={false}
              disabled={backupBusy}
              onValueChange={(value) => {
                void toggleUsbWeekly(value);
              }}
              trackColor={{ true: colors.accent, false: colors.border }}
            />
          </TvPressable>
          <TvPressable style={styles.row} disabled={backupBusy || usb === null} onPress={() => void restoreFromUsb()}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Gendan fra USB</Text>
              <Text style={styles.rowHint}>Læser filen på drevet og erstatter favoritter, grupper, egne logoer og skjulte lande.</Text>
            </View>
            <Text style={styles.actionText}>Gendan</Text>
          </TvPressable>
        </>
      )}
      <TvTextInput
        style={styles.input}
        value={backupLink}
        onChangeText={changeBackupLink}
        placeholder="Link til norstream-sikkerhedskopi.json"
        autoCorrect={false}
        autoCapitalize="none"
        keyboardType="url"
        returnKeyType="go"
        onSubmitEditing={() => void restoreFromLink()}
      />
      <TvPressable style={styles.row} disabled={backupBusy || backupLink.trim().length === 0} onPress={() => void restoreFromLink()}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Gendan fra link</Text>
          <Text style={styles.rowHint}>
            Henter filen fra linket og erstatter favoritter, grupper, egne logoer og skjulte lande. Linket
            huskes, så du bare trykker Hent næste gang filen er fornyet.
          </Text>
        </View>
        <Text style={styles.actionText}>Hent</Text>
      </TvPressable>
      {backupMessage !== null && <Text style={styles.hint}>{backupMessage}</Text>}

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
        Appen kommer ikke fra Play Store.{' '}
        {isTV
          ? 'Boksen ser selv efter en nyere udgave, når den starter — du kan også søge her.'
          : 'Søg her efter en nyere udgave og installér den — også på en boks i en anden by.'}{' '}
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

      <LocalTransfer
        buildBackup={async () => serialiseBackup(await createBackup(session.db))}
        onReceived={async (json) => {
          try {
            await restoreFromText(json);
          } catch (cause) {
            setBackupMessage(cause instanceof Error ? cause.message : 'Den modtagne fil kunne ikke læses.');
          }
        }}
      />

      <CloudBackup
        session={session}
        onRestore={async (json) => {
          await restoreFromText(json);
        }}
      />

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
