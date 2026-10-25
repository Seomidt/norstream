import { createElement, type ElementType } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Programme } from '@norstream/core';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';

const mocks = vi.hoisted(() => ({
  list: vi.fn(), short: vi.fn(), full: vi.fn(), scroll: vi.fn(), focus: vi.fn(),
  keys: new Set<(event: Record<string, unknown>) => void>(),
}));
vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    Platform: { isTV: true, OS: 'android' },
    View: 'View', Text: 'Text', Pressable: 'Pressable', TVFocusGuideView: 'TVFocusGuideView',
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5 },
    useTVEventHandler: (handler: (event: Record<string, unknown>) => void) => {
      React.useEffect(() => {
        mocks.keys.add(handler);
        return () => { mocks.keys.delete(handler); };
      }, [handler]);
    },
    // Denne native erstatning monterer kun et vindue. Et offscreen fokusmaal
    // bliver foerst til et native view naar scrollToIndex har flyttet vinduet.
    FlatList: React.forwardRef(function VirtualList(props: Record<string, any>, ref) {
      const [index, setIndex] = React.useState(props.initialScrollIndex ?? 0);
      React.useImperativeHandle(ref, () => ({
        scrollToIndex: (options: { index: number }) => {
          mocks.scroll(options);
          setIndex(options.index);
        },
      }), []);
      const count = props.initialNumToRender ?? 10;
      const start = Math.max(0, Math.min(props.data.length - count, index - Math.floor(count / 2)));
      return React.createElement('NativeList', props,
        props.data.slice(start, start + count).map((item: StoredChannel, offset: number) =>
          React.createElement(React.Fragment, { key: props.keyExtractor(item) },
            props.renderItem({ item, index: start + offset }))));
    }),
  };
});
vi.mock('../../storage/programmes.js', () => ({ listProgrammes: mocks.list }));
vi.mock('../../sync/epgCache.js', () => ({ ensureEpg: mocks.short, ensureFullEpg: mocks.full }));
vi.mock('../../ui/ChannelLogo.js', () => ({ ChannelLogo: () => null }));

import { TimelineGrid } from './TimelineGrid.js';
import { TvPressable } from '../../ui/TvPressable.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const host = (name: string): ElementType => name as ElementType;
const channel = (index: number) => ({
  id: `timeline:${index}`, sourceId: 'timeline', name: `Kanal ${index}`,
  logoUrls: [], archiveDays: 7, hasArchive: true,
}) as unknown as StoredChannel;
const channels = Array.from({ length: 1000 }, (_, index) => channel(index));
const session = { db: {}, credsBySource: new Map([['timeline', {}]]), fetchImpl: vi.fn() } as unknown as AppSession;
type Props = Parameters<typeof TimelineGrid>[0];
function props(overrides: Partial<Props> = {}): Props {
  return {
    session, channels, now: new Date(2026, 9, 12, 18), hasDialectFor: () => true,
    onFocusChannel: vi.fn(), onFocusProgramme: vi.fn(), onOpen: vi.fn(),
    offsetMinutes: 0, onStepTime: vi.fn(), focusFirstSignal: 0, active: true,
    returnFocusChannelId: null, onReturnFocus: vi.fn(), ...overrides,
  };
}
function text(node: any): string {
  if (typeof node === 'string') return node;
  if (node == null) return '';
  return Array.isArray(node) ? node.map(text).join('') : text(node.children ?? node.props?.children);
}
let tree: ReactTestRenderer | null = null;
async function mount(value: Props) {
  await act(async () => {
    tree = create(createElement(TimelineGrid, value), {
      createNodeMock: (node) => ({ requestTVFocus: () => mocks.focus(node.props) }),
    });
  });
  await act(async () => {
    tree!.root.findByType(host('TVFocusGuideView')).props.onLayout({ nativeEvent: { layout: { width: 570, height: 400 } } });
  });
  return tree!;
}
const row = (index: number) => tree!.root.findAllByType(TvPressable).find(node => text(node).includes(`Kanal ${index}`))!;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 12, 18));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.clearAllMocks(); mocks.keys.clear();
  mocks.list.mockResolvedValue([]);
  mocks.short.mockResolvedValue({ failed: 0 });
  mocks.full.mockResolvedValue({ failed: 0 });
});
afterEach(async () => {
  if (tree !== null) await act(async () => tree!.unmount());
  tree = null;
  expect(mocks.keys.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  vi.unstubAllGlobals(); vi.useRealTimers();
});

it('tegner et begraenset TV-vindue for 1000 kanaler med fast layout til alle indeks', async () => {
  const value = await mount(props());
  const list = value.root.findByType(host('NativeList'));
  expect(list.props.data).toHaveLength(1000);
  expect(list.props.initialNumToRender).toBeLessThanOrEqual(12);
  expect(list.props.maxToRenderPerBatch).toBeLessThanOrEqual(12);
  expect(list.props.windowSize).toBeLessThanOrEqual(5);
  expect(value.root.findAllByType(TvPressable).length).toBeLessThanOrEqual(12);
  expect(list.props.getItemLayout(null, 999)).toEqual({ length: 62, offset: 61938, index: 999 });
  expect(new Set(mocks.list.mock.calls.map(call => call[1])).size).toBeLessThan(50);
  expect(mocks.short.mock.calls.every(call => call[3].length <= 12)).toBe(true);
});

it('ruller et fokusmaal uden for vinduet ind og beholder det indtil native bekraeftelse', async () => {
  const options = props();
  await mount(options);
  expect(row(900)).toBeUndefined();
  await act(async () => tree!.update(createElement(TimelineGrid, { ...options, returnFocusChannelId: channels[900]!.id })));
  expect(mocks.scroll).toHaveBeenCalledWith({ index: 900, viewPosition: 0.5, animated: false });
  expect(row(900)).toBeDefined();
  await act(async () => { vi.advanceTimersByTime(20); });
  expect(mocks.focus.mock.calls.some(call => text(call[0]).includes('Kanal 900'))).toBe(true);
  expect(options.onReturnFocus).not.toHaveBeenCalled();
  await act(async () => row(900).props.onFocus());
  expect(options.onReturnFocus).toHaveBeenCalledWith(true);
  const count = mocks.focus.mock.calls.length;
  await act(async () => { vi.advanceTimersByTime(1600); });
  expect(mocks.focus).toHaveBeenCalledTimes(count);
  expect(options.onReturnFocus).not.toHaveBeenCalledWith(false);
});

it('holder op/ned fokus i midten og behandler venstre/hoejre kun ved tastslip', async () => {
  const options = props({ channels: channels.slice(0, 12) });
  await mount(options);
  await act(async () => row(2).props.onFocus());
  await act(async () => row(3).props.onFocus());
  await act(async () => row(2).props.onFocus());
  expect(mocks.scroll.mock.calls.slice(-3).map(call => call[0].index)).toEqual([2, 3, 2]);
  await act(async () => {
    for (const handler of mocks.keys) {
      handler({ eventType: 'right', eventKeyAction: 0 });
      handler({ eventType: 'right', eventKeyAction: 1 });
      handler({ eventType: 'left', eventKeyAction: 1 });
    }
  });
  expect(options.onStepTime).toHaveBeenCalledTimes(2);
  expect(options.onStepTime).toHaveBeenNthCalledWith(1, 30);
  expect(options.onStepTime).toHaveBeenNthCalledWith(2, -30);
});

it('annullerer native fokusgentagelse synkront inden menuens naeste render', async () => {
  const cancelFocusRef = { current: null as (() => void) | null };
  const options = props({ returnFocusChannelId: channels[900]!.id, cancelFocusRef });
  await mount(options);
  expect(cancelFocusRef.current).toEqual(expect.any(Function));
  await act(async () => { cancelFocusRef.current!(); });
  await act(async () => { vi.advanceTimersByTime(1600); });
  expect(mocks.focus).not.toHaveBeenCalled();
  expect(options.onReturnFocus).not.toHaveBeenCalled();
});

it('Tilbage standser naeste metadatabatch synkront og indgangssignalet genoptager det synlige udsnit', async () => {
  const epg = deferred<unknown>();
  mocks.short.mockReturnValueOnce(epg.promise);
  const cancelFocusRef = { current: null as (() => void) | null };
  const options = props({ cancelFocusRef });
  await mount(options);
  expect(mocks.short).toHaveBeenCalledTimes(1);
  const firstIds = new Set<string>(mocks.short.mock.calls[0]![3]);
  const reads = mocks.list.mock.calls.length;
  await act(async () => { cancelFocusRef.current!(); });
  await act(async () => { epg.resolve({ failed: 0 }); });
  expect(mocks.short).toHaveBeenCalledTimes(1);
  expect(mocks.full).not.toHaveBeenCalled();
  expect(mocks.list).toHaveBeenCalledTimes(reads);

  // Sene native rulningsdata og urets nye halvtimesvindue maa ikke starte
  // guidens arbejde igen, mens menuen stadig har fokus.
  await act(async () => {
    tree!.root.findByType(host('NativeList')).props.onViewableItemsChanged({
      viewableItems: [{ item: channels[200], index: 200, isViewable: true }], changed: [],
    });
  });
  const afterBack = { ...options, now: new Date(options.now.getTime() + 30 * 60_000) };
  await act(async () => tree!.update(createElement(TimelineGrid, afterBack)));
  expect(mocks.short).toHaveBeenCalledTimes(1);
  expect(mocks.full).not.toHaveBeenCalled();
  expect(mocks.list).toHaveBeenCalledTimes(reads);

  // Guiden er fortsat aktiv bag menuen; pil hoejre sender et nyt signal.
  await act(async () => tree!.update(createElement(TimelineGrid, { ...afterBack, focusFirstSignal: 1 })));
  expect(mocks.list.mock.calls.length).toBeGreaterThan(reads);
  expect(mocks.short.mock.calls.slice(1).some(call => call[3].some((id: string) => !firstIds.has(id)))).toBe(true);
  expect(mocks.full.mock.calls.length).toBeGreaterThan(0);
  expect(new Set(mocks.list.mock.calls.map(call => call[1])).size).toBeLessThan(50);
});

it('holder kun programdata for det synlige udsnit og fokus og deler ikke cachen mellem databaser', async () => {
  mocks.list.mockImplementation(async (_db, id: string) => [{
    channelId: id, title: `Program ${id}`, description: null,
    start: new Date(Date.now() - 60_000), stop: new Date(Date.now() + 60_000),
  }]);
  await mount(props());
  await act(async () => row(0).props.onFocus());
  const cached = (index: number): Programme[] => tree!.root.findByType(host('NativeList')).props
    .renderItem({ item: channels[index], index }).props.programmes;
  const view = async (index: number) => act(async () => {
    tree!.root.findByType(host('NativeList')).props.onViewableItemsChanged({
      viewableItems: [{ item: channels[index], index, isViewable: true }], changed: [],
    });
  });
  await view(100);
  expect(cached(100)[0]?.title).toBe('Program timeline:100');
  await view(200);
  expect(cached(200)[0]?.title).toBe('Program timeline:200');
  expect(cached(100)).toHaveLength(0);
  expect(cached(0)[0]?.title).toBe('Program timeline:0');
  expect(channels.filter((_item, index) => cached(index).length > 0).length).toBeLessThanOrEqual(23);

  await act(async () => { tree!.unmount(); tree = null; });
  await mount(props({ session: { ...session, db: {} } as AppSession, active: false }));
  expect(cached(0)).toHaveLength(0);
  expect(cached(200)).toHaveLength(0);
});

it.each(['inactive', 'unmount'] as const)('stopper et sent cache-svar efter %s', async (stop) => {
  const cache = deferred<Programme[]>();
  mocks.list.mockReturnValue(cache.promise);
  const options = props({ channels: channels.slice(0, 12) });
  await mount(options);
  const reads = mocks.list.mock.calls.length;
  const requests = mocks.short.mock.calls.length;
  await act(async () => {
    if (stop === 'unmount') { tree!.unmount(); tree = null; }
    else tree!.update(createElement(TimelineGrid, { ...options, active: false }));
  });
  await act(async () => {
    cache.resolve([{ channelId: channels[0]!.id, title: 'Sent program', description: null,
      start: new Date(Date.now() - 60_000), stop: new Date(Date.now() + 60_000) }]);
  });
  expect(mocks.list).toHaveBeenCalledTimes(reads);
  expect(mocks.short).toHaveBeenCalledTimes(requests);
  expect(mocks.full).not.toHaveBeenCalled();
  if (tree !== null) expect(text(tree.toJSON())).not.toContain('Sent program');
});

it.each(['inactive', 'unmount'] as const)('starter ikke fuld EPG efter et sent kort EPG-svar og %s', async (stop) => {
  const epg = deferred<unknown>();
  mocks.short.mockReturnValue(epg.promise);
  const options = props({ channels: channels.slice(0, 12) });
  await mount(options);
  expect(mocks.short.mock.calls.length).toBeGreaterThan(0);
  expect(mocks.full).not.toHaveBeenCalled();
  const reads = mocks.list.mock.calls.length;
  const requests = mocks.short.mock.calls.length;
  await act(async () => {
    if (stop === 'unmount') { tree!.unmount(); tree = null; }
    else tree!.update(createElement(TimelineGrid, { ...options, active: false }));
  });
  await act(async () => { epg.resolve({ failed: 0 }); });
  expect(mocks.list).toHaveBeenCalledTimes(reads);
  expect(mocks.short).toHaveBeenCalledTimes(requests);
  expect(mocks.full).not.toHaveBeenCalled();
});
