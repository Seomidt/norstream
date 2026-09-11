import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { AppSession } from '../../session.js';
import { getChannel, listChannels, setFavorite } from '../../storage/channels.js';
import { getLastChannelId } from '../../storage/settings.js';
import type { StoredChannel } from '../../storage/channels.js';
import { addCategoryToFavorites, favoriteCategories, moveFavorite } from '../../storage/favorites.js';
import type { FavoriteCategory } from '../../storage/favorites.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { Notice } from '../../ui/Notice.js';
import type { NoticeState } from '../../ui/Notice.js';
import { theme } from '../../ui/theme.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { isTV } from '../../ui/tv.js';
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
}: Props) {
  const [channels, setChannels] = useState<StoredChannel[]>([]);
  const [categories, setCategories] = useState<FavoriteCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [sorting, setSorting] = useState(false);
  /** Den kanal der sidst blev set: "Se videre" oeverst. */
  const [lastChannel, setLastChannel] = useState<StoredChannel | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [list, fromCategories] = await Promise.all([
        listChannels(session.db, { favouritesOnly: true }),
        favoriteCategories(session.db),
      ]);
      setChannels(list);
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
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  if (channels.length === 0) {
    // Spec sec.5: en kort besked der peger paa browse, ikke en tom liste.
    return (
      <ScrollView
        contentContainerStyle={styles.emptyBox}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent}
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

  return (
    <ChannelList
      session={session}
      channels={channels}
      loading={false}
      emptyText="Ingen favoritter."
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
      header={header}
    />
  );
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
  const [order, setOrder] = useState(channels);
  useEffect(() => {
    setOrder(channels);
  }, [channels]);

  /**
   * Paa tv: den knap fjernbetjeningen skal staa paa efter et flyt.
   *
   * Naar raekken flytter sig, bygger Android dens visning om, og fokus
   * roeg — til Faerdig eller til Hjem i menuen, saa hvert flyt kostede
   * en tur tilbage til kanalen ("kan ikke faa sortere kanaler til at
   * virke"). Knappen faar en ny noegle per flyt, saa den tegnes forfra
   * med foretrukket fokus, og listen ruller kanalen ind i midten.
   */
  const [tvFocus, setTvFocus] = useState<{ id: string; dir: 'up' | 'down'; nonce: number } | null>(null);
  const moveOnTv = (index: number, dir: 'up' | 'down'): void => {
    const to = dir === 'up' ? index - 1 : index + 1;
    const moved = order[index];
    if (moved === undefined) return;
    if (to < 0 || to >= order.length) {
      // I enden: knappen bliver staaende med fokus, men intet flyttes.
      setTvFocus({ id: moved.id, dir, nonce: (tvFocus?.nonce ?? 0) + 1 });
      return;
    }
    // Vises med det samme; databasen foelger efter.
    const next = [...order];
    next.splice(index, 1);
    next.splice(to, 0, moved);
    setOrder(next);
    setTvFocus({ id: moved.id, dir, nonce: (tvFocus?.nonce ?? 0) + 1 });
    void onMove(moved, to);
    const visible = frame.current.height;
    scrollRef.current?.scrollTo({
      y: Math.max(0, to * ROW_HEIGHT - Math.max(0, visible - ROW_HEIGHT) / 2),
      animated: true,
    });
  };
  const tvKey = (item: StoredChannel, dir: 'up' | 'down'): string =>
    tvFocus !== null && tvFocus.id === item.id && tvFocus.dir === dir ? `${dir}-${tvFocus.nonce}` : dir;
  const tvPreferred = (item: StoredChannel, dir: 'up' | 'down'): boolean =>
    isTV && tvFocus !== null && tvFocus.id === item.id && tvFocus.dir === dir;

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

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Text style={styles.sortHint}>
          {isTV ? 'Flyt kanalen op eller ned med ▲ og ▼ ud for den.' : 'Træk i ☰ og slip kanalen hvor den skal ligge.'}
        </Text>
        <View style={styles.toolbarRow}>
          <View style={styles.spacer} />
          <TvPressable style={[styles.action, styles.actionAccent]} hitSlop={8} onPress={onDone}>
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
            return (
              <Animated.View
                key={item.id}
                style={[
                  styles.row,
                  dragging && styles.rowDragging,
                  { transform: [{ translateY: dragging ? translate : shift }] },
                ]}
              >
                <Text style={styles.position}>{index + 1}</Text>
                <ChannelLogo uris={item.logoUrls} name={item.name} memoryKey={item.id} size={36} />
                <Text style={styles.channelName} numberOfLines={1}>
                  {item.name}
                </Text>
                {isTV ? (
                  // Ingen finger at traekke med: to knapper flytter én plads ad gangen.
                  <>
                    <TvPressable
                      key={tvKey(item, 'up')}
                      style={styles.handle}
                      hasTVPreferredFocus={tvPreferred(item, 'up')}
                      onPress={() => moveOnTv(index, 'up')}
                    >
                      <Text style={[styles.handleText, index === 0 && styles.handleTextDim]}>▲</Text>
                    </TvPressable>
                    <TvPressable
                      key={tvKey(item, 'down')}
                      style={styles.handle}
                      hasTVPreferredFocus={tvPreferred(item, 'down')}
                      onPress={() => moveOnTv(index, 'down')}
                    >
                      <Text style={[styles.handleText, index === order.length - 1 && styles.handleTextDim]}>▼</Text>
                    </TvPressable>
                  </>
                ) : (
                  <View style={styles.handle} hitSlop={12} {...responderFor(index).panHandlers}>
                    <Text style={styles.handleText}>☰</Text>
                  </View>
                )}
              </Animated.View>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
  },
  emptyBox: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.background,
  },
  emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '600' },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: 15,
    textAlign: 'center',
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
    lineHeight: 21,
  },
  button: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
  },
  buttonText: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
  toolbar: {
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  toolbarRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  resume: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
  },
  resumeText: { flex: 1 },
  resumeLabel: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  resumeName: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  resumePlay: { color: theme.colors.accent, fontSize: 18 },
  toolbarCount: { flex: 1, color: theme.colors.textMuted, fontSize: 13 },
  spacer: { flex: 1 },
  sortHint: { color: theme.colors.text, fontSize: 14, marginBottom: theme.spacing.sm },
  action: {
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius,
    paddingHorizontal: theme.spacing.sm + 2,
    paddingVertical: theme.spacing.xs + 2,
  },
  actionAccent: { backgroundColor: theme.colors.accent },
  actionText: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.background,
  },
  rowDragging: {
    backgroundColor: theme.colors.surfaceRaised,
    zIndex: 10,
    elevation: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  position: { width: 28, color: theme.colors.textMuted, fontSize: 13, textAlign: 'right' },
  channelName: { flex: 1, color: theme.colors.text, fontSize: 16 },
  /** Bredt nok til en tommelfinger; det er det man traekker i. */
  handle: {
    width: 44,
    height: ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleText: { color: theme.colors.textMuted, fontSize: 20 },
  handleTextDim: { opacity: 0.3 },
});
