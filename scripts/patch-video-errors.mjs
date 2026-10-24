import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Expo skjuler Androids numeriske fejlkode. Tilfoej kun disse sikre felter;
// selve afspilleren og fejlteksten aendres ikke. Stop ved ukendt kildekode.
export function patchPlaybackError(source) {
  const patched = source.replace('  @Field var message: String? = null',
    '  @Field var message: String? = null,\n  @Field var errorCode: Int? = null,\n  @Field var errorType: Int? = null')
    .replace('this(errorMessageFromException(exception))',
      'this(errorMessageFromException(exception), exception.errorCode, (exception as? androidx.media3.exoplayer.ExoPlaybackException)?.type)');
  if (createHash('sha256').update(source).digest('hex') === '4f963b3535aba2dcddd3dbe18280b675a0f6168a064c9dd11cb78c710acab03e') return patched;
  // Idempotens: npm install kan koere flere gange i samme checkout.
  const upstream = source.replace(',\n  @Field var errorCode: Int? = null,\n  @Field var errorType: Int? = null', '')
    .replace('this(errorMessageFromException(exception), exception.errorCode, (exception as? androidx.media3.exoplayer.ExoPlaybackException)?.type)', 'this(errorMessageFromException(exception))');
  if (createHash('sha256').update(upstream).digest('hex') === '4f963b3535aba2dcddd3dbe18280b675a0f6168a064c9dd11cb78c710acab03e' && source.includes('@Field var errorCode')) return source;
  throw new Error('Ukendt expo-video PlaybackError.kt: kontroller patchen foer build');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = new URL('../node_modules/expo-video/android/src/main/java/expo/modules/video/records/PlaybackError.kt', import.meta.url);
  const source = await readFile(path, 'utf8');
  await writeFile(path, patchPlaybackError(source));
  console.log('Expo-video: sikre numeriske Android-fejlkoder klargjort');
}
