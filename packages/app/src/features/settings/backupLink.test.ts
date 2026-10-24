import { describe, expect, it } from 'vitest';
import { directDownloadUrl, fetchBackupFromLink, looksLikeHtml } from './backupLink.js';

describe('gendan fra link', () => {
  it('skriver delelinks om til adressen der giver filen', () => {
    expect(directDownloadUrl('https://drive.google.com/file/d/1AbC_d-9/view?usp=sharing')).toBe(
      'https://drive.google.com/uc?export=download&id=1AbC_d-9',
    );
    expect(directDownloadUrl('https://drive.google.com/open?id=1AbC')).toBe('https://drive.google.com/uc?export=download&id=1AbC');
    expect(directDownloadUrl('https://www.dropbox.com/scl/fi/x/norstream.json?rlkey=k&dl=0')).toBe(
      'https://www.dropbox.com/scl/fi/x/norstream.json?rlkey=k&dl=1',
    );
    expect(directDownloadUrl('https://www.dropbox.com/s/x/norstream.json')).toBe('https://www.dropbox.com/s/x/norstream.json?dl=1');
    expect(directDownloadUrl('https://1drv.ms/u/s!abc')).toBe('https://1drv.ms/u/s!abc?download=1');
    expect(directDownloadUrl('  https://example.dk/kopi.json ')).toBe('https://example.dk/kopi.json');
  });

  it('kender en webside fra en fil', () => {
    expect(looksLikeHtml('<!DOCTYPE html><html>')).toBe(true);
    expect(looksLikeHtml('{"version":1}')).toBe(false);
  });

  it('henter filen og forklarer naar det gaar galt', async () => {
    const ok = async () => ({ ok: true, status: 200, text: async () => '{"favorites":[]}' });
    expect(await fetchBackupFromLink('https://drive.google.com/file/d/1/view', ok)).toBe('{"favorites":[]}');
    await expect(fetchBackupFromLink('', ok)).rejects.toThrow('Skriv linket');
    await expect(fetchBackupFromLink('drev', ok)).rejects.toThrow('https://');
    const html = async () => ({ ok: true, status: 200, text: async () => '<html><body>Log ind</body></html>' });
    await expect(fetchBackupFromLink('https://x.dk/f', html)).rejects.toThrow('webside');
    const denied = async () => ({ ok: false, status: 403, text: async () => '' });
    await expect(fetchBackupFromLink('https://x.dk/f', denied)).rejects.toThrow('HTTP 403');
    const down = async () => {
      throw new TypeError('Network request failed');
    };
    await expect(fetchBackupFromLink('https://x.dk/f', down)).rejects.toThrow('kunne ikke hentes');
  });
});
