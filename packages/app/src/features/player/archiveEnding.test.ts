import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';

// Native afspilning er daekket af playbackConnection.test. Her afproeves
// skaermens rigtige EOF-lyttere, kildevalg, genforsoeg og unmount med TV2-loggen.
const f = vi.hoisted(() => ({
  listeners: new Map<string, Set<(value: any) => void>>(),
  requests: [] as Array<{ from: Date; minutes: number }>,
  offsets: [] as number[],
  clock: vi.fn(async (..._args: unknown[]) => ({ offsetMinutes: 120 } as { offsetMinutes: number; timeZone?: string })),
  epgShift: vi.fn(async (..._args: unknown[]) => 0),
  archiveShift: vi.fn(async (..._args: unknown[]) => 0),
  saveProgress: vi.fn(async (..._args: unknown[]) => {}),
  loads: [] as Array<{ source: unknown; seek: number }>,
  back: vi.fn(),
  seekImmediately: true,
  appState: { currentState: 'active', addEventListener: (_event: string, fn: (state: string) => void) => {
    let entries = f.listeners.get('appState');
    if (entries === undefined) { entries = new Set(); f.listeners.set('appState', entries); }
    entries.add(fn); return { remove: () => entries!.delete(fn) };
  } },
  setting: vi.fn(async () => 'php'),
  player: {
    currentTime: 0, bufferedPosition: 90, duration: 1020, playing: true,
    status: 'readyToPlay', playbackRate: 1, volume: 1, muted: false,
    availableAudioTracks: [{ id: 'audio' }], audioTrack: { id: 'audio' },
    availableVideoTracks: [{ id: 'video' }], videoTrack: { id: 'video' },
    availableSubtitleTracks: [], subtitleTrack: null,
    addListener: (event: string, fn: (value: any) => void) => {
      let entries = f.listeners.get(event);
      if (entries === undefined) { entries = new Set(); f.listeners.set(event, entries); }
      entries.add(fn);
      return { remove: () => entries!.delete(fn) };
    },
    play: () => { f.player.playing = true; },
    pause: () => { f.player.playing = false; },
    seekBy: (seconds: number) => { if (f.seekImmediately) f.player.currentTime = Math.max(0, Math.min(f.player.duration, f.player.currentTime + seconds)); },
  },
}));
vi.mock('react-native', () => ({
  AppState: f.appState,
  Platform: { isTV: true, OS: 'android' }, StyleSheet: { create: (v: unknown) => v, absoluteFill: {} },
  View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator',
  useWindowDimensions: () => ({ width: 864, height: 486 }), useTVEventHandler: () => {},
}));
vi.mock('expo-video', () => ({ VideoView: 'VideoView', useVideoPlayer: () => f.player }));
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('expo-keep-awake', () => ({ useKeepAwake: () => {} }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@norstream/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@norstream/core')>(),
  detectTimeshiftDialect: vi.fn(),
  buildTimeshiftUrl: (_creds: unknown, _id: unknown, from: Date, minutes: number, _dialect: unknown, offset: number) => {
    f.requests.push({ from, minutes });
    f.offsets.push(offset);
    return `https://example.invalid/archive/${f.requests.length}.ts`;
  },
}));
vi.mock('./playbackConnection.js', () => ({ PlaybackConnection: class {
  committed = true; prepared = true; active = true; seeking = false; preparationPhase = 'klar';
  async load(source: unknown, _archive: boolean, seek = 0) {
    f.loads.push({ source, seek }); f.player.currentTime = seek; f.player.status = 'readyToPlay';
  }
  position() { return true; }
  sourceLoaded() { return true; }
  status() {} cancel() {} dispose() {} setPlayingIntent() {}
} }));
vi.mock('../../storage/settings.js', () => ({
  getTimeshiftDialect: () => f.setting(),
  getPanelOffsetMinutes: async () => 120, getSubtitlePreference: async () => null,
  setTimeshiftDialect: async () => {}, setLastChannelId: async () => {},
}));
vi.mock('../../storage/programmes.js', () => ({ getNowNext: async () => ({ now: null, next: null }) }));
vi.mock('../../storage/channels.js', () => ({ listChannels: async () => [] }));
vi.mock('../../storage/history.js', () => ({ recordChannelWatch: async () => {}, saveArchiveProgress: f.saveProgress }));
vi.mock('../../storage/epgTiming.js', () => ({ getEpgTimeShift: f.epgShift, getArchiveTimeShift: f.archiveShift }));
vi.mock('../../sync/epgCache.js', () => ({ ensureEpg: async () => {} }));
vi.mock('../../sync/panelClock.js', () => ({ refreshPanelClock: f.clock }));
vi.mock('../../sources/access.js', () => ({ liveUrlFor: (_access: unknown, _channel: unknown, format: string) => `https://example.invalid/live.${format}` }));
vi.mock('../../net/doh.js', () => ({ streamSource: (source: string) => source }));
vi.mock('../../diagnostics/reporter.js', () => ({ setPlaybackSnapshot: () => {}, closePlaybackSnapshot: () => {} }));
vi.mock('../../diagnostics/log.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../diagnostics/log.js')>(), logEvent: () => {}, clockOf: () => 'tid',
}));
vi.mock('../../ui/ChannelLogo.js', () => ({ ChannelLogo: () => null }));
vi.mock('./ChannelOverlay.js', () => ({ ChannelOverlay: () => null }));
vi.mock('./TrackPicker.js', () => ({ TrackPicker: () => null }));
vi.mock('./RadioView.js', () => ({ RadioView: () => null }));
vi.mock('./useRadioNowPlaying.js', () => ({ useRadioNowPlaying: () => null }));
vi.mock('../radio/useSaveSong.js', () => ({ useSaveSong: () => null }));

import { PlayerScreen } from './PlayerScreen.js';
import { LandscapePlayer } from './Landscape.js';
import { applyStreamFormatSetting } from './format.js';

const at = (time: string) => new Date(`2026-10-16T${time}Z`);
const news = { channelId: 'tv2', title: '18-Nyhederne', description: null, start: at('18:00:00'), stop: at('18:20:00') };
const access = { creds: {} };
const session = { db: {}, access: () => access } as unknown as AppSession;
const channel = { id: 'tv2', sourceId: 'test', streamId: 'tv2', name: 'TV 2', logoUrls: [], hasArchive: true } as unknown as StoredChannel;
let tree: ReactTestRenderer | null;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(at('18:19:08.546'));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  f.requests.length = 0; f.loads.length = 0; f.listeners.clear();
  f.offsets.length = 0; f.clock.mockReset().mockResolvedValue({ offsetMinutes: 120 });
  f.epgShift.mockReset().mockResolvedValue(0); f.archiveShift.mockReset().mockResolvedValue(0); f.saveProgress.mockClear();
  f.player.currentTime = 0; f.player.status = 'readyToPlay'; f.player.playing = true;
  f.player.duration = 1020; f.seekImmediately = true;
  f.setting.mockReset().mockResolvedValue('php');
  f.back.mockReset(); f.appState.currentState = 'active';
  applyStreamFormatSetting('auto');
  tree = null;
});
afterEach(async () => {
  if (tree !== null) await act(async () => tree!.unmount());
  expect([...f.listeners.values()].every(entries => entries.size === 0)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  vi.unstubAllGlobals(); vi.useRealTimers();
});
const mount = async (programme = news) => act(async () => { tree = create(createElement(PlayerScreen, { session, channel, startFrom: programme, onBack: f.back })); });
async function end(position: number, now: string) {
  vi.setSystemTime(at(now));
  await act(async () => {
    f.player.currentTime = position; f.player.status = 'idle'; f.player.playing = false;
    for (const fn of [...f.listeners.get('playToEnd') ?? []]) fn(undefined);
  });
}

describe('TV2: igangvaerende udsendelse slutter under forsinket afspilning', () => {
  it('19 News bruger +60 i EPG og arkiv uden at forlaenge et voksende arkiv med en time', async () => {
    vi.setSystemTime(new Date('2026-10-25T18:15:00Z'));
    f.epgShift.mockResolvedValue(60); f.archiveShift.mockResolvedValue(60);
    f.clock.mockResolvedValue({ offsetMinutes: 60 });
    const programme = { ...news, title: '19 News', start: new Date('2026-10-25T18:00:00Z'), stop: new Date('2026-10-25T18:30:00Z') };
    await mount(programme);
    expect(f.requests).toEqual([{ from: programme.start, minutes: 13 }]);
    expect(f.epgShift).toHaveBeenCalledWith(session.db, channel.sourceId);
    expect(f.archiveShift).toHaveBeenCalledWith(session.db, channel.sourceId);
    // Aendrede indstillinger maa ikke omfortolke et allerede startet stykke.
    f.epgShift.mockResolvedValue(0);
    await act(async () => {
      f.player.currentTime = 30;
      for (const fn of [...f.listeners.get('timeUpdate') ?? []]) fn({ currentTime: 30, videoRenderedFrames: 0 });
      f.player.currentTime = 0; f.player.status = 'idle'; f.player.playing = false;
      for (const fn of [...f.listeners.get('playToEnd') ?? []]) fn(undefined);
    });
    expect(f.requests[1]?.from).toEqual(programme.start);
    expect(f.loads[1]?.seek).toBe(30);
    expect(f.epgShift).toHaveBeenCalledTimes(1);
    expect(f.archiveShift).toHaveBeenCalledTimes(1);
    expect(f.saveProgress.mock.calls.at(-1)?.[5]).toBe(60);
  });

  it('en separat arkivkorrektion aendrer kun adressens start, ikke programmets tid eller varighed', async () => {
    vi.setSystemTime(new Date('2026-10-25T18:15:00Z'));
    f.epgShift.mockResolvedValue(60); f.archiveShift.mockResolvedValue(0);
    const programme = { ...news, start: new Date('2026-10-25T18:00:00Z'), stop: new Date('2026-10-25T18:30:00Z') };
    await mount(programme);
    expect(f.requests).toEqual([{ from: new Date('2026-10-25T17:00:00Z'), minutes: 13 }]);
    expect(programme.start.toISOString()).toBe('2026-10-25T18:00:00.000Z');
    expect(f.loads[0]?.seek).toBe(0);
  });

  it('bruger et friskt panelur efter vintertid og genbruger det ved fortsaettelse', async () => {
    vi.setSystemTime(new Date('2026-10-25T17:04:00Z'));
    f.clock.mockResolvedValue({ offsetMinutes: 60, timeZone: 'Europe/Copenhagen' });
    const programme = { ...news, start: new Date('2026-10-25T17:00:00Z'), stop: new Date('2026-10-25T17:30:00Z') };
    await mount(programme);
    expect(f.offsets).toEqual([60]);
    expect(f.clock).toHaveBeenCalledTimes(1);
    expect(f.clock.mock.calls[0]?.slice(0, 2)).toEqual([session.db, channel.sourceId]);
    await act(async () => {
      f.player.currentTime = 30;
      for (const fn of [...f.listeners.get('timeUpdate') ?? []]) fn({ currentTime: 30, videoRenderedFrames: 0 });
      f.player.currentTime = 0; f.player.status = 'idle'; f.player.playing = false;
      for (const fn of [...f.listeners.get('playToEnd') ?? []]) fn(undefined);
    });
    expect(f.offsets).toEqual([60, 60]);
    expect(f.clock).toHaveBeenCalledTimes(1);
    expect(f.loads.map(load => load.seek)).toEqual([0, 30]);
  });

  it('bruger sommertid til gaarssdagens arkiv selv om panelet nu er paa vintertid', async () => {
    vi.setSystemTime(new Date('2026-10-25T17:04:00Z'));
    f.clock.mockResolvedValue({ offsetMinutes: 60, timeZone: 'Europe/Copenhagen' });
    await mount({ ...news, start: new Date('2026-10-24T16:00:00Z'), stop: new Date('2026-10-24T16:30:00Z') });
    expect(f.offsets).toEqual([120]);
    expect(f.clock).toHaveBeenCalledTimes(1);
  });

  it('et sent svar fra paneluret maa ikke starte arkivet efter Tilbage', async () => {
    let resolveClock!: (clock: { offsetMinutes: number }) => void;
    f.clock.mockImplementationOnce(() => new Promise(resolve => { resolveClock = resolve; }));
    await mount();
    expect(f.requests).toHaveLength(0);
    await act(async () => { tree!.unmount(); tree = null; });
    await act(async () => resolveClock({ offsetMinutes: 60 }));
    expect(f.requests).toHaveLength(0);
    expect(f.loads).toHaveLength(0);
  });

  it('brugerens Proev igen henter ur paa ny efter et mislykket arkivforloeb', async () => {
    await mount();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await status('error'); await advance(attempt * 1500);
    }
    expect(f.clock).toHaveBeenCalledTimes(1);
    f.clock.mockResolvedValue({ offsetMinutes: 60 });
    const retry = tree!.root.findAllByType('Text' as any).find(node => node.children.join('') === 'Prøv igen');
    expect(retry).toBeDefined();
    await act(async () => retry!.parent!.props.onPress());
    expect(f.clock).toHaveBeenCalledTimes(2);
    expect(f.offsets.at(-1)).toBe(60);
    expect(f.requests.at(-1)?.from).toEqual(news.start);
  });

  it.each([undefined, 0].flatMap(frames => [{ frames, completed: false }, { frames, completed: true }]))('bevarer 30 sekunders fremdrift gennem gentagne EOF, faerdig $completed og billedtaeller $frames', async ({ frames, completed }) => {
    if (completed) vi.setSystemTime(at('18:40:00'));
    await mount(completed ? news : { ...news, stop: at('19:00:00') });
    for (const [index, start] of [0, 30, 0].entries()) {
      f.player.playing = true;
      for (let second = 1; second <= 30; second += 1) {
        await act(async () => {
          f.player.currentTime = start + second;
          for (const fn of [...f.listeners.get('timeUpdate') ?? []]) fn({ currentTime: start + second, videoRenderedFrames: frames });
        });
        await advance(1000);
      }
      expect(f.loads).toHaveLength(index + 1);
      await act(async () => {
        // Nogle native EOF-forloeb nulstiller uret inden slut-haendelsen.
        f.player.currentTime = 0; f.player.status = 'idle'; f.player.playing = false;
        for (const fn of [...f.listeners.get('timeUpdate') ?? []]) fn({ currentTime: 0, videoRenderedFrames: frames });
        for (const fn of [...f.listeners.get('playToEnd') ?? []]) fn(undefined);
      });
      expect(f.loads).toHaveLength(index + 2);
    }
    expect(f.requests.map(request => request.from)).toEqual([at('18:00:00'), at('18:00:00'), at('18:01:00'), at('18:01:00')]);
    expect(f.loads.map(load => load.seek)).toEqual([0, 30, 0, 30]);
    expect(f.loads.map(load => load.source)).not.toContain('https://example.invalid/live.ts');
    expect(f.back).not.toHaveBeenCalled();
  });

  it('genforbinder fra 30 s efter native fejl med nulstillet ur og tom billedtaeller', async () => {
    await mount({ ...news, stop: at('19:00:00') });
    f.player.currentTime = 30;
    await act(async () => {
      for (const fn of [...f.listeners.get('timeUpdate') ?? []]) fn({ currentTime: 30, videoRenderedFrames: 0 });
    });
    f.player.currentTime = 0;
    await status('error'); await advance(1500);
    expect(f.loads.map(load => load.seek)).toEqual([0, 30]);
    expect(f.requests[1]?.from).toEqual(news.start);
  });

  it('et bevidst HLS-tilbage-seek nulstiller billeduret og bevarer det lavere tidspunkt ved EOF', async () => {
    applyStreamFormatSetting('m3u8'); f.setting.mockResolvedValue('path');
    await mount();
    f.player.currentTime = 80;
    await act(async () => {
      for (const fn of [...f.listeners.get('timeUpdate') ?? []]) fn({ currentTime: 80, videoRenderedFrames: 2000 });
      expect(tree!.root.findByType(LandscapePlayer).props.onPlayerKey('left')).toBe(true);
    });
    expect(f.player.currentTime).toBe(70);
    await act(async () => {
      for (const fn of [...f.listeners.get('timeUpdate') ?? []]) fn({ currentTime: 70, videoRenderedFrames: 2001 });
    });
    await end(0, '18:20:08.546');
    expect(f.requests[1]?.from).toEqual(at('18:01:00'));
    expect(f.loads[1]?.seek).toBe(10);
  });

  it.each([
    { key: 'left', taps: 1, duration: 1020, target: 70, seek: 10 },
    { key: 'left', taps: 2, duration: 1020, target: 60, seek: 0 },
    { key: 'right', taps: 1, duration: 1020, target: 110, seek: 50 },
    { key: 'right', taps: 1, duration: 85, target: 85, seek: 25 },
  ])('venter paa $taps asynkrone HLS-spolinger $key til $target s trods gamle samples og native poll', async ({ key, taps, duration, target, seek }) => {
    applyStreamFormatSetting('m3u8'); f.setting.mockResolvedValue('path');
    f.seekImmediately = false; f.player.duration = duration;
    await mount();
    f.player.currentTime = 80;
    await act(async () => {
      for (const fn of [...f.listeners.get('timeUpdate') ?? []]) fn({ currentTime: 80, videoRenderedFrames: 2000 });
      for (let tap = 0; tap < taps; tap++) expect(tree!.root.findByType(LandscapePlayer).props.onPlayerKey(key)).toBe(true);
      for (const fn of [...f.listeners.get('timeUpdate') ?? []]) fn({ currentTime: 80, videoRenderedFrames: 2001 });
    });
    await advance(3000); // native uret staar stadig paa den gamle position
    f.player.currentTime = target;
    await act(async () => {
      for (const fn of [...f.listeners.get('timeUpdate') ?? []]) fn({ currentTime: target, videoRenderedFrames: 2002 });
    });
    await end(0, '18:20:08.546');
    expect(f.requests[1]?.from).toEqual(at('18:01:00'));
    expect(f.loads[1]?.seek).toBe(seek);
    expect(f.loads).toHaveLength(2);
  });

  it('fortsaetter fra native slutposition ved idle uden en playToEnd-haendelse', async () => {
    await mount();
    vi.setSystemTime(at('18:36:10.171'));
    f.player.currentTime = 1020.379;
    f.player.status = 'idle'; f.player.playing = false;
    await advance(3000);
    expect(f.requests[1]).toEqual({ from: at('18:17:00'), minutes: 17 });
    expect(f.loads[1]!.seek).toBeCloseTo(0.379);
    expect(f.loads).toHaveLength(2);
  });

  it('venter paa nye arkivdata selv om native playing staar fast paa true ved EOF', async () => {
    await mount();
    await end(1020, '18:19:08.546');
    f.player.playing = true;
    // idle kan foelge uden en frisk playingChange. Uret gaar ikke frem.
    await advance(30_000);
    expect(f.requests[1]).toEqual({ from: at('18:17:00'), minutes: 1 });
    expect(f.loads).toHaveLength(2);
    expect(f.loads.map(load => load.source)).not.toContain('https://example.invalid/live.ts');
  });

  it('sidste billedhaendelse foer EOF maa ikke ligne tilbagespoling under ventning', async () => {
    await mount();
    f.player.currentTime = 1018;
    await act(async () => {
      for (const fn of [...f.listeners.get('timeUpdate') ?? []]) fn({ currentTime: 1018, videoRenderedFrames: 100 });
    });
    await end(1020, '18:19:08.546');
    f.player.playing = true;
    await advance(30_000);
    expect(f.requests[1]).toEqual({ from: at('18:17:00'), minutes: 1 });
    expect(f.loads).toHaveLength(2);
  });

  it('en idle-rest fra arkivet genoptages foerst naar boksen kommer i forgrunden', async () => {
    await mount();
    await background('background');
    vi.setSystemTime(at('18:36:10.171'));
    f.player.currentTime = 1020.379; f.player.status = 'idle'; f.player.playing = false;
    await advance(21_000);
    expect(f.loads).toHaveLength(1);
    await background('active');
    expect(f.requests[1]).toEqual({ from: at('18:17:00'), minutes: 18 });
    expect(f.loads).toHaveLength(2);
  });

  it('en pauset udsendelse maa ikke genindlaeses ved idle', async () => {
    await mount();
    await act(async () => tree!.root.findByType(LandscapePlayer).props.onPlayerKey('playPause'));
    vi.setSystemTime(at('18:36:10.171'));
    f.player.currentTime = 1020.379;
    await status('idle');
    await advance(21_000);
    expect(f.loads).toHaveLength(1);
    await act(async () => tree!.root.findByType(LandscapePlayer).props.onPlayerKey('playPause'));
    expect(f.loads).toHaveLength(2);
  });

  it('en ventetimer afbryder ikke arkivet naar nye billeder og tiden faktisk gaar frem', async () => {
    await mount();
    await end(1020, '18:19:08.546');
    f.player.playing = true; f.player.status = 'readyToPlay'; f.player.currentTime = 1025;
    await act(async () => {
      for (const fn of [...f.listeners.get('timeUpdate') ?? []]) fn({ currentTime: 1025, videoRenderedFrames: 100 });
    });
    await advance(15_000);
    expect(f.loads).toHaveLength(1);
  });

  it('fortsaetter automatisk 15 min efter EPG-slut og gaar derefter til oversigten uden slutvalg', async () => {
    await mount();
    expect(f.requests[0]).toEqual({ from: news.start, minutes: 17 });
    await end(1020.379, '18:36:10.171');
    expect(f.requests[1]).toEqual({ from: at('18:17:00'), minutes: 17 });
    expect(f.loads[1]!.seek).toBeCloseTo(0.379);
    await end(179.340, '18:39:08.451');
    expect(f.requests[2]).toEqual({ from: at('18:19:00'), minutes: 16 });
    expect(f.loads[2]!.seek).toBeCloseTo(59.34);
    // Hverken EPG-slut eller den tidligere femminutters graense maa stoppe.
    await end(359.34, '18:44:08.451');
    expect(f.back).not.toHaveBeenCalled();
    expect(f.requests[3]).toEqual({ from: at('18:24:00'), minutes: 11 });
    expect(tree!.root.findByType(LandscapePlayer).props.suspended).toBe(false);
    const texts = tree!.root.findAllByType('Text' as any).map(n => n.children.join('')).join(' ');
    expect(texts).not.toContain('Hent 5 min mere');
    expect(texts).not.toContain('Hent 15 min mere');
    expect(texts).not.toContain('Arkivstykket er slut');
    await end(659.34, '18:54:08.451');
    expect(f.back).toHaveBeenCalledTimes(1);
    expect(f.player.playing).toBe(false);
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(f.requests).toHaveLength(4);
  });

  it('genforbinder fra det seneste viste sekund efter flere arkivskift uden at aabne live', async () => {
    await mount();
    await end(1020.379, '18:36:10.171');
    await end(179.340, '18:39:08.451');
    // Tiden er lokal for det tredje stykke, som begynder kl. 18.19.
    // En fejl efter yderligere ti sekunder maa ikke starte udsendelsen om.
    await act(async () => {
      f.player.currentTime = 69.34;
      for (const fn of [...f.listeners.get('timeUpdate') ?? []]) fn({ currentTime: 69.34, videoRenderedFrames: 2000, bufferedPosition: 159.34 });
    });
    await status('error');
    await advance(1500);
    expect(f.requests[3]).toEqual({ from: at('18:20:00'), minutes: 15 });
    expect(f.loads[3]!.seek).toBeCloseTo(9.34);
    expect(f.loads.map(load => load.source)).toEqual([
      'https://example.invalid/archive/1.ts', 'https://example.invalid/archive/2.ts',
      'https://example.invalid/archive/3.ts', 'https://example.invalid/archive/4.ts',
    ]);
    expect(f.back).not.toHaveBeenCalled();
  });

  it('aabner ikke en sen arkivfortsaettelse efter brugeren er gaaet tilbage', async () => {
    await mount();
    let resolve!: (value: string) => void;
    f.setting.mockImplementation(() => new Promise<string>(done => { resolve = done; }));
    await end(1020.379, '18:36:10.171');
    await act(async () => tree!.unmount()); tree = null;
    await act(async () => resolve('php'));
    expect(f.requests).toHaveLength(1);
    expect(f.loads).toHaveLength(1);
  });
});

const mountLive = async () => act(async () => {
  tree = create(createElement(PlayerScreen, { session, channel, onBack: f.back }));
});
async function status(value: string) {
  await act(async () => {
    f.player.status = value;
    for (const fn of [...f.listeners.get('statusChange') ?? []]) fn({ status: value });
  });
}
async function background(value: string) {
  await act(async () => {
    f.appState.currentState = value;
    for (const fn of [...f.listeners.get('appState') ?? []]) fn(value);
  });
}
const advance = async (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });

describe('Live: baade lyd og billede stopper uden native fejl', () => {
  async function playNormally(seconds: number) {
    await act(async () => {
      f.player.playing = true; f.player.status = 'readyToPlay';
      for (let second = 0; second <= seconds; second += 1) {
        if (second > 0) vi.advanceTimersByTime(1000);
        f.player.currentTime = second;
        for (const fn of [...f.listeners.get('timeUpdate') ?? []]) fn({ currentTime: second });
      }
    });
  }
  async function shortEnd(seconds: number, resetNative = false) {
    await playNormally(seconds);
    await act(async () => {
      f.player.playing = false; f.player.status = 'idle';
      if (resetNative) {
        f.player.currentTime = 0;
        for (const fn of [...f.listeners.get('timeUpdate') ?? []]) fn({ currentTime: 0 });
      }
      for (const fn of [...f.listeners.get('playToEnd') ?? []]) fn(undefined);
      for (const fn of [...f.listeners.get('statusChange') ?? []]) fn({ status: 'idle' });
    });
  }
  it('TV2-loggens 48/67 sekunders TS-EOF skifter til HLS trods stabilt nulstillet genforsoegsbudget', async () => {
    await mountLive(); await shortEnd(48); await advance(1500);
    expect(f.loads.map(load => load.source)).toEqual(['https://example.invalid/live.ts', 'https://example.invalid/live.ts']);
    await shortEnd(67);
    expect(f.loads.map(load => load.source)).toEqual(['https://example.invalid/live.ts', 'https://example.invalid/live.ts', 'https://example.invalid/live.m3u8']);
    await shortEnd(77); await advance(1500);
    await shortEnd(78); await advance(10_000);
    expect(f.loads).toHaveLength(4);
    const texts = tree!.root.findAllByType('Text' as any).map(node => node.children.join('')).join(' ');
    expect(texts).toContain('Streamen kunne ikke afspilles. Prøv igen.');
    expect(f.requests).toHaveLength(0);
  });
  it('HLS der afvises efter korte TS-sessioner har fortsat et afgraenset budget uden formatcyklus', async () => {
    await mountLive(); await shortEnd(48); await advance(1500); await shortEnd(67);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await status('error'); await advance(attempt * 1500);
    }
    expect(f.loads.map(load => load.source)).toEqual([
      'https://example.invalid/live.ts', 'https://example.invalid/live.ts',
      'https://example.invalid/live.m3u8', 'https://example.invalid/live.m3u8', 'https://example.invalid/live.m3u8',
    ]);
    const texts = tree!.root.findAllByType('Text' as any).map(node => node.children.join('')).join(' ');
    expect(texts).toContain('Streamen kunne ikke afspilles. Prøv igen.');
  });
  it('skifter ogsaa til HLS naar native melder EOF ved nul efter 48/67 sekunders faktisk afspilning', async () => {
    await mountLive(); await shortEnd(48, true); await advance(1500);
    await shortEnd(67, true);
    expect(f.loads.map(load => load.source)).toEqual([
      'https://example.invalid/live.ts', 'https://example.invalid/live.ts', 'https://example.invalid/live.m3u8',
    ]);
    expect(f.requests).toHaveLength(0);
  });
  it('genforbinder efter EOF og idle, men aabner kun en forbindelse', async () => {
    await mountLive();
    await end(60, '18:20:08.546');
    await status('idle');
    await advance(1499);
    expect(f.loads).toHaveLength(1);
    await advance(1);
    expect(f.loads).toHaveLength(2);
    expect(f.loads[1]!.source).toEqual(f.loads[0]!.source);
    expect(f.back).not.toHaveBeenCalled();
  });

  it('opdager en stoppet live-afspiller selv om playing er falsk og READY gentages', async () => {
    await mountLive();
    f.player.playing = false;
    for (let i = 0; i < 7; i++) {
      await status('loading'); await advance(1500);
      await status('readyToPlay'); await advance(1500);
    }
    expect(f.loads).toHaveLength(2);
  });

  it('bevarer forbindelsen naar native uret gaar frem uden JS-timeUpdate', async () => {
    await mountLive();
    for (let i = 0; i < 12; i++) {
      f.player.currentTime += 3;
      await advance(3000);
    }
    expect(f.loads).toHaveLength(1);
  });

  it('opdager idle uden nogen EOF- eller status-haendelse', async () => {
    await mountLive();
    f.player.status = 'idle'; f.player.playing = false;
    await advance(19_500);
    expect(f.loads).toHaveLength(2);
  });

  it('respekterer pause og genforbinder foerst naar brugeren trykker afspil igen', async () => {
    await mountLive();
    await act(async () => tree!.root.findByType(LandscapePlayer).props.onPlayerKey('playPause'));
    await end(60, '18:20:08.546'); await status('idle');
    await advance(30_000);
    expect(f.loads).toHaveLength(1);
    await act(async () => tree!.root.findByType(LandscapePlayer).props.onPlayerKey('playPause'));
    await advance(1500);
    expect(f.loads).toHaveLength(2);
  });

  it('annullerer genforsoeg i baggrunden og opdager idle igen i forgrunden', async () => {
    await mountLive();
    await end(60, '18:20:08.546');
    await background('background');
    await advance(30_000);
    expect(f.loads).toHaveLength(1);
    await background('active');
    await advance(3000);
    expect(f.loads).toHaveLength(2);
  });

  it('annullerer et planlagt live-genforsoeg naar skaermen lukkes', async () => {
    await mountLive(); await end(60, '18:20:08.546');
    await act(async () => tree!.unmount()); tree = null;
    await advance(30_000);
    expect(f.loads).toHaveLength(1);
  });

  it('afslutter efter to tomme genforsoeg pr format uden at READY giver nyt budget', async () => {
    await mountLive();
    for (let i = 0; i < 6; i++) {
      await end(0, '18:20:08.546');
      await advance(((i % 3) + 1) * 1500);
      await status('readyToPlay');
    }
    expect(f.loads).toHaveLength(6);
    const texts = tree!.root.findAllByType('Text' as any).map(n => n.children.join('')).join(' ');
    expect(texts).toContain('Streamen kunne ikke afspilles. Prøv igen.');
  });
});
