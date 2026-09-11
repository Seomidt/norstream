import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, FlatList, StyleSheet, Text, View } from 'react-native';
import type { AppSession } from '../../session.js';
import { listChannels } from '../../storage/channels.js';
import type { StoredChannel } from '../../storage/channels.js';
import {
  createFavoriteGroup,
  deleteFavoriteGroup,
  favoriteGroupMembers,
  listFavoriteGroups,
  moveFavoriteGroup,
  renameFavoriteGroup,
  setFavoriteGroupMember,
} from '../../storage/favoriteGroups.js';
import type { FavoriteGroup } from '../../storage/favoriteGroups.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { theme } from '../../ui/theme.js';
import type { ThemeColors } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { TvTextInput } from '../../ui/TvTextInput.js';
import { isTV } from '../../ui/tv.js';
import { keepInMiddle, useTvListTail } from '../../ui/tvScroll.js';

interface Props {
  session: AppSession;
  onBack: () => void;
  /** Kaldes naar grupper eller medlemmer er aendret, saa listen bagved laeses igen. */
  onChanged: () => void;
}

/**
 * Grupperne oven paa favoritterne, og hvad der ligger i dem.
 *
 * Alt er brugerens eget: opret en gruppe med et navn, aabn den, og saet
 * flueben ved de favoritter der skal med. Intet laegges i grupperne af
 * sig selv. Paa tv er hver raekke ét trykpunkt og OK skifter fluebenet,
 * Tilbage gaar et niveau op.
 */
export function GroupsScreen({ session, onBack, onChanged }: Props) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const tail = useTvListTail();
  const [groups, setGroups] = useState<FavoriteGroup[]>([]);
  const [favourites, setFavourites] = useState<StoredChannel[]>([]);
  const [open, setOpen] = useState<FavoriteGroup | null>(null);
  const [members, setMembers] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState('');
  const [renameTo, setRenameTo] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const listRef = useRef<FlatList<StoredChannel>>(null);

  const load = useCallback(async (): Promise<void> => {
    const [list, all] = await Promise.all([listFavoriteGroups(session.db), listChannels(session.db, { favouritesOnly: true })]);
    setGroups(list);
    setFavourites(all);
  }, [session.db]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (open === null) return;
    let cancelled = false;
    void favoriteGroupMembers(session.db, open.id).then((set) => {
      if (!cancelled) setMembers(set);
    });
    setRenameTo(open.name);
    setConfirmingDelete(false);
    return () => {
      cancelled = true;
    };
  }, [session.db, open]);

  // Tilbage: ud af gruppen foerst, saa ud af skaermen.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (open !== null) {
        setOpen(null);
        void load();
        return true;
      }
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [open, onBack, load]);

  async function create(): Promise<void> {
    const created = await createFavoriteGroup(session.db, newName);
    if (created === null) return;
    setNewName('');
    onChanged();
    await load();
    setOpen(created);
  }

  async function toggleMember(channel: StoredChannel): Promise<void> {
    if (open === null) return;
    const on = !members.has(channel.id);
    await setFavoriteGroupMember(session.db, open.id, channel.id, on);
    setMembers((current) => {
      const next = new Set(current);
      if (on) next.add(channel.id);
      else next.delete(channel.id);
      return next;
    });
    onChanged();
  }

  if (open !== null) {
    return (
      <View style={styles.container}>
        <View style={styles.toolbar}>
          <View style={styles.row}>
            <TvPressable style={styles.action} onPress={() => { setOpen(null); void load(); }}>
              <Text style={styles.actionText}>‹ Grupper</Text>
            </TvPressable>
            <Text style={styles.title} numberOfLines={1}>
              {open.name} · {members.size}
            </Text>
          </View>
          <View style={styles.row}>
            <TvTextInput
              style={styles.input}
              value={renameTo}
              onChangeText={setRenameTo}
              placeholder="Navn"
              autoCorrect={false}
              onSubmitEditing={() => void renameFavoriteGroup(session.db, open.id, renameTo).then(onChanged)}
            />
            <TvPressable
              style={styles.action}
              onPress={() => {
                void renameFavoriteGroup(session.db, open.id, renameTo).then(() => {
                  onChanged();
                  setOpen({ ...open, name: renameTo.trim() || open.name });
                });
              }}
            >
              <Text style={styles.actionText}>Gem navn</Text>
            </TvPressable>
            {confirmingDelete ? (
              <>
                <TvPressable style={styles.action} onPress={() => setConfirmingDelete(false)}>
                  <Text style={styles.actionText}>Annullér</Text>
                </TvPressable>
                <TvPressable
                  style={[styles.action, styles.actionDanger]}
                  onPress={() => {
                    void deleteFavoriteGroup(session.db, open.id).then(() => {
                      onChanged();
                      setOpen(null);
                      void load();
                    });
                  }}
                >
                  <Text style={styles.actionText}>Slet gruppen</Text>
                </TvPressable>
              </>
            ) : (
              <TvPressable style={styles.action} onPress={() => setConfirmingDelete(true)}>
                <Text style={styles.actionText}>Slet</Text>
              </TvPressable>
            )}
          </View>
          <Text style={styles.hint}>
            {isTV ? 'Tryk OK på en kanal for at sætte eller fjerne fluebenet.' : 'Tryk på en kanal for at sætte eller fjerne fluebenet.'}
          </Text>
        </View>
        <FlatList
          ref={listRef}
          data={favourites}
          keyExtractor={(item) => item.id}
          contentContainerStyle={tail}
          onScrollToIndexFailed={() => undefined}
          ListEmptyComponent={<Text style={styles.empty}>Ingen favoritter endnu. Læg kanaler i favoritter under Kanaler først.</Text>}
          renderItem={({ item, index }) => {
            const on = members.has(item.id);
            return (
              <TvPressable
                style={styles.channel}
                hasTVPreferredFocus={isTV && index === 0}
                onFocus={isTV ? () => keepInMiddle(listRef.current, index) : undefined}
                onPress={() => {
                  void toggleMember(item);
                }}
              >
                <Text style={[styles.check, on && styles.checkOn]}>{on ? '✓' : ''}</Text>
                <ChannelLogo uris={item.logoUrls} name={item.name} memoryKey={item.id} size={36} />
                <Text style={[styles.channelName, on && styles.channelNameOn]} numberOfLines={1}>
                  {item.name}
                </Text>
              </TvPressable>
            );
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <View style={styles.row}>
          <TvPressable style={styles.action} onPress={onBack}>
            <Text style={styles.actionText}>‹ Favoritter</Text>
          </TvPressable>
          <Text style={styles.title}>Grupper</Text>
        </View>
        <Text style={styles.hint}>
          Grupper oven på favoritterne: Sport, Film, Børn. Favoritter og Guide viser én gruppe ad gangen. Du bestemmer selv hvad der ligger i dem.
        </Text>
        <View style={styles.row}>
          <TvTextInput
            style={styles.input}
            value={newName}
            onChangeText={setNewName}
            placeholder="Ny gruppe, fx Sport"
            autoCorrect={false}
            onSubmitEditing={() => void create()}
            returnKeyType="done"
          />
          <TvPressable style={[styles.action, styles.actionAccent]} onPress={() => void create()}>
            <Text style={styles.actionText}>Opret</Text>
          </TvPressable>
        </View>
      </View>
      <FlatList
        data={groups}
        keyExtractor={(item) => item.id}
        contentContainerStyle={tail}
        ListEmptyComponent={<Text style={styles.empty}>Ingen grupper endnu. Skriv et navn ovenfor og tryk Opret.</Text>}
        renderItem={({ item, index }) => (
          <View style={styles.groupRow}>
            <TvPressable style={styles.groupMain} hasTVPreferredFocus={isTV && index === 0} onPress={() => setOpen(item)}>
              <Text style={styles.groupName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.groupCount}>{item.count} kanaler</Text>
            </TvPressable>
            <TvPressable
              style={styles.small}
              onPress={() => {
                void moveFavoriteGroup(session.db, item.id, -1).then(() => {
                  onChanged();
                  void load();
                });
              }}
            >
              <Text style={[styles.actionText, index === 0 && styles.dim]}>▲</Text>
            </TvPressable>
            <TvPressable
              style={styles.small}
              onPress={() => {
                void moveFavoriteGroup(session.db, item.id, 1).then(() => {
                  onChanged();
                  void load();
                });
              }}
            >
              <Text style={[styles.actionText, index === groups.length - 1 && styles.dim]}>▼</Text>
            </TvPressable>
          </View>
        )}
      />
      <Text style={[styles.hint, { color: colors.textMuted }]}>{isTV ? 'Tilbage lukker.' : ''}</Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  toolbar: {
    backgroundColor: colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' },
  title: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '700' },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  input: {
    flex: 1,
    minWidth: 160,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    color: colors.text,
    paddingHorizontal: theme.spacing.sm + 2,
    paddingVertical: theme.spacing.xs + 4,
    fontSize: 15,
  },
  action: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: theme.radius,
    paddingHorizontal: theme.spacing.sm + 2,
    paddingVertical: theme.spacing.xs + 2,
  },
  actionAccent: { backgroundColor: colors.accent },
  actionDanger: { backgroundColor: colors.danger },
  actionText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  dim: { opacity: 0.3 },
  empty: { color: colors.textMuted, textAlign: 'center', padding: theme.spacing.lg, lineHeight: 20 },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  groupMain: { flex: 1, paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.sm, borderRadius: theme.radius },
  groupName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  groupCount: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  small: { paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.sm, borderRadius: theme.radius },
  channel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  check: { width: 24, color: colors.textMuted, fontSize: 18, textAlign: 'center' },
  checkOn: { color: colors.accent, fontWeight: '800' },
  channelName: { flex: 1, color: colors.textMuted, fontSize: 16 },
  channelNameOn: { color: colors.text },
});
