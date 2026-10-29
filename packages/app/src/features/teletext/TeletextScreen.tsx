import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';
import type { ThemeColors } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import { isTV, useCanvasSize } from '../../ui/tv.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { webView } from '../vod/webview.js';
import {
  adjacentTeletextPage, isTeletextPage, loadDrTeletextPage, TELETEXT_REFRESH_MS,
  TeletextError, teletextImageDocument,
} from './drTeletext.js';
import type { LoadedTeletextPage } from './drTeletext.js';

const ImageWebView = webView();
const DIGITS = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['⌫', '0', 'Vis']];

interface Props {
  active?: boolean;
  focusFirstSignal?: number;
  backRef?: { current: () => boolean };
}

/** DR's egne sider, med et taltastatur der ogsaa virker paa Google TV. */
export function TeletextScreen({ active = true, focusFirstSignal = 0, backRef }: Props) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const { width } = useCanvasSize();
  const [number, setNumber] = useState(100);
  const [draft, setDraft] = useState('');
  const [page, setPage] = useState<LoadedTeletextPage | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const [enterFocus, setEnterFocus] = useState(false);
  const consumed = useRef(focusFirstSignal);
  const shown = page?.number === number ? page : null;
  const document = useMemo(() => shown ? { html: teletextImageDocument(shown) } : null, [shown]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!isTV || focusFirstSignal === consumed.current) return;
    consumed.current = focusFirstSignal;
    setEnterFocus(true);
  }, [focusFirstSignal]);
  useEffect(() => {
    if (!enterFocus) return;
    const frame = requestAnimationFrame(() => setEnterFocus(false));
    return () => cancelAnimationFrame(frame);
  }, [enterFocus]);
  useEffect(() => {
    if (!active || !foreground || ImageWebView === null) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    setLoading(true);
    setProblem(null);
    void loadDrTeletextPage(number, controller.signal).then(result => {
      if (!cancelled) setPage(result);
    }).catch((cause: unknown) => {
      if (cancelled) return;
      setProblem(cause instanceof TeletextError && cause.kind === 'missing'
        ? `DR har ikke side ${number} tilgængelig på nettet.`
        : 'DR’s tekst-tv kunne ikke hentes. Prøv igen.');
    }).finally(() => {
      clearTimeout(timeout);
      if (!cancelled) setLoading(false);
    });
    const refresh = setTimeout(() => setRevision(value => value + 1), TELETEXT_REFRESH_MS);
    return () => { cancelled = true; controller.abort(); clearTimeout(timeout); clearTimeout(refresh); };
  }, [number, revision, active, foreground]);

  if (backRef) backRef.current = () => {
    if (draft.length === 0) return false;
    setDraft('');
    return true;
  };

  function go(next: number): void {
    if (!isTeletextPage(next)) return;
    setDraft('');
    setProblem(null);
    if (next === number) setRevision(value => value + 1);
    else setNumber(next);
  }
  function key(value: string): void {
    if (value === '⌫') { setDraft(current => current.slice(0, -1)); return; }
    if (value === 'Vis') { if (draft.length === 3) go(Number(draft)); return; }
    if (draft.length === 0 && (value === '0' || value === '9')) return;
    const next = draft + value;
    if (next.length === 3) go(Number(next));
    else setDraft(next);
  }

  return (
    <View style={[styles.container, width < 700 && styles.narrow]}>
      <View style={styles.page}>
        {shown && ImageWebView && document && (
          <View style={styles.image} pointerEvents="none" importantForAccessibility="no-hide-descendants">
            <ImageWebView
              key={`${shown.number}:${shown.loadedAt}`}
              source={document}
              style={styles.image}
              focusable={false}
              javaScriptEnabled={false}
              domStorageEnabled={false}
              scrollEnabled={false}
              originWhitelist={['about:*', 'data:*']}
              onShouldStartLoadWithRequest={request => request.url === 'about:blank' || request.url.startsWith('data:text/html')}
              setSupportMultipleWindows={false}
              onError={() => setProblem('Tekst-tv-billedet kunne ikke vises. Prøv igen.')}
              onRenderProcessGone={() => setProblem('Tekst-tv-visningen blev lukket. Prøv igen.')}
            />
          </View>
        )}
        {!shown && loading && <ActivityIndicator color={colors.accent} size="large" />}
        {ImageWebView === null && <Text style={styles.message}>Tekst-tv kan ikke vises på denne enhed.</Text>}
        {!shown && !loading && problem && <Text style={styles.message}>{problem}</Text>}
      </View>
      <View style={styles.controls}>
        <Text style={styles.title}>DR Tekst-tv</Text>
        <Text accessibilityLiveRegion="polite" style={styles.number}>
          Side {draft.length > 0 ? draft.padEnd(3, '–') : number}
        </Text>
        <View style={styles.row}>
          <TvPressable style={styles.button} accessibilityLabel="Forrige tekst-tv-side" onPress={() => go(shown?.previous ?? adjacentTeletextPage(number, -1))}>
            <Text style={styles.label}>‹ Forrige</Text>
          </TvPressable>
          <TvPressable style={styles.button} accessibilityLabel="Næste tekst-tv-side" onPress={() => go(shown?.next ?? adjacentTeletextPage(number, 1))}>
            <Text style={styles.label}>Næste ›</Text>
          </TvPressable>
        </View>
        <View style={styles.row}>
          {[100, 110, 200].map(value => (
            <TvPressable key={value} style={styles.button} accessibilityLabel={`Tekst-tv side ${value}`} hasTVPreferredFocus={value === 100 && enterFocus}
              onPress={() => go(value)}>
              <Text style={styles.label}>{value}</Text>
            </TvPressable>
          ))}
        </View>
        {DIGITS.map((row, index) => (
          <View key={index} style={styles.row}>
            {row.map(value => (
              <TvPressable key={value} style={styles.digit} accessibilityLabel={value === '⌫' ? 'Slet sidste ciffer' : value}
                onPress={() => key(value)}>
                <Text style={styles.digitText}>{value}</Text>
              </TvPressable>
            ))}
          </View>
        ))}
        <Text style={styles.hint}>Vælg tre cifre for at skifte side.</Text>
        <TvPressable style={styles.refresh} onPress={() => setRevision(value => value + 1)}>
          <Text style={styles.label}>{loading ? 'Henter …' : 'Opdatér siden'}</Text>
        </TvPressable>
        <Text style={styles.status} accessibilityLiveRegion="polite">
          {problem ?? (shown ? 'Original side fra dr.dk · opdateres hvert minut' : '')}
        </Text>
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', padding: 12, gap: 12, backgroundColor: colors.background },
  narrow: { flexDirection: 'column' },
  page: { flex: 1, minHeight: 100, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000000' },
  image: { flex: 1, width: '100%', backgroundColor: '#000000' },
  message: { color: '#ffffff', fontSize: 16, lineHeight: 23, textAlign: 'center', padding: 16 },
  controls: { width: 232, maxWidth: '100%', alignSelf: 'center', gap: 6 },
  title: { color: colors.text, fontSize: 19, fontWeight: '700' },
  number: { color: colors.text, fontSize: 22, fontVariant: ['tabular-nums'], marginBottom: 2 },
  row: { flexDirection: 'row', gap: 6 },
  button: { flex: 1, backgroundColor: colors.surfaceRaised, paddingVertical: 9, alignItems: 'center', borderRadius: 4 },
  label: { color: colors.text, fontSize: 14, fontWeight: '600' },
  digit: { flex: 1, backgroundColor: colors.surfaceRaised, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 4 },
  digitText: { color: colors.text, fontSize: 19, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  refresh: { backgroundColor: colors.surfaceRaised, padding: 9, alignItems: 'center', borderRadius: 4 },
  status: { color: colors.textMuted, fontSize: 12, lineHeight: 16, minHeight: 32 },
});
