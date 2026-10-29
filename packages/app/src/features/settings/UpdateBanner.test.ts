import { createElement, StrictMode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  check: vi.fn(), download: vi.fn(), install: vi.fn(), discard: vi.fn(),
  activeLeases: 0,
  releases: [] as Array<ReturnType<typeof vi.fn>>,
  appListeners: new Set<(state: string) => void>(),
  backListeners: new Set<() => boolean>(),
  progressListeners: new Set<(value: unknown) => void>(),
}));
vi.mock('react-native', () => ({
  View: 'View', Text: 'Text', ActivityIndicator: 'ActivityIndicator',
  Platform: { isTV: true, OS: 'android' },
  StyleSheet: { create: (styles: unknown) => styles },
  AppState: { addEventListener: (_event: string, listener: (state: string) => void) => {
    f.appListeners.add(listener); return { remove: () => f.appListeners.delete(listener) };
  } },
  BackHandler: { addEventListener: (_event: string, listener: () => boolean) => {
    f.backListeners.add(listener); return { remove: () => f.backListeners.delete(listener) };
  } },
}));
vi.mock('../../ui/tv.js', () => ({ isTV: true }));
vi.mock('../../ui/TvPressable.js', () => ({ TvPressable: 'TvPressable' }));
vi.mock('../../ui/ThemeContext.js', () => ({
  useTheme: () => ({ colors: { text: '#fff' } }),
  useStyles: (make: (colors: unknown) => unknown) => make({ text: '#fff' }),
}));
vi.mock('./appUpdate.js', () => ({
  checkForUpdate: f.check,
  currentVersionCode: () => 416,
  downloadApk: f.download,
  installApk: f.install,
  discardApk: f.discard,
  shouldDiscardAfter: () => false,
  pauseApkDownloads: () => {
    f.activeLeases += 1;
    let released = false;
    const release = vi.fn(() => {
      if (released) return;
      released = true; f.activeLeases -= 1;
    });
    f.releases.push(release);
    return release;
  },
  onDownloadProgress: (listener: (value: unknown) => void) => {
    f.progressListeners.add(listener); return () => f.progressListeners.delete(listener);
  },
}));

import { UpdateBanner } from './UpdateBanner.js';

const update = { versionCode: 417, available: true, url: 'https://example.invalid/update.apk', size: 100_000_000 };
let tree: ReactTestRenderer | null = null;
const mount = async (quiet = false, strict = false) => act(async () => {
  const banner = createElement(UpdateBanner, { quiet });
  tree = create(strict ? createElement(StrictMode, null, banner) : banner);
});
const quiet = async (value: boolean) => act(async () => { tree!.update(createElement(UpdateBanner, { quiet: value })); });
const advance = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const foreground = async () => act(async () => { for (const listener of f.appListeners) listener('active'); });
const pressUpdate = async () => act(async () => { tree!.root.findByType('TvPressable' as any).props.onPress(); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 1));
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  f.check.mockReset().mockResolvedValue(update);
  f.download.mockReset().mockResolvedValue('file:///cache/norstream-417.apk');
  f.install.mockReset().mockResolvedValue({ kind: 'cancelled' });
  f.discard.mockReset().mockResolvedValue(undefined);
  f.activeLeases = 0; f.releases.length = 0;
  f.appListeners.clear(); f.backListeners.clear(); f.progressListeners.clear();
  tree = null;
});
afterEach(async () => {
  if (tree !== null) await act(async () => { tree!.unmount(); tree = null; });
  expect(f.activeLeases).toBe(0);
  expect(f.appListeners.size).toBe(0);
  expect(f.backListeners.size).toBe(0);
  expect(f.progressListeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('APK-opdatering venter under afspilning', () => {
  it('henter ingen APK ved 60 sekunders starttjek mens afspilleren er aaben', async () => {
    await mount(true); await advance(60_000);
    expect(f.check).toHaveBeenCalledTimes(1);
    expect(f.download).not.toHaveBeenCalled();
    expect(tree!.toJSON()).toBeNull();
    expect(f.activeLeases).toBe(1);
  });

  it('et sent opdateringssvar maa ikke starte hentning efter afspilleren aabnes', async () => {
    const pending = deferred<typeof update>();
    f.check.mockReturnValueOnce(pending.promise);
    await mount(); await advance(60_000); await quiet(true);
    await act(async () => pending.resolve(update));
    expect(f.download).not.toHaveBeenCalled();
    expect(tree!.toJSON()).toBeNull();
  });

  it('henter en allerede kendt udgave straks efter afspilning uden nyt tjek', async () => {
    await mount(true); await advance(60_000);
    await quiet(false);
    expect(f.download).toHaveBeenCalledTimes(1);
    expect(f.check).toHaveBeenCalledTimes(1);
    expect(f.activeLeases).toBe(0);
    expect(tree!.root.findAllByType('Text' as any).some(node => node.children.join('') === 'Installér nu')).toBe(true);
  });

  it('holder en igangvaerende hentning pauset gennem flere stille renderinger', async () => {
    const pending = deferred<string>(); f.download.mockReturnValueOnce(pending.promise);
    await mount(); await advance(60_000);
    expect(f.download).toHaveBeenCalledTimes(1);
    await quiet(true); await quiet(true); await foreground(); await foreground();
    expect(f.activeLeases).toBe(1);
    expect(f.releases).toHaveLength(1);
    expect(f.download).toHaveBeenCalledTimes(1);
    await quiet(false);
    expect(f.activeLeases).toBe(0);
    expect(f.releases[0]).toHaveBeenCalledTimes(1);
    expect(f.download).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve('file:///cache/norstream-417.apk'));
  });

  it('gentagne forgrundssignaler starter ikke flere samtidige auto-hentninger', async () => {
    const pending = deferred<string>(); f.download.mockReturnValueOnce(pending.promise);
    await mount(); await foreground(); await foreground(); await foreground();
    expect(f.download).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve('file:///cache/norstream-417.apk'));
  });

  it('en fejlet auto-hentning gentages kun efter et manuelt tryk', async () => {
    f.download.mockRejectedValueOnce(new Error('Hentningen fejlede.'));
    await mount(); await advance(60_000); await foreground();
    await quiet(true); await quiet(false);
    expect(f.download).toHaveBeenCalledTimes(1);
    await pressUpdate();
    expect(f.download).toHaveBeenCalledTimes(2);
    expect(f.install).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('en manuelt startet hentning maa ikke installere efter afspilning starter; forlader afspiller %s', async leaveAgain => {
    f.download.mockRejectedValueOnce(new Error('Hentningen fejlede.'));
    await mount(); await advance(60_000);
    const pending = deferred<string>(); f.download.mockReturnValueOnce(pending.promise);
    await pressUpdate(); await quiet(true);
    if (leaveAgain) await quiet(false);
    await act(async () => pending.resolve('file:///cache/norstream-417.apk'));
    expect(f.install).not.toHaveBeenCalled();
    if (!leaveAgain) await quiet(false);
    await pressUpdate();
    expect(f.install).toHaveBeenCalledTimes(1);
    expect(f.download).toHaveBeenCalledTimes(2);
  });

  it('to hurtige tryk paa en klar APK starter kun én installation', async () => {
    await mount(); await advance(60_000);
    const button = tree!.root.findByType('TvPressable' as any);
    await act(async () => { button.props.onPress(); button.props.onPress(); });
    expect(f.install).toHaveBeenCalledTimes(1);
  });

  it('et nyere udgivelsessvar maa ikke lade et gammelt manuelt forsoeg installere', async () => {
    f.download.mockRejectedValueOnce(new Error('Hentningen fejlede.'));
    await mount(); await advance(60_000);
    const pending = deferred<string>(); f.download.mockReturnValueOnce(pending.promise);
    await pressUpdate();
    f.check.mockResolvedValue({ ...update, versionCode: 418 });
    f.download.mockResolvedValue('file:///cache/norstream-418.apk');
    await foreground();
    await act(async () => pending.resolve('file:///cache/norstream-417.apk'));
    expect(f.install).not.toHaveBeenCalled();
    expect(f.download.mock.calls.map(([info]) => info.versionCode)).toEqual([417, 417, 418]);
    await pressUpdate();
    expect(f.install).toHaveBeenCalledWith('file:///cache/norstream-418.apk');
  });

  it('henter en nyere udgave selv om den forrige APK allerede var klar', async () => {
    await mount(); await advance(60_000);
    f.check.mockResolvedValue({ ...update, versionCode: 418 });
    const pending = deferred<string>(); f.download.mockReturnValueOnce(pending.promise);
    await foreground();
    expect(f.download.mock.calls.map(([info]) => info.versionCode)).toEqual([417, 418]);
    expect(tree!.root.findAllByType('Text' as any).some(node => node.children.join('').startsWith('Henter'))).toBe(true);
    await act(async () => pending.resolve('file:///cache/norstream-418.apk'));
    await pressUpdate();
    expect(f.install).toHaveBeenCalledWith('file:///cache/norstream-418.apk');
  });

  it('et sent annulleret installationssvar maa ikke overskrive en nyere fundet udgave', async () => {
    await mount(); await advance(60_000);
    const pending = deferred<{ kind: 'cancelled' }>(); f.install.mockReturnValueOnce(pending.promise);
    await pressUpdate();
    f.check.mockResolvedValue({ ...update, versionCode: 418 });
    f.download.mockResolvedValue('file:///cache/norstream-418.apk');
    await foreground();
    expect(f.download).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ kind: 'cancelled' }));
    expect(f.download.mock.calls.map(([info]) => info.versionCode)).toEqual([417, 418]);
    expect(tree!.toJSON()).not.toBeNull();
    expect(tree!.root.findAllByType('Text' as any).some(node => node.children.join('').includes('NorStream 418'))).toBe(true);
  });

  it('en manuel hentning der afsluttes efter unmount maa ikke aabne installeren', async () => {
    f.download.mockRejectedValueOnce(new Error('Hentningen fejlede.'));
    await mount(); await advance(60_000);
    const pending = deferred<string>(); f.download.mockReturnValueOnce(pending.promise);
    await pressUpdate();
    await act(async () => { tree!.unmount(); tree = null; });
    await act(async () => pending.resolve('file:///cache/norstream-417.apk'));
    expect(f.install).not.toHaveBeenCalled();
  });

  it('unmount annullerer efterkontrollen af en faerdig installation', async () => {
    f.install.mockResolvedValueOnce({ kind: 'installed' });
    await mount(); await advance(60_000); await pressUpdate();
    expect(f.install).toHaveBeenCalledTimes(1);
    await act(async () => { tree!.unmount(); tree = null; });
    await advance(20_000);
    expect(f.check).toHaveBeenCalledTimes(1);
  });

  it('StrictMode og unmount frigiver alle pause-lejer og lyttere', async () => {
    await mount(true, true); await advance(60_000);
    expect(f.activeLeases).toBe(1);
    expect(f.download).not.toHaveBeenCalled();
    await act(async () => { tree!.unmount(); tree = null; });
    expect(f.activeLeases).toBe(0);
    expect(f.releases.every(release => release.mock.calls.length === 1)).toBe(true);
  });

  it('sene svar efter unmount maa hverken hente eller installere', async () => {
    const pending = deferred<typeof update>(); f.check.mockReturnValueOnce(pending.promise);
    await mount(); await advance(60_000);
    await act(async () => { tree!.unmount(); tree = null; });
    await act(async () => pending.resolve(update));
    expect(f.download).not.toHaveBeenCalled();
    expect(f.install).not.toHaveBeenCalled();
  });
});
