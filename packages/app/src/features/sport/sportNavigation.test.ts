import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { AppSession } from '../../session.js';
const mocks = vi.hoisted(() => ({ teams: vi.fn(), save: vi.fn(), find: vi.fn(), scroll: vi.fn() }));
vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    Platform: { isTV: true, OS: 'android' }, View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator',
    StyleSheet: { create: (s: unknown) => s }, useWindowDimensions: () => ({ width: 864, height: 486 }),
    FlatList: React.forwardRef(function List(props: any, ref) {
      React.useImperativeHandle(ref, () => ({ scrollToOffset: mocks.scroll, scrollToIndex: mocks.scroll }));
      return React.createElement('List', { data: props.data }, props.ListHeaderComponent, props.ListEmptyComponent);
    }),
  };
});
vi.mock('../../ui/TvTextInput.js', () => ({ TvTextInput: () => null }));
vi.mock('../../ui/ChannelLogo.js', () => ({ ChannelLogo: () => null }));
vi.mock('../../ui/Notice.js', () => ({ Notice: () => null }));
vi.mock('../../storage/sport.js', () => ({ getSportTeams: mocks.teams, setSportTeams: mocks.save, getSportAutoRemind: async () => false, setSportAutoRemind: async () => {} }));
vi.mock('../../storage/reminders.js', () => ({ listReminders: async () => [], addReminder: async () => {}, removeReminder: async () => {} }));
vi.mock('./findMatches.js', () => ({ findMatches: mocks.find, refreshSportEpg: async () => {}, autoRemindTeams: async () => 0 }));
vi.mock('../../sync/panelEpg.js', () => ({ startPanelEpg: () => null, panelEpgInFlight: () => null }));
import { SportScreen } from './SportScreen.js';
import { TvPressable } from '../../ui/TvPressable.js';
let tree: ReactTestRenderer | null = null;
const session = { db: {}, sources: [] } as unknown as AppSession;
function text(node: any): string {
  if (typeof node === 'string') return node;
  if (!node) return '';
  if (Array.isArray(node)) return node.map(text).join('');
  return text(node.children ?? node.props?.children ?? []);
}
function button(label: string) { return tree!.root.findAllByType(TvPressable).find((node) => text(node) === label)!; }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  mocks.teams.mockResolvedValue(['Brøndby']); mocks.find.mockResolvedValue([]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = null; expect(vi.getTimerCount()).toBe(0);
  vi.unstubAllGlobals(); vi.useRealTimers();
});
async function mount() {
  const back = { current: () => false };
  await act(async () => { tree = create(createElement(SportScreen, { session, onPlay: vi.fn(), backRef: back }), { createNodeMock: (node) => {
    const props = node.props as { onFocus?: (event: object) => void };
    return { requestTVFocus: () => props.onFocus?.({}) };
  } }); });
  return back;
}
it('gemt favorithold skjuler aldrig Tennis eller Formel 1', async () => {
  await mount();
  expect(button('★ Brøndby')).toBeDefined();
  expect(button('Tennis')).toBeDefined(); expect(button('Formel 1')).toBeDefined();
});

it('Fodbold er foerste sportsgenvej og soeger ved tryk', async () => {
  await mount();
  const buttons = tree!.root.findAllByType(TvPressable);
  const football = button('Fodbold');
  expect(football).toBeDefined();
  expect(buttons.indexOf(football)).toBeLessThan(buttons.indexOf(button('★ Brøndby')));
  await act(async () => football.props.onPress());
  expect(mocks.find).toHaveBeenCalledWith(session.db, 'Fodbold', expect.anything());
});
it('Tilbage fra et hold rydder filteret og bevarer holdet og sportsgenvejene', async () => {
  const back = await mount();
  await act(async () => button('★ Brøndby').props.onPress());
  let handled = false;
  await act(async () => { handled = back.current(); });
  expect(handled).toBe(true);
  await act(async () => { vi.advanceTimersByTime(500); });
  expect(button('Alle sportsgrene')).toBeUndefined();
  expect(button('Tennis')).toBeDefined(); expect(button('Formel 1')).toBeDefined();
  expect(button('★ Brøndby')).toBeDefined(); expect(mocks.save).not.toHaveBeenCalled();
  expect(back.current()).toBe(false);
  expect(mocks.scroll).toHaveBeenCalledWith({ offset: 0, animated: false });
});
it('Alle sportsgrene rydder ogsaa et valgt sportsfilter', async () => {
  await mount();
  await act(async () => button('Tennis').props.onPress());
  expect(mocks.find).toHaveBeenCalledWith(session.db, 'Tennis', expect.anything());
  await act(async () => button('Alle sportsgrene').props.onPress());
  expect(button('Alle sportsgrene')).toBeUndefined();
  expect(button('Formel 1')).toBeDefined();
});
it('et favorithold som ogsaa er en sportsgenvej vises kun én gang', async () => {
  mocks.teams.mockResolvedValue(['Tennis']);
  await mount();
  expect(tree!.root.findAllByType(TvPressable).filter((node) => text(node).includes('Tennis'))).toHaveLength(1);
  expect(button('Formel 1')).toBeDefined();
});
