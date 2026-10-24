/** Store originaler giver unoevendig trafik og dekodning under rulning. */
export function posterImageUri(uri: string): string {
  return uri.replace(/^(https?:\/\/image\.tmdb\.org\/t\/p\/)(?:original|w\d+)\//i, '$1w342/');
}
