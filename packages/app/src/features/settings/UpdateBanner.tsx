import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, StyleSheet, Text, View } from 'react-native';
import { theme } from '../../ui/theme.js';
import type { ThemeColors } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { isTV } from '../../ui/tv.js';
import { checkForUpdate, currentVersionCode, discardApk, downloadApk, installApk, onDownloadProgress, pauseApkDownloads, shouldDiscardAfter } from './appUpdate.js';
import type { DownloadProgress, UpdateInfo } from './appUpdate.js';
import { percentText } from './appUpdateParse.js';

/** Foerste kig lidt efter opstart, saa opstarten ikke venter paa netvaerket. */
const FIRST_CHECK_MS = 60_000;
/** Mens appen koerer. GitHub tillader 60 opslag i timen per adresse; det her er to. */
const POLL_MS = 30 * 60_000;
/** "Senere": saa laenge foer den samme udgave vises igen. */
const SNOOZE_MS = 6 * 60 * 60_000;
/** Efter et "installeret"-svar: er appen stadig den gamle saa laenge efter, gik det ikke igennem. */
const VERIFY_MS = 20_000;

type Phase = 'idle' | 'downloading' | 'ready' | 'installing';

/**
 * Popup'en naar en ny udgave er klar — uden at lukke appen og uden at gaa i
 * Indstillinger (brugerens oenske, v337).
 *
 * Appen kigger selv efter en nyere udgave kort efter start, hver gang den
 * kommer frem igen, og hver halve time. Er der en, vises en bjaelke i hjoernet
 * (samme form som paamindelserne). Paa tv hentes filen af sig selv med det
 * samme (som boksen altid har gjort ved opstart), med procent i bjaelken;
 * naar den er hel, staar der "Installér nu", og OK starter Androids
 * installation. Paa telefonen henter "Opdater nu" foerst og installerer saa.
 * Tilbage er "senere" paa tv; paa telefonen er der en Senere-knap. Under
 * afspilning (`quiet`) ventes der til man er ude af afspilleren — en
 * opdatering maa aldrig afbryde en film.
 *
 * v341: Androids svar vises. Blev der ikke installeret, staar der hvorfor
 * (ikke plads, anden signatur, beskadiget fil …) i stedet for at bjaelken
 * bare kommer igen. Og er appen stadig den gamle 20 s efter et "installeret",
 * siges ogsaa det.
 */
export function UpdateBanner({ quiet }: { quiet: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const [found, setFound] = useState<UpdateInfo | null>(null);
  const foundRef = useRef<UpdateInfo | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** Udgave -> tidspunkt hvor den maa vises igen. */
  const snoozed = useRef(new Map<number, number>());
  /** Den hentede fil for udgaven i `found`. */
  const localUri = useRef<{ versionCode: number; uri: string } | null>(null);
  /** Udgaver der er sat til at hente af sig selv (tv), saa det kun sker én gang. */
  const prefetched = useRef(new Set<number>());
  const phaseRef = useRef<Phase>('idle');
  const quietRef = useRef(quiet);
  const quietRevision = useRef(0);
  if (quiet && !quietRef.current) quietRevision.current += 1;
  quietRef.current = quiet;
  const mounted = useRef(true);
  const installing = useRef(false);
  const verifyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changePhase = useCallback((next: Phase): void => {
    phaseRef.current = next;
    setPhase(next);
  }, []);
  const markReady = useCallback((): void => {
    const versionCode = foundRef.current?.versionCode;
    changePhase(versionCode !== undefined && localUri.current?.versionCode === versionCode ? 'ready' : 'idle');
  }, [changePhase]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (verifyTimer.current !== null) clearTimeout(verifyTimer.current);
    };
  }, []);

  // Lejen daekker ogsaa en hentning der begyndte i menuen. Hver afspiller
  // venter med APK-netvaerk, indtil den sidste stille periode er afsluttet.
  useEffect(() => quiet ? pauseApkDownloads() : undefined, [quiet]);

  useEffect(() => onDownloadProgress(setProgress), []);

  /** Henter filen (eller genbruger den) og goer bjaelken klar til at installere. */
  const prepare = useCallback(async (info: UpdateInfo): Promise<string | null> => {
    if (quietRef.current || !mounted.current || phaseRef.current === 'downloading' || phaseRef.current === 'installing') return null;
    if (localUri.current !== null && localUri.current.versionCode === info.versionCode) return localUri.current.uri;
    changePhase('downloading');
    setMessage(null);
    try {
      const uri = await downloadApk(info);
      if (!mounted.current) return null;
      localUri.current = { versionCode: info.versionCode, uri };
      markReady();
      return uri;
    } catch (error) {
      if (!mounted.current) return null;
      setMessage(error instanceof Error ? error.message : 'Opdateringen kunne ikke hentes.');
      changePhase('idle');
      return null;
    }
  }, [changePhase, markReady]);

  useEffect(() => {
    let cancelled = false;
    const check = async (): Promise<void> => {
      try {
        const info = await checkForUpdate();
        if (cancelled) return;
        const next = info.available ? info : null;
        foundRef.current = next;
        setFound(next);
        if (phaseRef.current === 'ready' && localUri.current?.versionCode !== next?.versionCode) changePhase('idle');
      } catch {
        // Stille med vilje: ingen forbindelse eller ingen udgivelse er ikke noget at vise.
      }
    };
    const first = setTimeout(() => void check(), FIRST_CHECK_MS);
    const timer = setInterval(() => void check(), POLL_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
      subscription.remove();
    };
  }, [prepare, changePhase]);

  // Kendte udgaver hentes straks efter afspilning, uden et nyt opslag eller
  // ventetid til naeste halvtime. Fejlede auto-forsoeg gentages kun manuelt.
  useEffect(() => {
    if (quietRef.current || found === null || !isTV || !found.available
      || prefetched.current.has(found.versionCode) || phaseRef.current !== 'idle') return;
    prefetched.current.add(found.versionCode);
    void prepare(found);
  }, [quiet, found, phase, prepare]);

  const visible =
    found !== null && !quiet && (snoozed.current.get(found.versionCode) ?? 0) <= Date.now();

  const later = (): void => {
    const info = foundRef.current;
    if (info === null) return;
    snoozed.current.set(info.versionCode, Date.now() + SNOOZE_MS);
    setMessage(null);
    setFound({ ...info });
  };

  const install = async (): Promise<void> => {
    if (quietRef.current || found === null || installing.current || phaseRef.current === 'downloading' || phaseRef.current === 'installing') return;
    installing.current = true;
    const info = found;
    const startedQuietRevision = quietRevision.current;
    try {
      const uri = await prepare(info);
      // En bruger der begyndte at se TV under hentningen skal selv trykke
      // igen bagefter; installeren maa ikke aabne sent oven paa afspilleren.
      if (uri === null || !mounted.current || quietRef.current || quietRevision.current !== startedQuietRevision
        || foundRef.current?.versionCode !== info.versionCode) return;
      changePhase('installing');
      setMessage(null);
      const outcome = await installApk(uri);
      if (!mounted.current) return;
      if (outcome.kind === 'installed') {
        // Android skifter appen ud og lukker den normalt her. Lever den
        // videre, ses om den blev ny; ellers siges det.
        setMessage('Installeret — appen genstarter …');
        verifyTimer.current = setTimeout(() => {
          verifyTimer.current = null;
          void checkForUpdate()
            .then((again) => {
              if (!mounted.current) return;
              if (!again.available) {
                foundRef.current = null;
                setFound(null);
                return;
              }
              setMessage('Android meldte "installeret", men appen er stadig udgave ' + currentVersionCode() + '. Genstart enheden, og prøv igen.');
              markReady();
            })
            .catch(() => { if (mounted.current) markReady(); });
        }, VERIFY_MS);
        return;
      }
      if (outcome.kind === 'cancelled') {
        markReady();
        if (foundRef.current?.versionCode === info.versionCode) later();
        return;
      }
      setMessage(outcome.text);
      if (shouldDiscardAfter(outcome)) {
        await discardApk(info.versionCode);
        if (!mounted.current) return;
        localUri.current = null;
        changePhase('idle');
      } else {
        markReady();
      }
    } catch (error) {
      if (!mounted.current) return;
      setMessage(error instanceof Error ? error.message : 'Installationen kunne ikke startes.');
      markReady();
    } finally {
      installing.current = false;
    }
  };

  // Paa tv ligger bjaelken uden for indholdets fokusfaelde, saa pilene kan
  // ikke naa den: knappen faar fokus i én tegning naar bjaelken kommer frem,
  // og igen naar filen er hel ("Installér nu") — ikke fast, for saa greb den
  // fokus ved hver procent-opdatering (v348: "kan umuligt komme hen og
  // trykke opdater").
  const [grabFocus, setGrabFocus] = useState(false);
  useEffect(() => {
    if (!isTV || !visible) return undefined;
    if (phase !== 'idle' && phase !== 'ready') return undefined;
    const timer = setTimeout(() => setGrabFocus(true), 120);
    return () => clearTimeout(timer);
  }, [visible, phase]);
  useEffect(() => {
    if (!grabFocus) return undefined;
    const frame = requestAnimationFrame(() => setGrabFocus(false));
    return () => cancelAnimationFrame(frame);
  }, [grabFocus]);

  // Tilbage = senere, foer den goer noget andet.
  useEffect(() => {
    if (!visible) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      later();
      return true;
    });
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, found]);

  if (!visible || found === null) return null;
  const busy = phase === 'downloading' || phase === 'installing';
  const percent = progress !== null && progress.versionCode === found.versionCode ? percentText(progress.written, progress.total) : null;
  const buttonText =
    phase === 'downloading'
      ? `Henter${percent === null ? ' …' : ` ${percent}`}`
      : phase === 'installing'
        ? 'Installerer …'
        : phase === 'ready'
          ? 'Installér nu'
          : 'Opdater nu';
  return (
    <View style={styles.host} pointerEvents="box-none">
      <View style={styles.banner}>
        <View style={styles.text}>
          <Text style={styles.label}>Ny udgave klar</Text>
          <Text style={styles.title}>
            NorStream {found.versionCode}
            <Text style={styles.have}> · du har {currentVersionCode()}</Text>
          </Text>
          {message !== null && <Text style={styles.message}>{message}</Text>}
        </View>
        <TvPressable
          style={[styles.button, styles.buttonAccent]}
          hasTVPreferredFocus={grabFocus}
          disabled={busy}
          onPress={() => void install()}
        >
          {busy ? (
            <View style={styles.busy}>
              <ActivityIndicator color={colors.text} size="small" />
              <Text style={styles.buttonText}>{buttonText}</Text>
            </View>
          ) : (
            <Text style={styles.buttonText}>{buttonText}</Text>
          )}
        </TvPressable>
        {!isTV && (
          <TvPressable style={styles.button} disabled={busy} onPress={later}>
            <Text style={styles.buttonText}>Senere</Text>
          </TvPressable>
        )}
      </View>
      {isTV && (
        <Text style={styles.hint}>
          {phase === 'downloading' ? 'Hentningen sættes på pause, mens du ser TV' : phase === 'installing' ? 'Følg installationen på skærmen' : 'Tilbage: senere'}
        </Text>
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  host: {
    position: 'absolute',
    top: theme.spacing.md,
    right: theme.spacing.md,
    alignItems: 'flex-end',
    gap: theme.spacing.xs,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    maxWidth: 560,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.accent,
    borderWidth: 2,
    borderRadius: theme.radius,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  text: { flexShrink: 1, minWidth: 120 },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  title: { color: colors.text, fontSize: 15, fontWeight: '700' },
  have: { color: colors.textMuted, fontSize: 13, fontWeight: '400' },
  message: { color: colors.text, fontSize: 12, marginTop: 2, lineHeight: 16 },
  button: {
    backgroundColor: colors.surface,
    borderRadius: theme.radius,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    minWidth: 96,
    alignItems: 'center',
  },
  buttonAccent: { backgroundColor: colors.accent },
  buttonText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  busy: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
  hint: { color: colors.textMuted, fontSize: 11 },
});
