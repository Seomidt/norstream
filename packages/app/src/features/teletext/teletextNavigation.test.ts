import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LoadedTeletextPage } from './drTeletext.js';
const mocks = vi.hoisted(() => ({ load: vi.fn(), stateChanged: null as null | ((state: string) => void) }));
vi.mock('react-native', () => ({
  Platform: { isTV: true, OS: 'android' }, View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (value: unknown) => value }, useWindowDimensions: () => ({ width: 864, height: 486 }),
  AppState: { currentState: 'active', addEventListener: (_: string, run: (state: string) => void) => {
    mocks.stateChanged = run; return { remove: () => { mocks.stateChanged = null; } };
  } },
}));
vi.mock('../vod/webview.js', () => ({ webView: () => 'WebView' }));
vi.mock('./drTeletext.js', async original => ({ ...await original<typeof import('./drTeletext.js')>(), loadDrTeletextPage: mocks.load }));
import { TeletextScreen } from './TeletextScreen.js';
import { TeletextError } from './drTeletext.js';
import { TvPressable } from '../../ui/TvPressable.js';

const page = (number: number): LoadedTeletextPage => ({
  number, imageUrl: `https://www.dr.dk/fttvimg/DR1/${number}_0001-1.gif`,
  width: 320, height: 375, previous: number === 100 ? 899 : number - 1, next: number + 1,
  imageData: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', loadedAt: 1,
});
let tree: ReactTestRenderer | null;
function text(node: any): string {
  if (typeof node === 'string') return node;
  if (!node) return '';
  if (Array.isArray(node)) return node.map(text).join('');
  return text(node.children ?? node.props?.children ?? []);
}
async function press(label: string) {
  const button = tree!.root.findAllByType(TvPressable).find(node => text(node) === label)!;
  await act(async () => button.props.onPress());
}
function document(): string { return tree!.root.findByType('WebView' as any).props.source.html; }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  mocks.load.mockImplementation(async (number: number) => page(number));
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = null; expect(vi.getTimerCount()).toBe(0);
  vi.unstubAllGlobals(); vi.useRealTimers();
});
async function mount() {
  const back = { current: () => false };
  await act(async () => { tree = create(createElement(TeletextScreen, { backRef: back })); });
  return back;
}

it('tre cifre skifter til den valgte DR-side uden tastatur og uden at hente delvise sidenumre', async () => {
  await mount();
  await press('1'); await press('0');
  expect(mocks.load).toHaveBeenCalledTimes(1);
  await press('1');
  expect(mocks.load.mock.calls.map(([number]) => number)).toEqual([100, 101]);
  expect(document()).toContain('side 101');
  await press('Næste ›'); expect(document()).toContain('side 102');
  await press('‹ Forrige'); expect(document()).toContain('side 101');
});

it('en forsinket side 100 maa ikke overskrive side 101 efter hurtigt sidevalg', async () => {
  let complete!: (value: LoadedTeletextPage) => void;
  mocks.load.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  await mount();
  const signal = mocks.load.mock.calls[0]![1] as AbortSignal;
  await press('1'); await press('0'); await press('1');
  expect(signal.aborted).toBe(true);
  expect(document()).toContain('side 101');
  await act(async () => complete(page(100)));
  expect(document()).toContain('side 101');
});

it('Tilbage rydder en delvis indtastning foer menuen faar Tilbage', async () => {
  const back = await mount();
  await press('2');
  await act(async () => { expect(back.current()).toBe(true); });
  expect(back.current()).toBe(false);
  expect(document()).toContain('side 100');
  expect(mocks.load).toHaveBeenCalledTimes(1);
});

it('en manglende valgt side viser ikke billedet fra den forrige side', async () => {
  await mount();
  mocks.load.mockRejectedValueOnce(new TeletextError('missing'));
  await press('2'); await press('0'); await press('9');
  expect(tree!.root.findAllByType('WebView' as any)).toHaveLength(0);
  expect(text(tree!.toJSON())).toContain('DR har ikke side 209');
});

it('opdaterer hvert minut, bevarer sidste billede ved netfejl og stopper i baggrunden', async () => {
  await mount();
  mocks.load.mockRejectedValueOnce(new Error('network'));
  await act(async () => { vi.advanceTimersByTime(60_000); });
  expect(mocks.load).toHaveBeenCalledTimes(2);
  expect(document()).toContain('side 100');
  expect(text(tree!.toJSON())).toContain('kunne ikke hentes');
  await act(async () => { mocks.stateChanged!('background'); });
  await act(async () => { vi.advanceTimersByTime(120_000); });
  expect(mocks.load).toHaveBeenCalledTimes(2);
  await act(async () => { mocks.stateChanged!('active'); });
  expect(mocks.load).toHaveBeenCalledTimes(3);
});
