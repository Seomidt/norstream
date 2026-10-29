import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { TV_CODEC_OPTIONS, netSummary, videoFrameSummary } from './tvCodec.js';

it('bevarer samme TV-builderprofil gennem arkivskift', () => {
  expect(Object.isFrozen(TV_CODEC_OPTIONS)).toBe(true);
  const screen = readFileSync(new URL('./PlayerScreen.tsx', import.meta.url), 'utf8');
  expect(screen).toContain('}, isTV ? (uniformAudio ? TV_UNIFORM_AUDIO_OPTIONS : TV_CODEC_OPTIONS) : undefined);');
  expect(screen.match(/useVideoPlayer\(/g)).toHaveLength(1);
  expect(screen).toContain('useVideoPlayer(null,');
  const trailer = readFileSync(new URL('../vod/TrailerScreen.tsx', import.meta.url), 'utf8');
  expect(trailer).not.toContain('TV_CODEC_OPTIONS');
});

it('native patch er installeret, idempotent, reversibel og afviser versioner den ikke kender', async () => {
  const require = createRequire(import.meta.url);
  const root = require.resolve('expo-video/package.json').replace('package.json', 'android/src/main/java/expo/modules/video/');
  const { patchTvCodec } = await import('../../../../../scripts/patch-tv-codec.mjs');
  for (const path of ['player/VideoPlayer.kt', 'records/PlayerBuilderOptions.kt', 'records/VideoEventPayloads.kt']) {
    const installed = readFileSync(root + path, 'utf8');
    expect(patchTvCodec(path, installed)).toBe(installed);
    expect(() => patchTvCodec(path, installed + '// ny upstream')).toThrow('Ukendt expo-video');
  }
  const player = readFileSync(root + 'player/VideoPlayer.kt', 'utf8');
  expect(player).toContain('if (playerBuilderOptions?.norstreamSynchronousCodec == true)');
  expect(player).toContain('forceDisableMediaCodecAsynchronousQueueing()');
  expect(player).toContain('} else {\n        forceEnableMediaCodecAsynchronousQueueing()');
  expect(player).toContain('counters.ensureUpdated()');
  // v424: taellere og netvaerkstal paa alle Android-afspillere, ikke kun TV-profilen.
  expect(player).not.toContain('if (norstreamCodecOptions?.norstreamSynchronousCodec == true)');
  expect(player).toContain('updatePayload.nativeBufferedPosition =');
  expect(player).toContain('override fun onLoadCompleted(');
  expect(player).toContain('override fun onLoadError(');
  expect(player).toContain('norstreamNet.failed(loadEventInfo, error)');
  expect(player).not.toContain('loadEventInfo.uri');
  const payloads = readFileSync(root + 'records/VideoEventPayloads.kt', 'utf8');
  expect(payloads).toContain('@Field var netLastHttpStatus: Int? = null');
});

it('skelner videobilleder fra lyduret og godkender aldrig manglende eller ugyldige native taellere', () => {
  expect(videoFrameSummary({ videoQueuedFrames: 3400, videoRenderedFrames: 2700, videoDroppedFrames: 700, bufferedPosition: 201 }, 110.268))
    .toBe('video-sync v381: ved 110.268 s; ind 3400, vist 2700, tabt 700; buffer til 201 s');
  expect(videoFrameSummary({}, 120)).toBeNull();
  for (const bad of [null, -1, NaN, Infinity, 1.5, 2_147_483_648]) {
    expect(videoFrameSummary({ videoQueuedFrames: bad, videoRenderedFrames: 0, videoDroppedFrames: 0 }, 120)).toBeNull();
  }
  expect(videoFrameSummary({ videoQueuedFrames: 0, videoRenderedFrames: 0, videoDroppedFrames: 0 }, NaN)).toBeNull();
  expect(videoFrameSummary({ videoQueuedFrames: 0, videoRenderedFrames: 0, videoDroppedFrames: 0 }, 0)).toContain('vist 0');
});

it('netvaerkstal som tal uden adresser, ogsaa naar native endnu intet har sendt (v424)', () => {
  expect(netSummary(null, 10)).toBe('net: ingen native tal endnu');
  expect(netSummary({ netLoads: 3, netErrors: 1, netLastKilobytes: 5120.4, netLastDurationMs: 48210, netLastHttpStatus: 200, netLastLengthKnown: false, nativeBufferedPosition: 67.3 }, 60.1))
    .toBe('net v424: indlaesninger 3, fejl 1; sidste 5120 kB paa 48210 ms, http 200, laengde kendt nej; native buffer foran 7.2 s');
  expect(netSummary({ netLastHttpStatus: 403 }, 60)).toContain('http 403, laengde kendt ?; native buffer foran ? s');
  expect(netSummary({ nativeBufferedPosition: 10 }, 60)).toContain('native buffer foran 0.0 s');
});
