import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, useTVEventHandler, View } from 'react-native';
import { theme } from '../../ui/theme.js';
import type { ThemeColors } from '../../ui/theme.js';
import { useStyles } from '../../ui/ThemeContext.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { logEvent } from '../../diagnostics/log.js';
import type { Tab } from './HomeScreen.js';
import { createRailSelection } from './railSelection.js';
import { useRailFocus } from './useRailFocus.js';

export interface NavigationRailControl {
  isFocused(): boolean;
  requestFocus(): void;
  cancelSelection(): void;
}

interface Props {
  tabs: readonly { id: Tab; label: string; icon: string }[];
  activeTab: Tab;
  enabled: boolean;
  onSelect: (tab: Tab) => void;
  onEnter: () => void;
  controlRef: { current: NavigationRailControl | null };
}

/** Menufokus tegner kun soejlen om, ogsaa naar tunge faner staar skjult. */
export function NavigationRail({ tabs, activeTab, enabled, onSelect, onEnter, controlRef }: Props) {
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState(true);
  const foldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focused = useRef(false);
  const focusedId = useRef<Tab | null>(null);
  const blurredAt = useRef(Number.NEGATIVE_INFINITY);
  const lastKey = useRef({ type: '', at: 0 });
  const active = useRef(enabled);
  active.current = enabled;
  const currentTab = useRef(activeTab);
  currentTab.current = activeTab;
  const requestedAt = useRef<number | null>(null);
  const activeTabTarget = useRef<View>(null);
  const focus = useRailFocus(enabled, activeTabTarget);
  const selectLatest = useRef(onSelect);
  selectLatest.current = onSelect;
  const [selection] = useState(() => createRailSelection<Tab>(
    id => selectLatest.current(id), () => lastKey.current,
  ));

  const stopFolding = useCallback(() => {
    if (foldTimer.current !== null) clearTimeout(foldTimer.current);
    foldTimer.current = null;
  }, []);
  const cancelSelection = useCallback(() => {
    selection.cancel();
    // Fokus der kommer efter Tilbage maa ikke arve det forrige piltryk.
    lastKey.current = { type: 'back', at: Date.now() };
    blurredAt.current = Number.NEGATIVE_INFINITY;
  }, [selection]);
  const requestFocus = useCallback(() => {
    cancelSelection();
    stopFolding();
    if (!active.current) return;
    requestedAt.current = Date.now();
    setOpen(true);
    // Native fokus sendes i samme kald som BackHandler, foer naeste render.
    focus.request();
  }, [cancelSelection, stopFolding, focus.request]);

  // HomeScreen laeser denne direkte fra BackHandler, ikke via en effekt.
  const control = { isFocused: () => active.current && focused.current && requestedAt.current === null, requestFocus, cancelSelection };
  controlRef.current = control;
  useEffect(() => () => {
    if (controlRef.current?.requestFocus === requestFocus) controlRef.current = null;
    requestedAt.current = null;
    selection.cancel();
    stopFolding();
  }, [controlRef, requestFocus, selection, stopFolding]);
  useEffect(() => {
    if (enabled) return;
    cancelSelection();
    stopFolding();
    focused.current = false;
    focusedId.current = null;
    requestedAt.current = null;
  }, [enabled, cancelSelection, stopFolding]);
  useEffect(() => {
    if (!focus.pending) requestedAt.current = null;
  }, [focus.pending]);

  useTVEventHandler(event => {
    if (!active.current) return;
    if (event.eventType !== 'focus' && event.eventType !== 'blur') {
      lastKey.current = { type: event.eventType, at: Date.now() };
    }
    if (event.eventType !== 'right' || (!focused.current && Date.now() - blurredAt.current >= 400)) return;
    if (event.eventKeyAction !== undefined && Number(event.eventKeyAction) === 0) return;
    // Android kan melde blur ved tryk ned, foer pil-hoejre naar JS ved slip.
    // Vinduet bruges kun én gang, saa naeste pil ikke hopper til foerste raekke.
    blurredAt.current = Number.NEGATIVE_INFINITY;
    requestedAt.current = null;
    focus.confirm();
    selection.enter();
    onEnter();
  });

  const onFocus = (id: Tab) => {
    if (!active.current) return;
    focusedId.current = id;
    focused.current = true;
    // Android kan foerst lande paa Hjem. Gentag indtil den aktive fane
    // bekraefter anmodningen; almindelig pil-navigation virker imens.
    if (requestedAt.current === null || id === currentTab.current) {
      if (requestedAt.current !== null) {
        logEvent('menu', `Tilbage: ${currentTab.current}, native fokus efter ${Date.now() - requestedAt.current} ms`);
        requestedAt.current = null;
      }
      focus.confirm();
    }
    stopFolding();
    setOpen(true);
    selection.focus(id);
  };
  const onBlur = (id: Tab) => {
    // En sen blur fra den gamle fane maa ikke annullere den nyes fokus.
    if (!active.current || focusedId.current !== id) return;
    focusedId.current = null;
    focused.current = false;
    selection.leave();
    blurredAt.current = Date.now();
    stopFolding();
    foldTimer.current = setTimeout(() => {
      foldTimer.current = null;
      setOpen(false);
    }, 2000);
  };

  return (
    <View style={[styles.rail, !open && styles.folded]} pointerEvents={enabled ? 'auto' : 'none'}>
      {tabs.map(item => (
        <TvPressable
          key={item.id}
          ref={activeTab === item.id ? activeTabTarget : undefined}
          focusable={enabled}
          style={[styles.tab, item.id === 'settings' && styles.settings]}
          onPress={() => { if (active.current) selection.press(item.id); }}
          onFocus={() => onFocus(item.id)}
          onBlur={() => onBlur(item.id)}
        >
          <Text style={[styles.icon, activeTab === item.id && styles.active]}>{item.icon}</Text>
          {open && (
            <Text style={[styles.label, activeTab === item.id && styles.active]} numberOfLines={1} adjustsFontSizeToFit>
              {item.label}
            </Text>
          )}
        </TvPressable>
      ))}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  rail: {
    width: 84,
    paddingTop: theme.spacing.md,
    borderRightColor: colors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.surface,
  },
  folded: { width: 44 },
  // Ni faner inklusive Tekst-tv skal kunne staa i laerredets 486 punkter.
  tab: { alignItems: 'center', paddingVertical: theme.spacing.xs, marginHorizontal: theme.spacing.xs, marginBottom: 2 },
  settings: { marginTop: 'auto', marginBottom: theme.spacing.md, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: theme.spacing.md },
  icon: { color: colors.textMuted, fontSize: 18 },
  label: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  active: { color: colors.accent },
});
