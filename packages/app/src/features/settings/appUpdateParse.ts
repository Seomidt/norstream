/** Ren udgave-tolkning uden native-moduler, saa den kan testes. */

export interface ReleaseJson {
  body?: string;
  name?: string;
  assets?: Array<{ name?: string; browser_download_url?: string }>;
}

export interface ParsedRelease {
  versionCode: number;
  url: string;
}

/** Fast maerkat per udgave, som byggeriet opdaterer for hvert build. */
export function releaseTag(isTV: boolean): string {
  return isTV ? 'latest-norstream-tv' : 'latest-norstream';
}

/** Versionsnummer og APK-adresse ud af en GitHub-udgivelse; kaster ved mangler. */
export function parseRelease(release: ReleaseJson): ParsedRelease {
  const versionCode = Number.parseInt((release.body ?? release.name ?? '').trim(), 10);
  const asset = (release.assets ?? []).find((entry) => (entry.name ?? '').endsWith('.apk'));
  const url = asset?.browser_download_url;
  if (!Number.isFinite(versionCode) || url === undefined || url.length === 0) {
    throw new Error('Udgivelsen mangler et versionsnummer eller en fil.');
  }
  return { versionCode, url };
}
