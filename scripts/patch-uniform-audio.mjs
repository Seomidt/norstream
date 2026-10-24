import { copyFile } from 'node:fs/promises';
const root = new URL('../node_modules/expo-video/android/src/main/java/expo/modules/video/player/', import.meta.url);
for (const name of ['NorstreamLeveler', 'NorstreamAudioProcessor', 'NorstreamRenderersFactory']) {
  await copyFile(new URL(`native-audio/${name}.java`, import.meta.url), new URL(`${name}.java`, root));
}
console.log('Expo-video: ensartet PCM-lyd klargjort');
