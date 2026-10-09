import { useEffect, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { listRadioFavorites } from '@norstream/app/src/storage/radio.js';
import type { SqlDatabase } from '@norstream/app/src/storage/types.js';
import { theme } from '@norstream/app/src/ui/theme.js';
import { ChannelLogo } from '@norstream/app/src/ui/ChannelLogo.js';
import { canScheduleExactAlarms, getAlarm, openExactAlarmSettings, setAlarm } from '../modules/radio-auto/index.js';
import type { AlarmSetting, AutoStation } from '../modules/radio-auto/index.js';
import { toAutoStation } from './library.js';
import { parseClock } from './clock.js';

interface Props {
  db: SqlDatabase;
}

const pad = (value: number): string => String(value).padStart(2, '0');

function describeNext(nextMs: number | null): string {
  if (nextMs === null) return '';
  const date = new Date(nextMs);
  const today = new Date();
  const sameDay = date.getDate() === today.getDate() && date.getMonth() === today.getMonth();
  return `${sameDay ? 'I dag' : 'I morgen'} kl. ${pad(date.getHours())}.${pad(date.getMinutes())}`;
}

/**
 * Vaekkeuret: vaagn til radio.
 *
 * Et klokkeslaet, en af ens stationer, og en kontakt. Uret ringer hver dag
 * paa tiden, ogsaa naar appen er lukket: telefonens eget alarmsystem
 * starter tjenesten bag Android Auto, som spiller stationen.
 */
export function AlarmScreen({ db }: Props) {
  const [alarm, setAlarmState] = useState<AlarmSetting>(() => getAlarm());
  const [clock, setClock] = useState(() => `${pad(alarm.hour)}.${pad(alarm.minute)}`);
  const [favourites, setFavourites] = useState<AutoStation[]>([]);
  const [exactAllowed, setExactAllowed] = useState(() => canScheduleExactAlarms());

  useEffect(() => {
    void listRadioFavorites(db).then((list) => setFavourites(list.map(toAutoStation)));
  }, [db]);

  // Tilbage fra systemets indstillinger: se om lov til praecise alarmer blev givet.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setExactAllowed(canScheduleExactAlarms());
        setAlarmState(getAlarm());
      }
    });
    return () => subscription.remove();
  }, []);

  const apply = (next: Omit<AlarmSetting, 'nextMs'>): void => {
    setAlarm(next);
    setAlarmState(getAlarm());
  };

  const commitClock = (): void => {
    const parsed = parseClock(clock);
    if (parsed === null) {
      setClock(`${pad(alarm.hour)}.${pad(alarm.minute)}`);
      return;
    }
    setClock(`${pad(parsed.hour)}.${pad(parsed.minute)}`);
    apply({ ...alarm, ...parsed });
  };

  const canEnable = alarm.station !== null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Vågn til radio</Text>
          <Text style={styles.rowHint}>
            {alarm.enabled && alarm.station !== null
              ? `${describeNext(alarm.nextMs)} på ${alarm.station.name}.`
              : canEnable
                ? 'Slået fra.'
                : 'Vælg en station nedenfor først.'}
          </Text>
        </View>
        <Switch
          value={alarm.enabled && canEnable}
          disabled={!canEnable}
          onValueChange={(value) => apply({ ...alarm, enabled: value })}
          trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
        />
      </View>

      <Text style={styles.sectionTitle}>Klokkeslæt</Text>
      <TextInput
        style={styles.input}
        value={clock}
        onChangeText={setClock}
        onBlur={commitClock}
        onSubmitEditing={commitClock}
        keyboardType="numbers-and-punctuation"
        placeholder="07.30"
        placeholderTextColor={theme.colors.textMuted}
        returnKeyType="done"
      />
      <Text style={styles.hint}>Hver dag på dette tidspunkt. Skriv fx 6.45 eller 0645.</Text>

      <Text style={styles.sectionTitle}>Station</Text>
      {favourites.length === 0 ? (
        <Text style={styles.hint}>Ingen stationer endnu. Gem nogle under Mine stationer, så kan de vælges her.</Text>
      ) : (
        favourites.map((station) => {
          const chosen = alarm.station?.id === station.id;
          return (
            <Pressable
              key={station.id}
              style={[styles.station, chosen && styles.stationChosen]}
              onPress={() => apply({ ...alarm, station })}
            >
              <ChannelLogo uris={station.logoUrls} name={station.name} memoryKey={`alarm:${station.id}`} size={36} />
              <Text style={[styles.stationName, chosen && styles.stationNameChosen]} numberOfLines={1}>
                {station.name}
              </Text>
              {chosen && <Text style={styles.check}>✓</Text>}
            </Pressable>
          );
        })
      )}

      {!exactAllowed && (
        <Pressable style={styles.warning} onPress={openExactAlarmSettings}>
          <Text style={styles.warningText}>
            Telefonen lader ikke NorRadio ringe præcist. Tryk her og slå “Alarmer og påmindelser” til, ellers kan uret
            ringe for sent.
          </Text>
        </Pressable>
      )}
      <Text style={styles.hint}>
        Uret ringer også når appen er lukket. Lydstyrken er telefonens medielydstyrke; skru op inden du lægger dig.
        Batterisparetilstand kan holde radioen tilbage på nogle telefoner.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.md, gap: theme.spacing.sm, paddingBottom: theme.spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
    padding: theme.spacing.md,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  rowHint: { color: theme.colors.textMuted, fontSize: 13 },
  sectionTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '800', marginTop: theme.spacing.md, letterSpacing: 1 },
  input: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    color: theme.colors.text,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 2,
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
  },
  hint: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 18 },
  station: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.xs + 2,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius,
  },
  stationChosen: { backgroundColor: theme.colors.surfaceRaised },
  stationName: { flex: 1, color: theme.colors.text, fontSize: 15 },
  stationNameChosen: { fontWeight: '700' },
  check: { color: theme.colors.accent, fontSize: 16, fontWeight: '800' },
  warning: { backgroundColor: theme.colors.surfaceRaised, borderRadius: theme.radius, padding: theme.spacing.md, marginTop: theme.spacing.sm },
  warningText: { color: theme.colors.text, fontSize: 13, lineHeight: 18 },
});
