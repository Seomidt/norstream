import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const before = "  val mediaSourceFactory = buildMediaSourceFactory(context, dataSourceFactory)";
const after = "  // Arkiv-TS er sammenfoejede optagelser: PCR i filens ende kan ikke bruges\n  // som en paalidelig varighed/byte-seek-map. Laes sekventielt; bevar HTTP-\n  // genoptagelse ved netfejl, men skjul fil-laengden for TS-extractoren.\n  val path = videoSource.uri?.path.orEmpty()\n  val archiveTs = path.endsWith(\"/timeshift.php\") ||\n    (path.contains(\"/timeshift/\") && !path.endsWith(\".m3u8\"))\n  val sequentialFactory = if (archiveTs) {\n    DataSource.Factory {\n      val upstream = dataSourceFactory.createDataSource()\n      object : DataSource by upstream {\n        override fun open(dataSpec: androidx.media3.datasource.DataSpec): Long {\n          upstream.open(dataSpec)\n          return androidx.media3.common.C.LENGTH_UNSET.toLong()\n        }\n      }\n    }\n  } else dataSourceFactory\n  val mediaSourceFactory = buildMediaSourceFactory(context, sequentialFactory)";
const hash = '8ffd704064677f8862f093b43a14c20584c6235b9602384979a0e5498cb943ee';
export function patchArchiveTs(source) {
  const digest = text => createHash('sha256').update(text).digest('hex');
  if (digest(source) === hash && source.split(before).length === 2) return source.replace(before, after).replace("  return mediaSourceFactory.createMediaSource(mediaItem)", "  val source = mediaSourceFactory.createMediaSource(mediaItem)\n  val clipMs = videoSource.norstreamArchive?.get(\"clipMs\")?.toLong() ?: 0\n  return if (archiveTs && clipMs in 1..60_000) {\n    // Klip overlap i sample-koeen; ingen firedobbelt afspilning eller ny Range.\n    androidx.media3.exoplayer.source.ClippingMediaSource.Builder(source)\n      .setStartPositionMs(clipMs)\n      .setAllowUnseekableMedia(true)\n      .build()\n  } else source");
  const original = source.replace(after, before).replace("  val source = mediaSourceFactory.createMediaSource(mediaItem)\n  val clipMs = videoSource.norstreamArchive?.get(\"clipMs\")?.toLong() ?: 0\n  return if (archiveTs && clipMs in 1..60_000) {\n    // Klip overlap i sample-koeen; ingen firedobbelt afspilning eller ny Range.\n    androidx.media3.exoplayer.source.ClippingMediaSource.Builder(source)\n      .setStartPositionMs(clipMs)\n      .setAllowUnseekableMedia(true)\n      .build()\n  } else source", "  return mediaSourceFactory.createMediaSource(mediaItem)");
  if (digest(original) === hash && patchArchiveTs(original) === source) return source;
  throw new Error('Ukendt expo-video DataSourceUtils.kt: kontroller arkiv-patch foer build');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = new URL('../node_modules/expo-video/android/src/main/java/expo/modules/video/utils/DataSourceUtils.kt', import.meta.url);
  await writeFile(path, patchArchiveTs(await readFile(path, 'utf8')));
  console.log('Expo-video: sekventiel arkiv-TS uden PCR-byte-seek klargjort');
}
