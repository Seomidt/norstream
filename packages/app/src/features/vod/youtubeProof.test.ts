import { describe, expect, it } from 'vitest';
import { completeProofFile, isProofResult, proofRequestAllowed } from './youtubeProof.js';
const video = { url: 'https://r1.googlevideo.com/videoplayback?pot=genuine-token', contentLength: 20000000, mimeType: 'video/mp4; codecs="avc1"', height: 1080, initRange: { start: '0', end: '740' }, indexRange: { start: '741', end: '1499' } };
const audio = { ...video, contentLength: 2000000, mimeType: 'audio/mp4; codecs="mp4a"', height: undefined };
const result = { video, audio, seconds: 150.02, userAgent: 'Actual Android WebView UA' };
describe('proof network boundary', () => {
  it('allows current attestation, player and interpreter endpoints', () => {
    for (const url of ['https://www.youtube.com/', 'https://www.youtube.com/iframe_api', 'https://www.youtube.com/s/player/current/base.js', 'https://www.google.com/js/th/current.js']) expect(proofRequestAllowed(url, 'GET')).toBe(true);
    for (const url of ['https://www.youtube.com/api/jnn/v1/GenerateIT', 'https://www.youtube.com/youtubei/v1/player']) expect(proofRequestAllowed(url, 'POST')).toBe(true);
  });
  it('blocks other hosts, deceptive prefixes and schemes, credentials and unneeded methods', () => {
    for (const url of ['https://www.youtube.com.attacker.test/youtubei/v1/player', 'http://www.youtube.com/', 'https://user:password@www.youtube.com/', 'https://www.google.com/search', 'https://www.youtube.com/logout', 'file:///data/private']) expect(proofRequestAllowed(url, 'GET')).toBe(false);
    expect(proofRequestAllowed('https://www.youtube.com/', 'POST')).toBe(false);
    expect(proofRequestAllowed('https://www.youtube.com/youtubei/v1/player', 'DELETE')).toBe(false);
  });
});
describe('complete native trailer', () => {
  it('accepts both token-bound tracks and a full trailer length', () => expect(isProofResult(result)).toBe(true));
  it('rejects missing proof, foreign files, broken byte ranges and excessive downloads', () => {
    for (const change of [{ url: 'https://r1.googlevideo.com/videoplayback' }, { url: 'https://googlevideo.com.attacker.test/file?pot=x' }, { contentLength: 100000000 }, { indexRange: { start: '1', end: '999999999' } }, { height: 2160 }]) expect(isProofResult({ ...result, video: { ...video, ...change } })).toBe(false);
    for (const seconds of [NaN, 10, 600]) expect(isProofResult({ ...result, seconds })).toBe(false);
  });
  it('rejects partial downloads and HTTP-200 HTML errors before playback', () => {
    expect(completeProofFile(195, 20000000)).toBe(false);
    expect(completeProofFile(5000000, 20000000)).toBe(false);
    expect(completeProofFile(0, 0)).toBe(false);
    expect(completeProofFile(20000000, 20000000)).toBe(true);
  });
});
