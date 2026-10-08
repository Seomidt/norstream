import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VideoSource } from 'expo-video';
import { ARCHIVE_BUFFER, LIVE_BUFFER, PlaybackConnection } from './playbackConnection.js';
import type { PlaybackPort } from './playbackConnection.js';

function fixture() {
  const calls: string[] = [];
  const pending: Array<{ resolve: () => void; reject: () => void }> = [];
  const player: PlaybackPort = {
    currentTime: 0,
    bufferOptions: LIVE_BUFFER,
    pause: () => { calls.push('pause'); },
    play: () => { calls.push(`play@${player.currentTime}`); },
    replaceAsync: (source: VideoSource) => {
      calls.push(`replace:${typeof source === 'string' ? source : 'object'}`);
      player.currentTime = 0;
      return new Promise<void>((resolve, reject) => pending.push({ resolve, reject: () => reject(new Error('offline')) }));
    },
  };
  return { player, calls, pending, connection: new PlaybackConnection(player) };
}

describe('PlaybackConnection', () => {
  afterEach(() => vi.useRealTimers());

  it('venter paa den nye kildes metadata OG buffer foer et seek, som ellers ignoreres', async () => {
    const f = fixture();
    let nativeReady = false;
    let actual = 0;
    const seeks: number[] = [];
    Object.defineProperty(f.player, 'currentTime', {
      get: () => actual,
      set: (time: number) => {
        if (time > 0) seeks.push(time);
        actual = nativeReady ? time : 0;
      },
    });
    const loaded = f.connection.load('next-archive.ts', true, 56);
    await Promise.resolve();
    f.pending[0]!.resolve();
    await Promise.resolve(); await Promise.resolve();
    expect(seeks).toEqual([]);
    f.connection.sourceLoaded('next-archive.ts');
    expect(seeks).toEqual([]);
    nativeReady = true;
    f.connection.status('readyToPlay');
    expect(seeks).toEqual([56]);
    expect(f.connection.position(0)).toBe(false);
    expect(f.connection.position(56)).toBe(true);
    expect(f.calls.at(-1)).toBe('play@56');
    await loaded;
  });

  it('afviser en ny kilde uden metadata og READY efter en afgraenset ventetid', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const loaded = f.connection.load('next-archive.ts', true, 56);
    const rejected = expect(loaded).rejects.toThrow('preparation-timeout');
    await Promise.resolve();
    f.pending[0]!.resolve();
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    // Sen klargoering maa ikke starte det stykke der allerede er opgivet.
    f.connection.sourceLoaded('next-archive.ts');
    f.connection.status('readyToPlay');
    expect(f.connection.position(56)).toBe(false);
    expect(f.calls.filter((c) => c.startsWith('play@'))).toHaveLength(0);
  });

  it('aabner kilden én gang og spoler foer afspilning, ogsaa naar ready kom foerst', async () => {
    const f = fixture();
    const loaded = f.connection.load('archive.ts', true, 42);
    await Promise.resolve();
    f.connection.status('readyToPlay');
    expect(f.connection.position(900)).toBe(false); // gammel kilde
    expect(f.connection.sourceLoaded('old-live.ts')).toBe(false);
    expect(f.connection.committed).toBe(false);
    expect(f.connection.sourceLoaded({ uri: 'archive.ts' })).toBe(true);
    f.pending[0]!.resolve();
    await Promise.resolve(); await Promise.resolve();
    expect(f.calls).toEqual(['pause', 'replace:archive.ts']);
    expect(f.player.bufferOptions).toEqual(ARCHIVE_BUFFER);
    expect(f.connection.position(0)).toBe(false);
    expect(f.connection.active).toBe(false);
    expect(f.connection.position(42.1)).toBe(true);
    await loaded;
    expect(f.calls).toEqual(['pause', 'replace:archive.ts', 'play@42']);
    expect(f.connection.active).toBe(true);
    // Klargoerings- og bufferhaendelser maa ikke genindlaese kilden.
    f.connection.status('loading');
    f.connection.status('readyToPlay');
    for (let n = 43; n < 140; n += 1) {
      f.player.currentTime = n;
      expect(f.connection.position(n)).toBe(true);
    }
    expect(f.calls.filter((c) => c.startsWith('replace:'))).toHaveLength(1);
  });

  it('serialiserer asynkrone kildeskift og starter kun den seneste kanal', async () => {
    const f = fixture();
    const first = f.connection.load('first.ts', false);
    await Promise.resolve();
    const second = f.connection.load('second.ts', false);
    const third = f.connection.load('third.ts', false);
    await Promise.resolve();
    expect(f.pending).toHaveLength(1);
    f.pending[0]!.resolve();
    await first;
    await second;
    await Promise.resolve();
    expect(f.pending).toHaveLength(2);
    expect(f.calls).toEqual(['pause', 'replace:first.ts', 'pause', 'replace:third.ts']);
    f.pending[1]!.resolve();
    f.connection.sourceLoaded('third.ts');
    f.connection.status('readyToPlay');
    await third;
    expect(f.calls.at(-1)).toBe('play@0');
    expect(f.player.bufferOptions).toEqual(LIVE_BUFFER);
  });

  it('genindlaeser den samme URL med sin nye spoletid, uden en anden afspiller', async () => {
    const f = fixture();
    for (const seek of [0, 42, 59]) {
      const loaded = f.connection.load('same.ts', true, seek);
      await Promise.resolve();
      // Gammel tid kan ikke bekraefte det nye seek.
      expect(f.connection.position(42)).toBe(false);
      f.pending.at(-1)!.resolve();
      f.connection.sourceLoaded('same.ts');
      f.connection.status('readyToPlay');
      await Promise.resolve(); await Promise.resolve();
      expect(f.connection.position(seek)).toBe(true);
      await loaded;
    }
    expect(f.calls.filter((c) => c.startsWith('replace:'))).toHaveLength(3);
    expect(f.calls.filter((c) => c.startsWith('play@'))).toEqual(['play@0', 'play@42', 'play@59']);
  });

  it('Tilbage under indlaesning afviser sen metadata og starter ingen stream', async () => {
    const f = fixture();
    const loaded = f.connection.load('archive.ts', true, 17);
    await Promise.resolve();
    f.connection.dispose();
    f.pending[0]!.resolve();
    await loaded;
    f.connection.sourceLoaded('archive.ts');
    f.connection.status('readyToPlay');
    expect(f.connection.position(17)).toBe(false);
    expect(f.calls).toEqual(['pause', 'replace:archive.ts']);
  });

  it('effect-cleanup afviser gammel indlaesning men tillader Reacts kontrol-mount', async () => {
    const f = fixture();
    const old = f.connection.load('live.ts', false);
    await Promise.resolve();
    f.connection.cancel();
    const fresh = f.connection.load('live.ts', false);
    f.pending[0]!.resolve();
    await old;
    await Promise.resolve();
    f.pending[1]!.resolve();
    f.connection.sourceLoaded('live.ts');
    f.connection.status('readyToPlay');
    await fresh;
    expect(f.calls.filter((c) => c.startsWith('play@'))).toEqual(['play@0']);
  });

  it('et fejlet replace forgifter ikke koeen til naeste genforsoeg', async () => {
    const f = fixture();
    const old = f.connection.load('offline.ts', true);
    await Promise.resolve();
    const rejected = expect(old).rejects.toThrow('offline');
    f.pending[0]!.reject();
    await rejected;
    const retry = f.connection.load('online.ts', true);
    await Promise.resolve();
    f.pending[1]!.resolve();
    f.connection.sourceLoaded('online.ts');
    f.connection.status('readyToPlay');
    await retry;
    expect(f.calls.at(-1)).toBe('play@0');
  });

  it('en genindlaesning kan bevare pause uden automatisk at starte', async () => {
    const f = fixture();
    const loaded = f.connection.load('archive.ts', true, 320, false);
    await Promise.resolve();
    f.pending[0]!.resolve();
    await Promise.resolve();
    expect(f.player.currentTime).toBe(0);
    f.connection.sourceLoaded('archive.ts');
    f.connection.status('readyToPlay');
    await Promise.resolve(); await Promise.resolve();
    expect(f.player.currentTime).toBe(320);
    expect(f.connection.position(320)).toBe(true);
    await loaded;
    expect(f.calls.filter((c) => c.startsWith('play@'))).toHaveLength(0);
  });

  it('en pause valgt mens kilden indlaeses overskrives ikke af det sene promise', async () => {
    const f = fixture();
    const loaded = f.connection.load('archive.ts', true, 320);
    await Promise.resolve();
    f.connection.setPlayingIntent(false);
    f.pending[0]!.resolve();
    f.connection.sourceLoaded('archive.ts');
    f.connection.status('readyToPlay');
    await Promise.resolve(); await Promise.resolve();
    expect(f.player.currentTime).toBe(320);
    expect(f.connection.position(320)).toBe(true);
    await loaded;
    expect(f.calls.filter((c) => c.startsWith('play@'))).toHaveLength(0);
  });

  it('spiller ingen gamle sekunder naar en TS-kilde ignorerer seek; en seekbar kilde kan genoptage', async () => {
    const f = fixture();
    let actual = 0;
    let seekable = false;
    Object.defineProperty(f.player, 'currentTime', {
      get: () => actual,
      set: (time: number) => { actual = seekable ? time : 0; },
    });
    const ts = f.connection.load('archive.ts', true, 42);
    await Promise.resolve(); f.pending[0]!.resolve();
    f.connection.sourceLoaded('archive.ts');
    f.connection.status('readyToPlay');
    await Promise.resolve(); await Promise.resolve();
    expect(f.connection.position(0)).toBe(false);
    expect(f.connection.active).toBe(false);
    expect(f.calls.filter((c) => c.startsWith('play@'))).toHaveLength(0);
    seekable = true;
    const hls = f.connection.load('archive.m3u8', true, 42);
    await ts; await Promise.resolve();
    f.pending[1]!.resolve();
    expect(f.calls.filter((c) => c.startsWith('play@'))).toHaveLength(0);
    f.connection.sourceLoaded('archive.m3u8');
    f.connection.status('readyToPlay');
    await ts; // forladt kilde annulleres ved load af HLS
    await Promise.resolve(); await Promise.resolve();
    expect(f.connection.position(42)).toBe(true);
    await hls;
    expect(f.calls.filter((c) => c.startsWith('play@'))).toEqual(['play@42']);
  });

  it.each([
    ['replace', 'metadata', 'ready'], ['replace', 'ready', 'metadata'],
    ['metadata', 'replace', 'ready'], ['metadata', 'ready', 'replace'],
    ['ready', 'replace', 'metadata'], ['ready', 'metadata', 'replace'],
  ])('accepterer native haendelser i raekkefoelgen %s, %s, %s uden et tidligt seek', async (...order) => {
    const f = fixture();
    const loaded = f.connection.load('next.ts', true, 56);
    await Promise.resolve();
    for (const [index, event] of order.entries()) {
      if (event === 'replace') f.pending[0]!.resolve();
      if (event === 'metadata') f.connection.sourceLoaded('next.ts');
      if (event === 'ready') f.connection.status('readyToPlay');
      await Promise.resolve();
      if (index < 2) {
        expect(f.player.currentTime).toBe(0);
        expect(f.connection.active).toBe(false);
      }
    }
    await Promise.resolve(); await Promise.resolve();
    expect(f.player.currentTime).toBe(56);
    f.connection.status('loading'); // seek henter sin nye buffer
    expect(f.connection.position(56)).toBe(false);
    f.connection.status('readyToPlay');
    expect(f.connection.position(56)).toBe(true);
    await loaded;
    f.player.currentTime = 57;
    f.connection.status('readyToPlay');
    f.connection.sourceLoaded('next.ts');
    expect(f.player.currentTime).toBe(57); // ingen gentagen spoling
    expect(f.calls.filter((c) => c.startsWith('play@'))).toEqual(['play@56']);
  });

  it('venter ikke paa en forladt kildes metadata foer et nyt zap', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const old = f.connection.load('old.ts', true, 56);
    await Promise.resolve(); f.pending[0]!.resolve();
    await Promise.resolve();
    f.connection.cancel();
    const fresh = f.connection.load('new.ts', false);
    await old;
    await Promise.resolve();
    f.connection.sourceLoaded('old.ts');
    f.connection.status('readyToPlay');
    expect(f.connection.committed).toBe(false);
    f.pending[1]!.resolve();
    f.connection.sourceLoaded('new.ts');
    await fresh;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.calls.filter((c) => c.startsWith('play@'))).toEqual(['play@0']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('et kast fra native seek afvises som et load-problem uden at kaste i haendelseslytteren', async () => {
    const f = fixture();
    Object.defineProperty(f.player, 'currentTime', {
      get: () => 0,
      set: (time: number) => { if (time > 0) throw new Error('native-seek-failed'); },
    });
    const loaded = f.connection.load('next.ts', true, 56);
    const rejected = expect(loaded).rejects.toThrow('native-seek-failed');
    await Promise.resolve(); f.pending[0]!.resolve();
    f.connection.sourceLoaded('next.ts');
    expect(() => f.connection.status('readyToPlay')).not.toThrow();
    await rejected;
    expect(f.connection.position(56)).toBe(false);
    expect(f.calls.filter((c) => c.startsWith('play@'))).toHaveLength(0);
  });

  it('afviser en native fejl under metadata straks, saa changingSource ikke skjuler den', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const loaded = f.connection.load('next.ts', true, 56);
    const rejected = expect(loaded).rejects.toThrow('native-preparation-error');
    await Promise.resolve(); f.pending[0]!.resolve();
    f.connection.status('error');
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    expect(f.calls.filter((c) => c.startsWith('play@'))).toHaveLength(0);
  });

  it('en kilde der naaede metadata men aldrig buffer READY har samme deadline', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const loaded = f.connection.load('next.ts', true, 56);
    const rejected = expect(loaded).rejects.toThrow('preparation-timeout:buffer');
    await Promise.resolve(); f.pending[0]!.resolve();
    f.connection.sourceLoaded('next.ts');
    f.connection.status('loading');
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(f.player.currentTime).toBe(0);
  });

  it('tillader et genforsoeg efter metadata-timeout uden at vente paa gamle metadata', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const old = f.connection.load('stuck.ts', true, 56);
    const rejected = expect(old).rejects.toThrow('preparation-timeout:metadata');
    await Promise.resolve(); f.pending[0]!.resolve();
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    const fresh = f.connection.load('retry.ts', true, 56);
    await Promise.resolve(); f.pending[1]!.resolve();
    f.connection.sourceLoaded('retry.ts');
    f.connection.status('readyToPlay');
    await Promise.resolve(); await Promise.resolve();
    expect(f.connection.position(56)).toBe(true);
    await fresh;
    expect(f.calls.filter((c) => c.startsWith('play@'))).toEqual(['play@56']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('afgraenser ogsaa et haengt replace uden at aabne to native forbindelser', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const old = f.connection.load('stuck.ts', true, 56);
    const rejected = expect(old).rejects.toThrow('preparation-timeout:kildeskift');
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    const fresh = f.connection.load('retry.ts', true, 56);
    await Promise.resolve();
    expect(f.pending).toHaveLength(1); // gammel replace er endnu ikke lukket
    f.pending[0]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.pending).toHaveLength(2);
    expect(f.connection.sourceLoaded('stuck.ts')).toBe(false);
    f.pending[1]!.resolve();
    f.connection.sourceLoaded('retry.ts');
    f.connection.status('readyToPlay');
    await Promise.resolve(); await Promise.resolve();
    expect(f.connection.position(56)).toBe(true);
    await fresh;
    expect(f.calls.filter((c) => c.startsWith('play@'))).toEqual(['play@56']);
  });

  it('aabner ikke et allerede udloebet genforsoeg naar det gamle replace endelig afsluttes', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const old = f.connection.load('stuck.ts', true, 56);
    const oldRejected = expect(old).rejects.toThrow('preparation-timeout');
    await vi.advanceTimersByTimeAsync(30_000);
    await oldRejected;
    const retry = f.connection.load('retry.ts', true, 56);
    const retryRejected = expect(retry).rejects.toThrow('preparation-timeout');
    await vi.advanceTimersByTimeAsync(30_000);
    await retryRejected;
    f.pending[0]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.pending).toHaveLength(1);
    expect(f.calls.filter((c) => c.startsWith('replace:'))).toEqual(['replace:stuck.ts']);
    expect(f.calls.filter((c) => c.startsWith('play@'))).toHaveLength(0);
  });
  it('venter paa 16 s seek-buffer fra v379-loggen uden at bruge retry efter 8 s', async () => {
    vi.useFakeTimers();
    const f = fixture();
    let completed = false;
    const loaded = f.connection.load('retry.ts', true, 50.268).then(() => { completed = true; });
    await Promise.resolve(); f.pending[0]!.resolve();
    f.connection.sourceLoaded('retry.ts');
    f.connection.status('readyToPlay');
    await vi.advanceTimersByTimeAsync(0);
    f.connection.status('loading');
    await vi.advanceTimersByTimeAsync(16_000);
    expect(completed).toBe(false);
    expect(f.calls.filter((c) => c.startsWith('play@'))).toHaveLength(0);
    expect(f.connection.position(50.268)).toBe(false);
    f.connection.status('readyToPlay');
    expect(f.connection.position(50.268)).toBe(true);
    await loaded;
    expect(f.calls.filter((c) => c.startsWith('replace:'))).toHaveLength(1);
    expect(f.calls.at(-1)).toBe('play@50.268');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gentagne READY for et ignoreret seek forlaenger ikke deadlinen og sen READY starter ikke', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const loaded = f.connection.load('unseekable.ts', true, 50.268);
    const rejected = expect(loaded).rejects.toThrow('preparation-timeout:spoling');
    await Promise.resolve(); f.pending[0]!.resolve();
    f.connection.sourceLoaded('unseekable.ts');
    f.connection.status('readyToPlay');
    for (let n = 0; n < 3; n += 1) {
      await vi.advanceTimersByTimeAsync(9000);
      f.connection.status('readyToPlay');
      f.player.currentTime = 0;
      expect(f.connection.position(0)).toBe(false);
    }
    await vi.advanceTimersByTimeAsync(3000);
    await rejected;
    f.player.currentTime = 50.268;
    f.connection.status('readyToPlay');
    expect(f.connection.position(50.268)).toBe(false);
    expect(f.calls.filter((c) => c.startsWith('play@'))).toHaveLength(0);
  });

});
