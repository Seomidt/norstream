import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

it('Android-patchen bevarer upstream-fejltekst, er idempotent og afviser ukendt native kode', async () => {
  const require = createRequire(import.meta.url);
  const file = require.resolve('expo-video/package.json').replace('package.json', 'android/src/main/java/expo/modules/video/records/PlaybackError.kt');
  const source = readFileSync(file, 'utf8');
  const { patchPlaybackError } = await import('../../../../../scripts/patch-video-errors.mjs');
  const patched = patchPlaybackError(source) as string;
  expect(patchPlaybackError(patched)).toBe(patched);
  expect(patched).toContain('@Field var errorCode: Int? = null');
  expect(patched).toContain('exception.errorCode');
  expect(patched).toContain('ExoPlaybackException)?.type');
  expect(patched).toContain('A playback exception has occurred: $reason');
  expect(() => patchPlaybackError(source + '// ukendt aendring')).toThrow('Ukendt expo-video');
});
