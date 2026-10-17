import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const specs = {
  "records/VideoSource.kt": {
    "hash": "3667facd5549e24df5010ee43f4a2e8ad1d70871127bd887aba076b0a9da0ceb",
    "edits": [
      [
        "  @Field val contentType: ContentType = ContentType.AUTO",
        "  @Field val contentType: ContentType = ContentType.AUTO,\n  @Field var norstreamArchive: Map<String, Double>? = null"
      ],
      [
        "      setUri(parseLocalAssetId(uri, context))",
        "      setUri(parseLocalAssetId(uri, context))\n      norstreamArchive?.let { options ->\n        setMediaId(\"norstream-archive:${options[\"token\"]?.toLong()}:${options[\"startMs\"]?.toLong()}:${options[\"clipMs\"]?.toLong()}\")\n      }"
      ]
    ]
  },
  "VideoModule.kt": {
    "hash": "5474c0637f0e18946a5290bdc01ed3d125c540b3c232646613403a3937c0d066",
    "edits": [
      [
        "            ref.player.currentPosition / 1000f",
        "            (if (ref.norstreamArchiveQueue.enabled) ref.norstreamArchiveQueue.positionMs else ref.player.currentPosition) / 1000f"
      ],
      [
        "            ref.player.seekTo((currentTime * 1000).toLong())",
        "            val position = (currentTime * 1000).toLong()\n            ref.player.seekTo(if (ref.norstreamArchiveQueue.enabled) ref.norstreamArchiveQueue.seekPositionMs(position) else position)"
      ]
    ]
  }
};
export function patchArchiveQueue(path, source) {
  const spec = specs[path];
  if (!spec) throw new Error(`Ukendt arkivkoe-fil: ${path}`);
  const digest = text => createHash('sha256').update(text).digest('hex');
  if (digest(source) === spec.hash) {
    let patched = source;
    for (const [before, after] of spec.edits) {
      if (patched.split(before).length !== 2) throw new Error(`Tvetydig arkivkoe-patch: ${path}`);
      patched = patched.replace(before, after);
    }
    return patched;
  }
  let original = source;
  for (const [before, after] of [...spec.edits].reverse()) original = original.replace(after, before);
  if (digest(original) === spec.hash && patchArchiveQueue(path, original) === source) return source;
  throw new Error(`Ukendt expo-video arkivkoe: ${path}; kontroller foer build`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = '../node_modules/expo-video/android/src/main/java/expo/modules/video/';
  const files = await Promise.all(Object.keys(specs).map(async path => {
    const url = new URL(root + path, import.meta.url);
    return { url, patched: patchArchiveQueue(path, await readFile(url, 'utf8')) };
  }));
  for (const { url, patched } of files) await writeFile(url, patched);
  await writeFile(new URL(root + 'player/NorstreamArchiveQueue.kt', import.meta.url), await readFile(new URL('./native/NorstreamArchiveQueue.kt', import.meta.url), 'utf8'));
  console.log('Expo-video: native arkivkoe v395 med sammenhaengende ur klargjort');
}
