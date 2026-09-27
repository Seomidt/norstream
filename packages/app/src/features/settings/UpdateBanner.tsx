import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, StyleSheet, Text, View } from 'react-native';
import { theme } from '../../ui/theme.js';
import type { ThemeColors } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { isTV } from '../../ui/tv.js';
import { checkForUpdate, currentVersionCode, discardApk, downloadApk, installApk, onDownloadProgress, shouldDiscardAfter } from './appUpdate.js';
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
  phaseRef.current = phase;

  useEffect(() => onDownloadProgress(setProgress), []);

  /** Henter filen (eller genbruger den) og goer bjaelken klar til at installere. */
  const prepare = useCallback(async (info: UpdateInfo): Promise<string | null> => {
    if (localUri.current !== null && localUri.current.versionCode === info.versionCode) return localUri.current.uri;
    setPhase('downloading');
    setMessage(null);
    try {
      const uri = await downloadApk(info);
      localUri.current = { versionCode: info.versionCode, uri };
      setPhase('ready');
      return uri;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Opdateringen kunne ikke hentes.');
      setPhase('idle');
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const check = async (): Promise<void> => {
      try {
        const info = await checkForUpdate();
        if (cancelled) return;
        setFound(info.available ? info : null);
        // Tv: hent filen af sig selv, saa den er klar naar man trykker. Én
        // gang per udgave, og aldrig mens der allerede hentes/installeres.
        if (info.available && isTV && !prefetched.current.has(info.versionCode) && phaseRef.current === 'idle') {
          prefetched.current.add(info.versionCode);
          void prepare(info);
        }
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
  }, [prepare]);

  const visible =
    found !== null && !quiet && (snoozed.current.get(found.versionCode) ?? 0) <= Date.now();

  const later = (): void => {
    if (found === null) return;
    snoozed.current.set(found.versionCode, Date.now() + SNOOZE_MS);
    setMessage(null);
    setFound({ ...found });
  };

  const install = async (): Promise<void> => {
    if (found === null || phase === 'downloading' || phase === 'installing') return;
    const info = found;
    const uri = await prepare(info);
    if (uri === null) return;
    setPhase('installing');
    setMessage(null);
    try {
      const outcome = await installApk(uri);
      if (outcome.kind === 'installed') {
        // Android skifter appen ud og lukker den normalt her. Lever den
        // videre, ses om den blev ny; ellers siges det.
        setMessage('Installeret — appen genstarter …');
        setTimeout(() => {
          void checkForUpdate()
            .then((again) => {
              if (!again.available) {
                setFound(null);
                return;
              }
              setMessage('Android meldte "installeret", men appen er stadig udgave ' + currentVersionCode() + '. Genstart enheden, og prøv igen.');
              setPhase('ready');
            })
            .catch(() => setPhase('ready'));
        }, VERIFY_MS);
        return;
      }
      if (outcome.kind === 'cancelled') {
        setPhase('ready');
        later();
        return;
      }
      setMessage(outcome.text);
      if (shouldDiscardAfter(outcome)) {
        await discardApk(info.versionCode);
        localUri.current = null;
        setPhase('idle');
      } else {
        setPhase('ready');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Installationen kunne ikke startes.');
      setPhase('ready');
    }
  };

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
          hasTVPreferredFocus={isTV}
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
          {phase === 'downloading' ? 'Henter opdateringen — du kan se tv imens' : phase === 'installing' ? 'Følg installationen på skærmen' : 'Tilbage: senere'}
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
