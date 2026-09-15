import { describe, expect, it } from 'vitest';
import { fileUrl, folderUrl } from './webdavUrl.js';

describe('WebDAV-adresser', () => {
  it('normaliserer mappeadressen til ét afsluttende skraastreg', () => {
    expect(folderUrl('https://dav.dk/NorStream')).toBe('https://dav.dk/NorStream/');
    expect(folderUrl('https://dav.dk/NorStream/')).toBe('https://dav.dk/NorStream/');
    expect(folderUrl(' https://dav.dk/NorStream/// ')).toBe('https://dav.dk/NorStream/');
  });

  it('laegger filnavnet i mappen', () => {
    expect(fileUrl('https://dav.dk/NorStream')).toBe('https://dav.dk/NorStream/norstream-sikkerhedskopi.json');
  });
});
