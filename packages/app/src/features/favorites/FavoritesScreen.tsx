import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TVFocusGuideView,
  Text,
  View,
  useTVEventHandler,
} from 'react-native';
import type { AppSession } from '../../session.js';
import { getChannel, listChannels, setFavorite } from '../../storage/channels.js';
import { getFavoriteGroup, getLastChannelId, setFavoriteGroup } from '../../storage/settings.js';
import { listFavoriteGroups } from '../../storage/favoriteGroups.js';
import type { FavoriteGroup } from '../../storage/favoriteGroups.js';
import { GroupsScreen } from './GroupsScreen.js';
import type { StoredChannel } from '../../storage/channels.js';
import { addCategoryToFavorites, favoriteCategories, moveFavorite } from '../../storage/favorites.js';
import type { FavoriteCategory } from '../../storage/favorites.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { Notice } from '../../ui/Notice.js';
import type { NoticeState } from '../../ui/Notice.js';
import { theme } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { isTV } from '../../ui/tv.js';
import { cameBySelect } from '../../ui/tvKeys.js';
import { ChannelList } from '../channels/ChannelList.js';
import type { PreviewHandle } from '../preview/MiniPreview.js';

interface Props {
  session: AppSession;
  onSelect: (channel: StoredChannel, neighbours: StoredChannel[]) => void;
  onAuthError: () => void;
  onBrowse: () => void;
  previewEnabled: boolean;
  previewHandle: { current: PreviewHandle | null };
  onPickLogo: (channel: StoredChannel) => void;
  refreshing: boolean;
  onRefresh: () => void;
  /** Aendres af foraelderen naar favoritterne kan have aendret sig andetsteds. */
  reloadToken: number;
  /** Tv: pil hoejre fra menuen; den foerste kanal faar fokus. */
  focusFirstSignal?: number;
}

/**
 * Startskaermen: favoritterne, én liste, i brugerens egen raekkefoelge.
 *
 * Den var grupperet efter den kategori favoritterne kom fra, og saa snart
 * man lagde én kanal til ved siden af en hel kategori, skiftede skaermen til
 * en anden liste — uden logoer, uden nu-titler, uden preview — med en gruppe
 * der hed "Egne favoritter". Det saa ud som om alt var forsvundet.
 *
 * Nu er det altid den samme liste som under Kanaler. Nye favoritter laegger
 * sig nederst, en hel kategori laegges nederst i panelets orden, og
 * raekkefoelgen kan aendres under "Sortér". Kategorierne huskes stadig, saa
 * "Opdatér" kan hente de kanaler udbyderen har lagt i dem siden sidst.
 */
export function FavoritesScreen({
  session,
  onSelect,
  onAuthError,
  onBrowse,
  previewEnabled,
  previewHandle,
  onPickLogo,
  refreshing,
  onRefresh,
  reloadToken,
  focusFirstSignal = 0,
}: Props) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const [channels, setChannels] = useState<StoredChannel[]>([]);
  const [categories, setCategories] = useState<FavoriteCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [sorting, setSorting] = useState(false);
  /** Grupperne oven paa favoritterne, og den der vises (null = alle). */
  const [groups, setGroups] = useState<FavoriteGroup[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [managingGroups, setManagingGroups] = useState(false);
  /** Antal favoritter i alt, uanset gruppe: "ingen favoritter" gaelder kun naar det er nul. */
  const [total, setTotal] = useState(0);
  /** Den kanal der sidst blev set: "Se videre" oeverst. */
  const [lastChannel, setLastChannel] = useState<StoredChannel | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const chosen = await getFavoriteGroup(session.db);
      const [list, all, fromCategories, groupList] = await Promise.all([
        listChannels(session.db, { favouritesOnly: true, groupId: chosen }),
        listChannels(session.db, { favouritesOnly: true }),
        favoriteCategories(session.db),
        listFavoriteGroups(session.db),
      ]);
      // En slettet gruppe: tilbage til alle.
      const valid = chosen !== null && groupList.some((group) => group.id === chosen);
      setGroupId(valid ? chosen : null);
      setGroups(groupList);
      setChannels(valid ? list : all);
      setTotal(all.length);
      setCategories(fromCategories);
      const lastId = await getLastChannelId(session.db);
      setLastChannel(lastId === null ? null : await getChannel(session.db, lastId));
    } finally {
      setLoading(false);
    }
  }, [session.db]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  async function toggleFavorite(channel: StoredChannel): Promise<void> {
    await setFavorite(session.db, channel.id, !channel.isFavorite);
    if (isTV) {
      // Raekken bliver staaende med hul stjerne til man forlader fanen:
      // forsvandt den, mistede fjernbetjeningen sit fokus, og Android
      // flyttede det til Hjem i menuen. Man kan ogsaa fortryde med det samme.
      setChannels((current) => current.map((c) => (c.id === channel.id ? { ...c, isFavorite: !channel.isFavorite } : c)));
      return;
    }
    await load();
  }

  /** Henter det udbyderen har lagt i favoritternes kategorier siden sidst. */
  async function refreshCategories(): Promise<void> {
    let added = 0;
    for (const category of categories) {
      added += await addCategoryToFavorites(session.db, category.id);
    }
    await load();
    setNotice({
      text:
        added === 0
          ? 'Ingen nye kanaler i dine kategorier.'
          : `${added} nye kanaler er lagt nederst i favoritter.`,
    });
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (managingGroups) {
    // Listen bagved laeses foerst igen naar Grupper lukkes: at laese den
    // ved hvert flueben tegnede gruppesiden om midt i et tryk.
    return (
      <GroupsScreen
        session={session}
        onBack={() => {
          setManagingGroups(false);
          void load();
        }}
        onChanged={() => undefined}
      />
    );
  }

  async function chooseGroup(id: string | null): Promise<void> {
    await setFavoriteGroup(session.db, id);
    await load();
  }

  if (total === 0) {
    // Spec sec.5: en kort besked der peger paa browse, ikke en tom liste.
    return (
      <ScrollView
        contentContainerStyle={styles.emptyBox}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }
      >
        <Text style={styles.emptyTitle}>Ingen favoritter endnu</Text>
        <Text style={styles.emptyText}>
          Under Kanaler kan du finde dine lande og lægge hele kategorier i favoritter på én gang.
        </Text>
        <TvPressable style={styles.button} onPress={onBrowse}>
          <Text style={styles.buttonText}>Gå til Kanaler</Text>
        </TvPressable>
      </ScrollView>
    );
  }

  if (sorting) {
    return (
      <SortView
        channels={channels}
        onMove={async (channel, toIndex) => {
          await moveFavorite(session.db, channel.id, toIndex);
          await load();
        }}
        onDone={() => setSorting(false)}
      />
    );
  }

  const header = (
    <View style={styles.toolbar}>
      <Notice notice={notice} onDismiss={() => setNotice(null)} />
      {lastChannel !== null && (
        <TvPressable style={styles.resume} onPress={() => onSelect(lastChannel, channels)}>
          <ChannelLogo uris={lastChannel.logoUrls} name={lastChannel.name} memoryKey={lastChannel.id} size={32} />
          <View style={styles.resumeText}>
            <Text style={styles.resumeLabel}>Se videre</Text>
            <Text style={styles.resumeName} numberOfLines={1}>
              {lastChannel.name}
            </Text>
          </View>
          <Text style={styles.resumePlay}>▶</Text>
        </TvPressable>
      )}
      {/* Grupperne: Alle, saa brugerens egne, og Grupper til at lave dem.
          Guiden viser den samme gruppe. */}
      <View style={styles.chips}>
        <TvPressable style={[styles.chip, groupId === null && styles.chipActive]} onPress={() => void chooseGroup(null)}>
          <Text style={[styles.chipText, groupId === null && styles.chipTextActive]}>Alle · {total}</Text>
        </TvPressable>
        {groups.map((group) => (
          <TvPressable
            key={group.id}
            style={[styles.chip, groupId === group.id && styles.chipActive]}
            onPress={() => void chooseGroup(group.id)}
          >
            <Text style={[styles.chipText, groupId === group.id && styles.chipTextActive]}>
              {group.name} · {group.count}
            </Text>
          </TvPressable>
        ))}
        <TvPressable style={styles.chip} onPress={() => setManagingGroups(true)}>
          <Text style={styles.chipText}>{groups.length === 0 ? '+ Grupper' : 'Grupper …'}</Text>
        </TvPressable>
      </View>
      <View style={styles.toolbarRow}>
        <Text style={styles.toolbarCount}>{channels.length} kanaler</Text>
        {categories.length > 0 && !isTV && (
          <TvPressable
            style={styles.action}
            hitSlop={8}
            onPress={() => {
              void refreshCategories();
            }}
          >
            <Text style={styles.actionText}>Opdatér</Text>
          </TvPressable>
        )}
        <TvPressable style={styles.action} hitSlop={8} onPress={() => setSorting(true)}>
          <Text style={styles.actionText}>Sortér</Text>
        </TvPressable>
      </View>
    </View>
  );

  const list = (
    <ChannelList
      session={session}
      channels={channels}
      loading={false}
      emptyText="Ingen kanaler i denne gruppe endnu. Læg dem i under Grupper."
      onSelect={onSelect}
      onToggleFavorite={(channel) => {
        void toggleFavorite(channel);
      }}
      onAuthError={onAuthError}
      previewEnabled={previewEnabled}
      previewHandle={previewHandle}
      onLongPress={onPickLogo}
      refreshing={refreshing}
      onRefresh={onRefresh}
      header={isTV ? undefined : header}
      // Paa tv staar Se videre og Sortér i hoejre soejle under previewet,
      // ikke over listen: derfra er Sortér ét tryk til hoejre fra enhver
      // raekke, mod halvtreds tryk op fra bunden af listen.
      sidePanel={isTV ? header : undefined}
      focusFirstSignal={focusFirstSignal}
    />
  );
  return list;
}

/** Raekkehoejden i sorteringen. Fast, saa en fingerposition kan regnes om til en plads. */
const ROW_HEIGHT = 56;
/** Saa taet paa kanten fingeren skal vaere foer listen ruller med. */
const EDGE = 48;
const EDGE_STEP = 8;

/**
 * Raekkefoelgen, aendret ved at traekke.
 *
 * Uden bibliotek: en PanResponder paa haandtaget, en fast raekkehoejde, og
 * pladsen regnes ud af hvor langt fingeren er flyttet — plus hvor meget
 * listen selv har rullet imens, for den ruller med naar fingeren naar en
 * kant. Raekkerne imellem rykker sig, saa man kan se hvor kanalen lander.
 * Den foerste udgave krævede to tryk, ét paa kanalen og ét paa pladsen;
 * ingen fandt ud af det, for alle proevede at traekke.
 */
function SortView({
  channels,
  onMove,
  onDone,
}: {
  channels: StoredChannel[];
  onMove: (channel: StoredChannel, toIndex: number) => Promise<void>;
  onDone: () => void;
}) {
  const styles = useStyles(makeStyles);
  const [order, setOrder] = useState(channels);
  useEffect(() => {
    setOrder(channels);
  }, [channels]);

  /**
   * Paa tv: OK paa en kanal tager den op, pil op/ned flytter den, OK
   * saetter den. Som paa telefonen, hvor man trækker — bare med taster.
   *
   * Mens en kanal er taget op, er alle andre raekker og Faerdig
   * ufokuserbare og listen holder paa fokus (TVFocusGuideView), saa
   * pilene ikke flytter fokus til naboen eller op i menuen (Hjem). I
   * stedet flyttes kanalen: samme `drag`-tilstand som fingeren bruger,
   * saa raekkerne imellem rykker sig og intet bygges om foer den saettes.
   * Foerst da flytter raekken sig i traeet, og saa mister Android fokus;
   * derfor faar den satte raekke en ny key og foretrukket fokus.
   */
  const [tvFocus, setTvFocus] = useState<{ id: string; nonce: number } | null>(null);
  /** Den foerste raekke faar fokus naar sorteringen aabnes; ellers landede fjernbetjeningen paa Hjem. */
  const focusFirst = useRef(isTV && cameBySelect()).current;
  const [drag, setDrag] = useState<{ index: number; hover: number } | null>(null);
  const dragRef = useRef<{ index: number; hover: number; startScroll: number } | null>(null);
  const translate = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const lastDy = useRef(0);
  const frame = useRef({ top: 0, height: 0 });
  const listRef = useRef<View>(null);
  const edgeTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopEdgeScroll = (): void => {
    if (edgeTimer.current !== null) clearInterval(edgeTimer.current);
    edgeTimer.current = null;
  };

  const updateHover = (dy: number): void => {
    const current = dragRef.current;
    if (current === null) return;
    const offset = dy + (scrollY.current - current.startScroll);
    translate.setValue(offset);
    const hover = Math.max(
      0,
      Math.min(order.length - 1, Math.round(current.index + offset / ROW_HEIGHT)),
    );
    if (hover !== current.hover) {
      current.hover = hover;
      setDrag({ index: current.index, hover });
    }
  };

  const edgeScroll = (fingerY: number): void => {
    const { top, height } = frame.current;
    const direction = fingerY < top + EDGE ? -1 : fingerY > top + height - EDGE ? 1 : 0;
    if (direction === 0) {
      stopEdgeScroll();
      return;
    }
    if (edgeTimer.current !== null) return;
    edgeTimer.current = setInterval(() => {
      const max = Math.max(0, order.length * ROW_HEIGHT - height);
      const next = Math.max(0, Math.min(max, scrollY.current + direction * EDGE_STEP));
      if (next === scrollY.current) return;
      scrollRef.current?.scrollTo({ y: next, animated: false });
      scrollY.current = next;
      updateHover(lastDy.current);
    }, 16);
  };

  const finish = (): void => {
    stopEdgeScroll();
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    translate.setValue(0);
    if (current === null || current.hover === current.index) return;
    const moved = order[current.index];
    if (moved === undefined) return;
    // Vises med det samme; databasen foelger efter.
    const next = [...order];
    next.splice(current.index, 1);
    next.splice(current.hover, 0, moved);
    setOrder(next);
    void onMove(moved, current.hover);
  };

  const responderFor = (index: number) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Listen maa ikke tage fingeren fra os for at rulle selv.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        dragRef.current = { index, hover: index, startScroll: scrollY.current };
        lastDy.current = 0;
        translate.setValue(0);
        setDrag({ index, hover: index });
      },
      onPanResponderMove: (_, gesture) => {
        lastDy.current = gesture.dy;
        updateHover(gesture.dy);
        edgeScroll(gesture.moveY);
      },
      onPanResponderRelease: finish,
      onPanResponderTerminate: finish,
    });

  /** Tv: OK tager kanalen op, eller saetter den hvor den er naaet til. */
  const pickOrDrop = (index: number): void => {
    const current = dragRef.current;
    if (current === null) {
      dragRef.current = { index, hover: index, startScroll: scrollY.current };
      translate.setValue(0);
      setDrag({ index, hover: index });
      return;
    }
    const moved = order[current.index];
    finish();
    if (moved !== undefined) setTvFocus({ id: moved.id, nonce: (tvFocus?.nonce ?? 0) + 1 });
  };
  const moveHover = (step: -1 | 1): void => {
    const current = dragRef.current;
    if (current === null) return;
    const hover = Math.max(0, Math.min(order.length - 1, current.hover + step));
    if (hover === current.hover) return;
    current.hover = hover;
    translate.setValue((hover - current.index) * ROW_HEIGHT);
    setDrag({ index: current.index, hover });
    // Kanalen holdes midt i listen mens den flyttes.
    const visible = frame.current.height;
    scrollRef.current?.scrollTo({
      y: Math.max(0, hover * ROW_HEIGHT - Math.max(0, visible - ROW_HEIGHT) / 2),
      animated: true,
    });
  };
  useTVEventHandler((event) => {
    if (!isTV || dragRef.current === null) return;
    // Android sender tryk ned (0) og op (1); kun det ene skal taelle.
    if (event.eventKeyAction !== undefined && Number(event.eventKeyAction) === 0) return;
    if (event.eventType === 'up') moveHover(-1);
    else if (event.eventType === 'down') moveHover(1);
  });
  const picking = drag !== null;

  // Tilbage-knappen: er en kanal taget op, saettes den hvor den er naaet
  // til; ellers er sorteringen faerdig. Saa skal man ikke finde Faerdig.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const current = dragRef.current;
      if (current !== null) {
        const moved = order[current.index];
        finish();
        if (moved !== undefined) setTvFocus({ id: moved.id, nonce: (tvFocus?.nonce ?? 0) + 1 });
        return true;
      }
      onDone();
      return true;
    });
    return () => subscription.remove();
  });

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Text style={styles.sortHint}>
          {isTV
            ? picking
              ? 'Flyt kanalen med ▲ og ▼, og tryk OK for at sætte den.'
              : 'Tryk OK på en kanal, flyt den med ▲ og ▼, og tryk OK igen. Tilbage når du er færdig.'
            : 'Træk i ☰ og slip kanalen hvor den skal ligge.'}
        </Text>
        <View style={styles.toolbarRow}>
          <View style={styles.spacer} />
          <TvPressable style={[styles.action, styles.actionAccent]} hitSlop={8} focusable={!picking} onPress={onDone}>
            <Text style={styles.actionText}>Færdig</Text>
          </TvPressable>
        </View>
      </View>
      <View
        ref={listRef}
        style={styles.container}
        onLayout={() => {
          listRef.current?.measureInWindow((_x, y, _w, h) => {
            frame.current = { top: y, height: h };
          });
        }}
      >
        <TVFocusGuideView
          style={styles.container}
          trapFocusUp={isTV && picking}
          trapFocusDown={isTV && picking}
          trapFocusLeft={isTV && picking}
          trapFocusRight={isTV && picking}
        >
        <ScrollView
          ref={scrollRef}
          scrollEnabled={drag === null}
          scrollEventThrottle={16}
          onScroll={(event) => {
            scrollY.current = event.nativeEvent.contentOffset.y;
          }}
        >
          {order.map((item, index) => {
            const dragging = drag !== null && drag.index === index;
            let shift = 0;
            if (drag !== null && !dragging) {
              if (drag.index < index && index <= drag.hover) shift = -ROW_HEIGHT;
              else if (drag.hover <= index && index < drag.index) shift = ROW_HEIGHT;
            }
            const inner = (
              <>
                <Text style={styles.position}>{(picking && drag.index === index ? drag.hover : index) + 1}</Text>
                <ChannelLogo uris={item.logoUrls} name={item.name} memoryKey={item.id} size={36} />
                <Text style={styles.channelName} numberOfLines={1}>
                  {item.name}
                </Text>
              </>
            );
            const targeted = tvFocus !== null && tvFocus.id === item.id;
            return (
              <Animated.View
                key={item.id}
                style={[
                  styles.row,
                  isTV && styles.rowTv,
                  dragging && styles.rowDragging,
                  { transform: [{ translateY: dragging ? translate : shift }] },
                ]}
              >
                {isTV ? (
                  // Hele raekken er trykpunktet: OK tager den op eller saetter den.
                  <TvPressable
                    key={targeted ? `row-${tvFocus.nonce}` : 'row'}
                    style={[styles.tvRow, dragging && styles.tvRowPicked]}
                    focusable={!picking || dragging}
                    hasTVPreferredFocus={targeted || (focusFirst && tvFocus === null && index === 0)}
                    onPress={() => pickOrDrop(index)}
                  >
                    {inner}
                    <Text style={styles.handleText}>{dragging ? '⇅' : '☰'}</Text>
                  </TvPressable>
                ) : (
                  <>
                    {inner}
                    <View style={styles.handle} hitSlop={12} {...responderFor(index).panHandlers}>
                      <Text style={styles.handleText}>☰</Text>
                    </View>
                  </>
                )}
              </Animated.View>
            );
          })}
        </ScrollView>
        </TVFocusGuideView>
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  emptyBox: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
    backgroundColor: colors.background,
  },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '600' },
  emptyText: {
    color: colors.textMuted,
    fontSize: 15,
    textAlign: 'center',
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
    lineHeight: 21,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: theme.radius,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
  },
  buttonText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  toolbar: {
    backgroundColor: colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  toolbarRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs, marginBottom: theme.spacing.sm },
  chip: {
    paddingHorizontal: theme.spacing.sm + 2,
    paddingVertical: theme.spacing.xs + 2,
    borderRadius: 16,
    backgroundColor: colors.surfaceRaised,
  },
  chipActive: { backgroundColor: colors.accent },
  chipText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: colors.text },
  resume: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
  },
  resumeText: { flex: 1 },
  resumeLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  resumeName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  resumePlay: { color: colors.accent, fontSize: 18 },
  toolbarCount: { flex: 1, color: colors.textMuted, fontSize: 13 },
  spacer: { flex: 1 },
  sortHint: { color: colors.text, fontSize: 14, marginBottom: theme.spacing.sm },
  action: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: theme.radius,
    paddingHorizontal: theme.spacing.sm + 2,
    paddingVertical: theme.spacing.xs + 2,
  },
  actionAccent: { backgroundColor: colors.accent },
  actionText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.background,
  },
  rowDragging: {
    backgroundColor: colors.surfaceRaised,
    zIndex: 10,
    elevation: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  position: { width: 28, color: colors.textMuted, fontSize: 13, textAlign: 'right' },
  channelName: { flex: 1, color: colors.text, fontSize: 16 },
  /** Bredt nok til en tommelfinger; det er det man traekker i. */
  handle: {
    width: 44,
    height: ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleText: { color: colors.textMuted, fontSize: 20 },
  rowTv: { paddingHorizontal: 0 },
  tvRow: {
    flex: 1,
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  tvRowPicked: { borderWidth: 2, borderColor: colors.accent, borderRadius: theme.radius },
});
