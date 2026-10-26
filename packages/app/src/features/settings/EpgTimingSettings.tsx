import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getArchiveTimeShift, getEpgTimeShift, setEpgTimeShifts } from '../../storage/epgTiming.js';
import { listSources } from '../../storage/sources.js';
import type { SqlDatabase } from '../../storage/types.js';
import { useStyles } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { TvPressable } from '../../ui/TvPressable.js';

const LIMIT_MINUTES = 12 * 60;
interface TimingSource { id: string; name: string; hasArchive: boolean; epgMinutes: number; archiveMinutes: number }
interface TimingState { db: SqlDatabase; sources: TimingSource[] }
interface Props { db: SqlDatabase; onChanged?: () => void; showEpg?: boolean }

function timingText(minutes: number): string {
  if (minutes === 0) return '0 minutter';
  const sign = minutes > 0 ? '+' : '−';
  const amount = Math.abs(minutes);
  return amount % 60 === 0
    ? `${sign}${amount / 60} ${amount === 60 ? 'time' : 'timer'}`
    : `${sign}${amount} minutter`;
}

/** Kildens programtid og arkivtid kan rettes hver for sig uden genstart. */
export function EpgTimingSettings({ db, onChanged, showEpg = true }: Props) {
  const styles = useStyles(makeStyles);
  const [state, setState] = useState<TimingState | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const pending = useRef(new Map<string, { db: SqlDatabase; token: symbol }>());
  const [error, setError] = useState<string | null>(null);
  const currentDb = useRef(db);
  currentDb.current = db;
  const mounted = useRef(false);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  useEffect(() => {
    let cancelled = false;
    mounted.current = true;
    setError(null);
    setSaving(new Set());
    void listSources(db).then(async (all) => {
      const sources = await Promise.all(all.filter(source => source.enabled).map(async source => {
        const [epgMinutes, archiveMinutes] = await Promise.all([
          getEpgTimeShift(db, source.id), getArchiveTimeShift(db, source.id),
        ]);
        return { id: source.id, name: source.name, hasArchive: source.kind === 'xtream', epgMinutes, archiveMinutes };
      }));
      if (!cancelled) setState({ db, sources });
    }).catch(() => {
      if (!cancelled) setError('Tidsindstillingerne kunne ikke hentes. Åbn Indstillinger igen.');
    });
    return () => { cancelled = true; mounted.current = false; };
  }, [db]);

  async function adjust(sourceId: string, field: 'epgMinutes' | 'archiveMinutes', delta: number | null): Promise<void> {
    const current = stateRef.current;
    if (current?.db !== db || pending.current.get(sourceId)?.db === db) return;
    const source = current.sources.find(item => item.id === sourceId);
    if (source === undefined) return;
    const value = delta === null ? 0 : Math.max(-LIMIT_MINUTES, Math.min(LIMIT_MINUTES, source[field] + delta));
    if (value === source[field]) return;
    const next = { ...source, [field]: value };
    const token = Symbol('epg-timing-save');
    pending.current.set(sourceId, { db, token });
    const savingForDb = () => new Set([...pending.current].filter(([, entry]) => entry.db === db).map(([id]) => id));
    setSaving(savingForDb());
    setError(null);
    try {
      await setEpgTimeShifts(db, sourceId, { epgMinutes: next.epgMinutes, archiveMinutes: next.archiveMinutes });
      if (!mounted.current || currentDb.current !== db) return;
      const previous = stateRef.current;
      if (previous?.db === db) {
        const updated = { db, sources: previous.sources.map(item => item.id === sourceId ? next : item) };
        stateRef.current = updated;
        setState(updated);
      }
      changed.current?.();
    } catch {
      if (mounted.current && currentDb.current === db) setError('Tiden kunne ikke gemmes. Prøv igen.');
    } finally {
      if (pending.current.get(sourceId)?.token === token) pending.current.delete(sourceId);
      if (mounted.current && currentDb.current === db) setSaving(savingForDb());
    }
  }

  const sources = state?.db === db ? state.sources.filter(source => showEpg || source.hasArchive) : null;
  if (sources?.length === 0 && error === null) return null;
  return <View>
    <Text style={styles.sectionTitle}>{showEpg ? 'EPG-tid' : 'Arkivtid'}</Text>
    {showEpg && <Text style={styles.hint}>Viser guiden kl. 18 for en udsendelse, der begynder kl. 19, skal Programtider være +1 time. Gælder med det samme.</Text>}
    {sources === null && error === null && <Text style={styles.hint}>Henter tidsindstillinger …</Text>}
    {sources?.map(source => <View key={source.id} style={styles.source}>
      <Text style={styles.sourceName}>{source.name}</Text>
      {(source.hasArchive ? ['epgMinutes', 'archiveMinutes'] as const : ['epgMinutes'] as const).filter(field => showEpg || field !== 'epgMinutes').map(field => {
        const label = field === 'epgMinutes' ? 'Programtider' : 'Arkivtid';
        return <View key={field} style={styles.field}>
          <Text style={styles.value}>{label}: {timingText(source[field])}</Text>
          {field === 'archiveMinutes' && <Text style={styles.hint}>Ret Arkivtid, hvis Start forfra åbner en forkert udsendelse. +1 time åbner arkivet én time senere.</Text>}
          <View style={styles.controls}>
            {([{ text: '−1 time', delta: -60 }, { text: 'Nulstil', delta: null }, { text: '+1 time', delta: 60 }] as const).map(option => <TvPressable
              key={option.text}
              style={[styles.button, (saving.has(source.id) || (option.delta === -60 && source[field] <= -LIMIT_MINUTES) || (option.delta === 60 && source[field] >= LIMIT_MINUTES)) && styles.inactive]}
              accessibilityLabel={`${source.name}: ${label}, ${option.text}`}
              accessibilityState={{ busy: saving.has(source.id) }}
              onPress={() => { void adjust(source.id, field, option.delta); }}
            ><Text style={styles.buttonText}>{option.text}</Text></TvPressable>)}
          </View>
        </View>;
      })}
      <Text style={styles.status}>{saving.has(source.id) ? 'Gemmer …' : ' '}</Text>
    </View>)}
    {error !== null && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
  </View>;
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  sectionTitle: { color: colors.textMuted, fontSize: 13, fontWeight: '600', marginTop: 20, marginBottom: 8 },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginBottom: 8 },
  source: { backgroundColor: colors.surface, borderRadius: 8, padding: 14, marginBottom: 12 },
  sourceName: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 12 },
  field: { marginBottom: 12 },
  value: { color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: 8 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { backgroundColor: colors.surfaceRaised, borderRadius: 8, minWidth: 84, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center' },
  buttonText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  inactive: { opacity: 0.5 },
  status: { color: colors.textMuted, fontSize: 12, minHeight: 16 },
  error: { color: colors.text, fontSize: 13, lineHeight: 18, marginBottom: 8 },
});
