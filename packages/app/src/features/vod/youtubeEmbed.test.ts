import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { trailerCommandScript, youtubeEmbedPage, youtubeEmbedNavigationAllowed, YoutubePlaybackWatch, YOUTUBE_EMBED_ORIGIN } from './youtubeEmbed.js';

/** Koer den faktiske HTML-bro med en kontrolleret IFrame-afspiller. */
function embedded() {
  const messages: Array<Record<string, unknown>> = [];
  const calls: string[] = [];
  let state = -1;
  let position = 0;
  let events: Record<string, (event: { target?: unknown; data?: unknown }) => void> = {};
  const player = {
    getPlayerState: () => state, getCurrentTime: () => position,
    getDuration: () => 160, getVideoLoadedFraction: () => 0.5,
    playVideo: () => calls.push('play'), pauseVideo: () => calls.push('pause'),
    seekTo: (at: number) => { position = at; calls.push(`seek:${at}`); },
    destroy: () => calls.push('destroy'),
  };
  const window: Record<string, unknown> = {
    ReactNativeWebView: { postMessage: (value: string) => messages.push(JSON.parse(value)) },
    addEventListener: () => undefined,
  };
  const context = {
    window,
    YT: { Player: function (_id: string, config: { events: typeof events }) { events = config.events; return player; } },
    setInterval: () => 1, setTimeout: () => 1, clearInterval: () => undefined, clearTimeout: () => undefined,
  };
  const html = youtubeEmbedPage('aaaaaaaaaaa', true, 45, 1);
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
  runInNewContext(script, context);
  (window.onYouTubeIframeAPIReady as () => void)();
  return { context, messages, calls, player, events, playAt: (at: number, next = 1) => { state = next; position = at; events.onStateChange?.({ data: next }); } };
}

describe('YouTubes indlejrede afspiller', () => {
  it('starter uden den gamle pause/spol-loekke, og melder kun faktisk status', () => {
    const bridge = embedded();
    bridge.events.onReady?.({ target: bridge.player });
    expect(bridge.calls).toEqual(['play']);
    expect(bridge.messages.some((m) => m.type === 'playing')).toBe(false);
    bridge.playAt(46);
    expect(bridge.messages.at(-1)).toMatchObject({ type: 'status', state: 1, position: 46, seconds: 160, attempt: 1 });
  });

  it('afspil, pause og spoling styres i appen; sluttid klemmes inden for videoen', () => {
    const bridge = embedded();
    bridge.playAt(155);
    runInNewContext(trailerCommandScript('forward'), bridge.context);
    runInNewContext(trailerCommandScript('toggle'), bridge.context);
    expect(bridge.calls).toEqual(['seek:159', 'pause']);
    bridge.playAt(2, 2);
    runInNewContext(trailerCommandScript('backward'), bridge.context);
    runInNewContext(trailerCommandScript('toggle'), bridge.context);
    expect(bridge.calls.slice(-2)).toEqual(['seek:0', 'play']);
  });

  it('melder slutningen én gang og videresender afvisning/autoplay', () => {
    const bridge = embedded();
    bridge.playAt(160, 0); bridge.playAt(160, 0);
    bridge.events.onError?.({ data: 150 });
    bridge.events.onAutoplayBlocked?.({});
    expect(bridge.messages.filter((m) => m.type === 'ended')).toHaveLength(1);
    expect(bridge.messages).toContainEqual({ type: 'error', code: 150, attempt: 1 });
    expect(bridge.messages).toContainEqual({ type: 'autoplay-blocked', attempt: 1 });
  });

  it('har korrekt app-identitet og afviser id-injektion', () => {
    expect(youtubeEmbedPage('aaaaaaaaaaa', true, 50)).toContain(`origin:'${YOUTUBE_EMBED_ORIGIN}'`);
    expect(() => youtubeEmbedPage("x';alert(1)", true)).toThrow();
  });
});

describe('YoutubePlaybackWatch', () => {
  it('opdager frost ved 55 s selv med status spiller', () => {
    const watch = new YoutubePlaybackWatch(0);
    watch.update({ state: 1, position: 55, seconds: 160 }, 55_000);
    watch.update({ state: 1, position: 55, seconds: 160 }, 65_000);
    expect(watch.problem(69_999)).toBeNull();
    expect(watch.problem(70_000)).toBe('stall');
    expect(watch.position).toBe(55);
  });

  it('rammer ikke en lang bruger-pause og giver ny tid efter genoptagelse', () => {
    const watch = new YoutubePlaybackWatch(0);
    watch.update({ state: 1, position: 20, seconds: 160 }, 20_000);
    watch.update({ state: 2, position: 20, seconds: 160 }, 21_000);
    expect(watch.problem(300_000)).toBeNull();
    watch.update({ state: 2, position: 20, seconds: 160 }, 300_000);
    watch.update({ state: 1, position: 20, seconds: 160 }, 301_000);
    expect(watch.problem(302_000)).toBeNull();
  });

  it('opdager buffer-stop, tidlig slutning og manglende opstart', () => {
    const watch = new YoutubePlaybackWatch(0);
    expect(watch.problem(20_000)).toBe('start-timeout');
    watch.update({ state: 1, position: 45, seconds: 160 }, 45_000);
    watch.update({ state: 3, position: 45, seconds: 160 }, 46_000);
    expect(watch.problem(60_000)).toBe('stall');
    watch.update({ state: 0, position: 55, seconds: 160 }, 61_000);
    expect(watch.problem(61_000)).toBe('early-end');
    watch.update({ state: 0, position: 159, seconds: 160 }, 62_000);
    expect(watch.problem(62_000)).toBeNull();
  });
});

describe('embedded navigation on Android', () => {
  it('allows the iframe without relying on the iOS isTopFrame field', () => {
    expect(youtubeEmbedNavigationAllowed('https://www.youtube.com/embed/uYPbbksJxIg?autoplay=1')).toBe(true);
    expect(youtubeEmbedNavigationAllowed(YOUTUBE_EMBED_ORIGIN)).toBe(true);
  });
  it('blocks logo links and navigation out of the app player', () => {
    expect(youtubeEmbedNavigationAllowed('https://www.youtube.com/watch?v=uYPbbksJxIg')).toBe(false);
    expect(youtubeEmbedNavigationAllowed('https://dk.seomidt.norstream.attacker.test/')).toBe(false);
    expect(youtubeEmbedNavigationAllowed('intent://youtube/')).toBe(false);
  });
});
