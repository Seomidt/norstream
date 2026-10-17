import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { TV_CODEC_OPTIONS, videoFrameSummary } from './tvCodec.js';

it('bevarer samme TV-builderprofil gennem arkivskift', () => {
  expect(Object.isFrozen(TV_CODEC_OPTIONS)).toBe(true);
  const screen = readFileSync(new URL('./PlayerScreen.tsx', import.meta.url), 'utf8');
  expect(screen).toContain('}, isTV ? TV_CODEC_OPTIONS : undefined);');
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
  expect(player).toContain('if (norstreamCodecOptions?.norstreamSynchronousCodec == true)');
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
