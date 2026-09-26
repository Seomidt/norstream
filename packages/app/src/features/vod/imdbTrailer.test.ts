import { describe, expect, it } from 'vitest';
import { findImdbTrailers, pickImdbFile, pickImdbTrailers } from './imdbTrailer.js';
import type { PostJson } from './imdbTrailer.js';

const urls = (id: string) => [
  { displayName: { value: '1080p' }, videoMimeType: 'MP4', url: `https://imdb-video.media-imdb.com/${id}-1080.mp4?Expires=1` },
  { displayName: { value: 'AUTO' }, videoMimeType: 'M3U8', url: `https://imdb-video.media-imdb.com/${id}-master.m3u8` },
  { displayName: { value: 'SD' }, videoMimeType: 'MP4', url: `https://imdb-video.media-imdb.com/${id}-sd.mp4` },
  { displayName: { value: '720p' }, videoMimeType: 'MP4', url: `https://imdb-video.media-imdb.com/${id}-720.mp4` },
];

const node = (id: string, name: string, runtime: number, type = 'Trailer') => ({
  id,
  name: { value: name },
  runtime: { value: runtime },
  contentType: { displayName: { value: type } },
  playbackURLs: urls(id),
});

// Som Dune: Part Two hos IMDb (maalt 26. sep. 2026).
const DUNE = [
  node('vi3332425241', 'Final Trailer', 31),
  node('vi3137783577', 'Official Trailer', 160),
  node('vi1755432729', 'Official Trailer 2', 184),
  node('vi113560345', 'Raid on the Spice Harvester - Clip', 241, 'Clip'),
];

describe('pickImdbFile', () => {
  it('vaelger MP4 i 1080p, ikke HLS eller lavere', () => {
    expect(pickImdbFile(urls('x'))).toEqual({ url: 'https://imdb-video.media-imdb.com/x-1080.mp4?Expires=1', height: 1080 });
  });

  it('tager 720p naar der ingen 1080p er, og aldrig over 1080p', () => {
    const only = [
      { displayName: { value: '2160p' }, videoMimeType: 'MP4', url: 'https://h/4k.mp4' },
      { displayName: { value: '720p' }, videoMimeType: 'MP4', url: 'https://h/720.mp4' },
    ];
    expect(pickImdbFile(only)?.height).toBe(720);
    expect(pickImdbFile([{ displayName: { value: 'AUTO' }, videoMimeType: 'M3U8', url: 'https://h/m.m3u8' }])).toBeNull();
  });
});

describe('pickImdbTrailers', () => {
  it('springer teaseren paa 31 s og klip over; officielle foerst', () => {
    const picked = pickImdbTrailers(DUNE);
    expect(picked.map((t) => t.videoId)).toEqual(['vi3137783577', 'vi1755432729']);
    expect(picked[0]).toMatchObject({ name: 'Official Trailer', seconds: 160, height: 1080 });
  });

  it('afviser underlige id’er', () => {
    expect(pickImdbTrailers([node('"><x', 'Official Trailer', 120)])).toEqual([]);
  });
});

describe('findImdbTrailers', () => {
  it('spoerger IMDbs GraphQL med nummeret og laeser svaret', async () => {
    let body = '';
    const post: PostJson = async (_url, _headers, b) => {
      body = b;
      return { data: { title: { primaryVideos: { edges: DUNE.map((n) => ({ node: n })) } } } };
    };
    const found = await findImdbTrailers(post, 'tt15239678');
    expect(JSON.parse(body).variables).toEqual({ id: 'tt15239678' });
    expect(found[0]?.videoId).toBe('vi3137783577');
  });

  it('giver en tom liste ved fejl og ugyldigt nummer', async () => {
    expect(await findImdbTrailers(async () => null, 'tt15239678')).toEqual([]);
    expect(
      await findImdbTrailers(async () => {
        throw new Error('net');
      }, 'tt15239678'),
    ).toEqual([]);
    let asked = false;
    expect(
      await findImdbTrailers(async () => {
        asked = true;
        return null;
      }, 'nope'),
    ).toEqual([]);
    expect(asked).toBe(false);
  });
});
