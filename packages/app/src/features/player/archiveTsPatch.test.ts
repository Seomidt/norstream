import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

it('installerer afgraenset sekventiel TS-patch og afviser ukendte native versioner', async () => {
  const require = createRequire(import.meta.url);
  const path = require.resolve('expo-video/package.json').replace('package.json', 'android/src/main/java/expo/modules/video/utils/DataSourceUtils.kt');
  const { patchArchiveTs } = await import('../../../../../scripts/patch-archive-ts.mjs');
  const installed = readFileSync(path, 'utf8');
  expect(patchArchiveTs(installed)).toBe(installed);
  expect(() => patchArchiveTs(installed + '// upstream')).toThrow('Ukendt expo-video');
  expect(installed).toContain('upstream.open(dataSpec)');
  expect(installed).toContain('C.LENGTH_UNSET.toLong()');
  expect(installed).toContain('!path.endsWith(".m3u8")');
  expect(installed).toContain('else dataSourceFactory');
  expect(installed).toContain('extractor.underlyingImplementation !is androidx.media3.extractor.ts.TsExtractor');
  expect(installed).toContain('androidx.media3.extractor.SeekPoint.START');
  expect(installed).toContain('override fun getDurationUs() = seekMap.durationUs');
  expect(installed).toContain('extractor.seek(position, if (position == 0L) 0L else timeUs)');
});
