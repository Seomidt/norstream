import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const before = "  val mediaSourceFactory = buildMediaSourceFactory(context, dataSourceFactory)";
const previousAfter = "  // Arkiv-TS er sammenfoejede optagelser: PCR i filens ende kan ikke bruges\n  // som en paalidelig varighed/byte-seek-map. Laes sekventielt; bevar HTTP-\n  // genoptagelse ved netfejl, men skjul fil-laengden for TS-extractoren.\n  val path = videoSource.uri?.path.orEmpty()\n  val archiveTs = path.endsWith(\"/timeshift.php\") ||\n    (path.contains(\"/timeshift/\") && !path.endsWith(\".m3u8\"))\n  val sequentialFactory = if (archiveTs) {\n    DataSource.Factory {\n      val upstream = dataSourceFactory.createDataSource()\n      object : DataSource by upstream {\n        override fun open(dataSpec: androidx.media3.datasource.DataSpec): Long {\n          upstream.open(dataSpec)\n          return androidx.media3.common.C.LENGTH_UNSET.toLong()\n        }\n      }\n    }\n  } else dataSourceFactory\n  val mediaSourceFactory = buildMediaSourceFactory(context, sequentialFactory)";
const v419After = previousAfter.replace(
  '  val mediaSourceFactory = buildMediaSourceFactory(context, sequentialFactory)',
  `  // Et arkiv har et fast minut-vindue. Spoel i sample-koeerne, og hvis
  // overlap ikke er indlaest endnu, genlaes fra byte 0 og kasser samples
  // indtil maal-tiden. Brug aldrig PCR-baserede byte-positioner.
  val mediaSourceFactory = if (archiveTs) {
    val defaults = androidx.media3.extractor.DefaultExtractorsFactory()
    fun wrap(extractors: Array<androidx.media3.extractor.Extractor>) = extractors.map { extractor ->
      if (extractor.underlyingImplementation !is androidx.media3.extractor.ts.TsExtractor) extractor
      else object : androidx.media3.extractor.Extractor by extractor {
        override fun init(output: androidx.media3.extractor.ExtractorOutput) {
          extractor.init(object : androidx.media3.extractor.ExtractorOutput by output {
            override fun seekMap(seekMap: androidx.media3.extractor.SeekMap) {
              output.seekMap(object : androidx.media3.extractor.SeekMap {
                override fun isSeekable() = true
                override fun getDurationUs() = seekMap.durationUs
                override fun getSeekPoints(timeUs: Long) = androidx.media3.extractor.SeekMap.SeekPoints(
                  androidx.media3.extractor.SeekPoint.START
                )
              })
            }
          })
        }
        override fun seek(position: Long, timeUs: Long) {
          // Byte 0 indeholder stadig begyndelsen, og maa ikke omdoebes til
          // maal-tiden af TsExtractor's timestampAdjuster ved genlaesning.
          extractor.seek(position, if (position == 0L) 0L else timeUs)
        }
      }
    }.toTypedArray()
    val extractors = object : androidx.media3.extractor.ExtractorsFactory by defaults {
      override fun createExtractors() = wrap(defaults.createExtractors())
      override fun createExtractors(uri: android.net.Uri, headers: Map<String, List<String>>) =
        wrap(defaults.createExtractors(uri, headers))
    }
    DefaultMediaSourceFactory(context, extractors).setDataSourceFactory(sequentialFactory)
  } else buildMediaSourceFactory(context, sequentialFactory)`
);
// v424: oplys den bestilte laengde som varighed. Uden den (og med skjult
// Content-Length) regnede Media3 stykket for en live-stroem: ingen spoling i
// bufferen, hvert overlap genlaest fra byte 0 med en ekstra forbindelse, og
// en netfejl satte stykket tilbage til 0 i stilhed.
const after = v419After
  .replace(
    `  val sequentialFactory = if (archiveTs) {`,
    `  // Bestilte minutter fra adressen: duration= (php) eller /timeshift/u/p/<min>/ (path).
  val archiveDurationUs = videoSource.uri?.let { uri ->
    val minutes = uri.getQueryParameter("duration")?.toLongOrNull()
      ?: uri.pathSegments.let { segments ->
        val index = segments.indexOf("timeshift")
        if (index >= 0 && index + 3 < segments.size) segments[index + 3].toLongOrNull() else null
      }
    minutes?.takeIf { it > 0 }?.let { (it * 60L + 5L) * 1_000_000L }
  } ?: androidx.media3.common.C.TIME_UNSET
  val sequentialFactory = if (archiveTs) {`,
  )
  .replace(
    `                override fun getDurationUs() = seekMap.durationUs`,
    `                override fun getDurationUs() = if (archiveDurationUs == androidx.media3.common.C.TIME_UNSET) seekMap.durationUs else archiveDurationUs`,
  );
const hash = '8ffd704064677f8862f093b43a14c20584c6235b9602384979a0e5498cb943ee';
export function patchArchiveTs(source) {
  const digest = text => createHash('sha256').update(text).digest('hex');
  if (digest(source) === hash && source.split(before).length === 2) return source.replace(before, after);
  const original = source.replace(after, before).replace(v419After, before).replace(previousAfter, before);
  if (digest(original) === hash) return patchArchiveTs(original);
  throw new Error('Ukendt expo-video DataSourceUtils.kt: kontroller arkiv-patch foer build');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = new URL('../node_modules/expo-video/android/src/main/java/expo/modules/video/utils/DataSourceUtils.kt', import.meta.url);
  await writeFile(path, patchArchiveTs(await readFile(path, 'utf8')));
  console.log('Expo-video: sekventiel arkiv-TS med oplyst varighed og uden PCR-byte-seek klargjort');
}
