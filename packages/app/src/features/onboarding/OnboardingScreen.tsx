import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createFetchImpl } from '../../net/fetchImpl.js';
import { openDatabase } from '../../storage/db.js';
import { connectM3u, connectXtream } from '../../sources/connect.js';
import { Aurora } from '../../ui/Aurora.js';
import { Logo } from '../../ui/Logo.js';
import { theme } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { isTV } from '../../ui/tv.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { TvTextInput } from '../../ui/TvTextInput.js';

interface Props {
  onDone: () => void;
  /**
   * Forklaring fra den rute der sendte brugeren hertil — f.eks. at panelet
   * afviste credentials, saa de blev slettet fra enheden.
   */
  notice?: string;
}

type Kind = 'xtream' | 'm3u';

/**
 * Foerste skaerm: forbind til en udbyder.
 *
 * **Begge slags kilder kan vaelges her.** Foer kunne kun et Xtream-panel
 * tilfoejes ved foerste start, og en M3U-liste kunne foerst laegges ind inde i
 * appen — som man skulle logge ind for at komme ind i. Den der kun har en
 * M3U-liste, kunne altsaa ikke komme i gang.
 */
export function OnboardingScreen({ onDone, notice }: Props) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [kind, setKind] = useState<Kind>('xtream');
  const [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [xmltvUrl, setXmltvUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPanel = kind === 'xtream';

  async function connect(): Promise<void> {
    setBusy(true);
    setError(null);
    // busy skal altid ryddes, uanset hvilken gren der returnerer eller kaster
    // — ellers staar skaermen med en spinner der aldrig stopper.
    try {
      const db = await openDatabase();
      const fetchImpl = createFetchImpl();
      const result = isPanel
        ? await connectXtream(db, fetchImpl, {
            url: baseUrl,
            username,
            password,
            xmltvUrl,
          })
        : await connectM3u(db, fetchImpl, { url: baseUrl, xmltvUrl });

      if (!result.ok) {
        setError(result.message);
        return;
      }
      onDone();
    } catch {
      setError('Noget gik galt på denne enhed. Prøv igen.');
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = isPanel
    ? baseUrl.trim().length > 0 && username.trim().length > 0 && password.length > 0
    : baseUrl.trim().length > 0;

  /** OK i et felt: forbind, naar alt er udfyldt. Paa tv slipper man for at finde knappen. */
  const submitFromField = (): void => {
    if (canSubmit && !busy) void connect();
  };
  const inputStyle = [styles.input, isTV && styles.inputTv];

  return (
    <View style={styles.container}>
      <Aurora height="52%" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Paa tv staar logoet til venstre og kortet til hoejre: skaermen er
            bred og lav, og med logoet ovenover roeg knappen nederst ud af
            billedet, hvor fjernbetjeningen ikke kunne naa den. */}
        <ScrollView
          contentContainerStyle={[
            styles.content,
            isTV && styles.contentTv,
            { paddingTop: insets.top + (isTV ? theme.spacing.md : theme.spacing.xl), paddingBottom: insets.bottom + theme.spacing.xl },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.header, isTV && styles.headerTv]}>
            <Logo size={isTV ? 64 : 88} />
            <Text style={[styles.title, isTV && styles.titleTv]}>NorStream</Text>
            <Text style={styles.subtitle}>
              {isPanel ? 'Forbind til dit panel' : 'Hent din M3U-liste'}
            </Text>
            {notice !== undefined && <Text style={styles.notice}>{notice}</Text>}
          </View>

          <View style={[styles.card, isTV && styles.cardTv]}>
            {/* Valget staar oeverst i kortet, ikke nede ved knappen: felterne
                nedenfor skifter med det, og et valg man opdager bagefter er
                et valg man har taget forkert. */}
            <View style={styles.tabs}>
              <KindTab
                label="Panel"
                hint="Xtream"
                active={isPanel}
                onPress={() => setKind('xtream')}
              />
              <KindTab
                label="M3U-liste"
                hint="En adresse"
                active={!isPanel}
                onPress={() => setKind('m3u')}
              />
            </View>

            <TvTextInput
              style={inputStyle}
              onSubmitEditing={submitFromField}
              returnKeyType="go"
              blurOnSubmit={false}
              placeholder={isPanel ? 'http://panel.example:8080' : 'http://.../liste.m3u'}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="url"
              value={baseUrl}
              onChangeText={setBaseUrl}
            />

            {isPanel && (
              <>
                <TvTextInput
                  style={inputStyle}
              onSubmitEditing={submitFromField}
              returnKeyType="go"
              blurOnSubmit={false}
                  placeholder="Brugernavn"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={username}
                  onChangeText={setUsername}
                />
                <TvTextInput
                  style={inputStyle}
              onSubmitEditing={submitFromField}
              returnKeyType="go"
              blurOnSubmit={false}
                  placeholder="Adgangskode"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                />
              </>
            )}

            <TvTextInput
              style={inputStyle}
              onSubmitEditing={submitFromField}
              returnKeyType="go"
              blurOnSubmit={false}
              placeholder="XMLTV-adresse (valgfri)"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="url"
              value={xmltvUrl}
              onChangeText={setXmltvUrl}
            />
            {!isTV && (
            <Text style={styles.hint}>
              {isPanel
                ? 'Panelet leverer selv programoversigt. En XMLTV-adresse fylder hullerne for de kanaler panelet ikke har data til.'
                : 'En M3U-liste rummer ingen programoversigt. Uden en XMLTV-adresse står guiden tom for kanalerne herfra.'}
            </Text>
            )}

            {error !== null && <Text style={styles.error}>{error}</Text>}

            <TvPressable
              style={[styles.button, (!canSubmit || busy) && styles.buttonDisabled]}
              disabled={!canSubmit || busy}
              onPress={() => {
                void connect();
              }}
            >
              {busy ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <Text style={styles.buttonText}>{isPanel ? 'Forbind' : 'Hent listen'}</Text>
              )}
            </TvPressable>
          </View>

          {!isTV && <Text style={styles.footer}>Du kan tilføje flere kilder senere under Indstillinger.</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function KindTab({
  label,
  hint,
  active,
  onPress,
}: {
  label: string;
  hint: string;
  active: boolean;
  onPress: () => void;
}) {
  const styles = useStyles(makeStyles);
  return (
    <TvPressable style={[styles.tab, active && styles.tabActive]} onPress={onPress}>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
      <Text style={styles.tabHint}>{hint}</Text>
    </TvPressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  // Kortet oeverst, ikke midt paa: saa er knappen nederst i kortet paa skaermen.
  contentTv: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.xl, justifyContent: 'flex-start' },
  header: { alignItems: 'center', marginBottom: theme.spacing.xl },
  headerTv: { flex: 1, marginBottom: 0, paddingTop: theme.spacing.lg },
  titleTv: { fontSize: 30 },
  cardTv: { flex: 1.4 },
  title: {
    color: colors.text,
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginTop: theme.spacing.md,
  },
  subtitle: { color: colors.textMuted, fontSize: 15, marginTop: theme.spacing.xs },
  // Kortet er nesten uigennemsigtigt: felterne skal kunne laeses oven paa
  // nordlyset, og en let baggrund ville lade billedet skinne igennem teksten.
  card: {
    backgroundColor: colors.cardOverlay,
    borderRadius: theme.radius * 1.8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: theme.spacing.md,
  },
  tabs: { flexDirection: 'row', gap: theme.spacing.sm, marginBottom: theme.spacing.md },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabActive: { borderColor: colors.accent, backgroundColor: colors.surfaceRaised },
  tabLabel: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
  tabLabelActive: { color: colors.text },
  tabHint: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    color: colors.text,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    fontSize: 16,
  },
  /** Tv-skaermen er lav: mindre felter, saa kortet med knappen er paa skaermen paa én gang. */
  inputTv: { paddingVertical: theme.spacing.sm, marginBottom: theme.spacing.xs, fontSize: 14 },
  hint: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: theme.spacing.sm,
  },
  notice: {
    color: colors.text,
    fontSize: 14,
    marginBottom: theme.spacing.md,
    textAlign: 'center',
  },
  error: {
    color: colors.danger,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: theme.radius,
    padding: theme.spacing.md,
    alignItems: 'center',
    marginTop: theme.spacing.xs,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  footer: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: theme.spacing.lg,
  },
});
