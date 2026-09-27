import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, StyleSheet, Text, View } from 'react-native';
import { theme } from '../../ui/theme.js';
import type { ThemeColors } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { isTV } from '../../ui/tv.js';
import { checkForUpdate, downloadAndInstall } from './appUpdate.js';
import type { UpdateInfo } from './appUpdate.js';

/** Foerste kig lidt efter opstart, saa opstarten ikke venter paa netvaerket. */
const FIRST_CHECK_MS = 60_000;
/** Mens appen koerer. GitHub tillader 60 opslag i timen per adresse; det her er to. */
const POLL_MS = 30 * 60_000;
/** "Senere": saa laenge foer den samme udgave vises igen. */
const SNOOZE_MS = 6 * 60 * 60_000;

/**
 * Popup'en naar en ny udgave er klar — uden at lukke appen og uden at gaa i
 * Indstillinger (brugerens oenske, v337).
 *
 * Appen kigger selv efter en nyere udgave kort efter start, hver gang den
 * kommer frem igen, og hver halve time. Er der en, vises en bjaelke i hjoernet
 * (samme form som paamindelserne): "Opdater nu" henter APK'en og starter
 * Androids installation. Paa tv har knappen fokus, og Tilbage er "senere";
 * paa telefonen er der en Senere-knap. Under afspilning (`quiet`) ventes der
 * til man er ude af afspilleren — en opdatering maa aldrig afbryde en film.
 *
 * Alt er stille ved fejl: ingen forbindelse eller ingen udgivelse er ikke
 * noget at vise.
 */
export function UpdateBanner({ quiet }: { quiet: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const [found, setFound] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** Udgave -> tidspunkt hvor den maa vises igen. */
  const snoozed = useRef(new Map<number, number>());

  useEffect(() => {
    let cancelled = false;
    const check = async (): Promise<void> => {
      try {
        const info = await checkForUpdate();
        if (cancelled) return;
        setFound(info.available ? info : null);
      } catch {
        // Stille med vilje: se ovenfor.
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
  }, []);

  const visible =
    found !== null && !quiet && (snoozed.current.get(found.versionCode) ?? 0) <= Date.now();

  const later = (): void => {
    if (found === null) return;
    snoozed.current.set(found.versionCode, Date.now() + SNOOZE_MS);
    setMessage(null);
    setFound({ ...found });
  };

  const install = async (): Promise<void> => {
    if (found === null || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await downloadAndInstall(found.url);
      // Androids installation har overtaget. Afviser man den, kommer
      // bjaelken igen senere.
      later();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Opdateringen kunne ikke hentes.');
    } finally {
      setBusy(false);
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
  return (
    <View style={styles.host} pointerEvents="box-none">
      <View style={styles.banner}>
        <View style={styles.text}>
          <Text style={styles.label}>Ny udgave klar</Text>
          <Text style={styles.title}>NorStream {found.versionCode}</Text>
          {message !== null && <Text style={styles.message}>{message}</Text>}
        </View>
        <TvPressable
          style={[styles.button, styles.buttonAccent]}
          hasTVPreferredFocus={isTV}
          disabled={busy}
          onPress={() => void install()}
        >
          {busy ? <ActivityIndicator color={colors.text} /> : <Text style={styles.buttonText}>Opdater nu</Text>}
        </TvPressable>
        {!isTV && (
          <TvPressable style={styles.button} disabled={busy} onPress={later}>
            <Text style={styles.buttonText}>Senere</Text>
          </TvPressable>
        )}
      </View>
      {isTV && <Text style={styles.hint}>{busy ? 'Henter opdateringen …' : 'Tilbage: senere'}</Text>}
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
    maxWidth: 520,
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
  message: { color: colors.text, fontSize: 12, marginTop: 2 },
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
  hint: { color: colors.textMuted, fontSize: 11 },
});
