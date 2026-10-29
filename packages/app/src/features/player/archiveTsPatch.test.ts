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
  expect(installed).toContain('override fun getDurationUs() = if (finalDurationUs != androidx.media3.common.C.TIME_UNSET) finalDurationUs');
  expect(installed).toContain('else if (archiveDurationUs == androidx.media3.common.C.TIME_UNSET) seekMap.durationUs else archiveDurationUs');
  expect(installed).toContain('result == androidx.media3.extractor.Extractor.RESULT_END_OF_INPUT');
  expect(installed).toContain('largestSampleTimeUs = maxOf(largestSampleTimeUs, timeUs)');
  expect(installed).toContain('largestSampleTimeUs + 10_000L');
  expect(installed).toContain('latestSeekMap?.let { finalOutput?.seekMap(it) }');
  expect(installed).toContain('uri.getQueryParameter("duration")');
  expect(installed).toContain('segments.indexOf("timeshift")');
  expect(installed).toContain('(it * 60L + 5L) * 1_000_000L');
  expect(installed).toContain('extractor.seek(position, if (position == 0L) 0L else timeUs)');
});
