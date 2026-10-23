import { describe, expect, it, vi } from 'vitest';
import {
  adjacentTeletextPage, drTeletextUrl, loadDrTeletextPage, readDrTeletextPage,
  TeletextError, teletextImageDocument,
} from './drTeletext.js';

// Samme opbygning som DR's HTML, uden at kopiere redaktionelt indhold.
function html(page = 100, image = `/fttvimg/DR1/${page}_0001-215.gif`): string {
  return `<HTML><HEAD><TITLE>dr.dk: TEKST-TV side ${page} - DR1</TITLE></HEAD><BODY>
    <img src="/toppen.gif" width="320" height="37">
    <map name="ttv"><area href="/cgi-bin/fttv1.exe/200"></map>
    <a href="/fttvimg/DR1/${page}_0001.map"><IMG BORDER="0" WIDTH="320" HEIGHT="375" SRC="${image}" ISMAP USEMAP="#ttv"></a>
    <map name="FPMap0"><area href="/cgi-bin/fttv1.exe/899"><area href="/cgi-bin/fttv1.exe/101"></map>
    </BODY></HTML>`;
}
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const imageResponse = () => new Response(gif, { headers: { 'Content-Type': 'image/gif' } });

describe('DR originale sider', () => {
  it('finder det originale sidebillede og DRs egne bladrelinks, uden websidens pynt', () => {
    expect(readDrTeletextPage(html(), 100)).toEqual({
      number: 100, imageUrl: 'https://www.dr.dk/fttvimg/DR1/100_0001-215.gif',
      width: 320, height: 375, previous: 899, next: 101,
    });
    expect(adjacentTeletextPage(899, 1)).toBe(100);
    expect(drTeletextUrl(101, 123)).toBe('https://www.dr.dk/cgi-bin/fttv1.exe/101?_=123');
  });

  it('skelner mellem DRs manglende side og en fejl-/blokside med HTTP 200', () => {
    expect(() => readDrTeletextPage('<title>dr.dk: TEKST-TV side 899 - DR1</title>', 899))
      .toThrowError(new TeletextError('missing'));
    expect(() => readDrTeletextPage('<html><title>Site Unavailable</title></html>', 100))
      .toThrowError(new TeletextError('source'));
    expect(() => readDrTeletextPage(html(101), 100)).toThrowError(new TeletextError('source'));
    expect(() => drTeletextUrl(100.5, 1)).toThrow();
    expect(() => drTeletextUrl(999, 1)).toThrow();
  });

  it.each([
    'https://example.org/fttvimg/DR1/100_0001.gif',
    'https://www.dr.dk@example.org/fttvimg/DR1/100_0001.gif',
    '/fttvimg/DR1/101_0001.gif', '/fttvimg/DR1/100_0001.gif?elsewhere=1',
  ])('afviser billeder der ikke tilhoerer den valgte originale side: %s', src => {
    expect(() => readDrTeletextPage(html(100, src), 100)).toThrow();
  });

  it('henter det skiftende GIF-navn igen ved 404 og bevarer de originale billedbytes', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(html()))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(html(100, '/fttvimg/DR1/100_0001-216.gif')))
      .mockResolvedValueOnce(imageResponse());
    const signal = new AbortController().signal;
    const page = await loadDrTeletextPage(100, signal, request, () => 42);
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      'https://www.dr.dk/cgi-bin/fttv1.exe/100?_=42', 'https://www.dr.dk/fttvimg/DR1/100_0001-215.gif',
      'https://www.dr.dk/cgi-bin/fttv1.exe/100?_=43', 'https://www.dr.dk/fttvimg/DR1/100_0001-216.gif',
    ]);
    expect(request.mock.calls.every(([, init]) => init.signal === signal && init.credentials === 'omit')).toBe(true);
    expect(page.imageData).toBe(`data:image/gif;base64,${gif.toString('base64')}`);
    const document = teletextImageDocument(page);
    expect(document).toContain(page.imageData);
    expect(document).toContain("default-src 'none'");
    expect(document).not.toContain('<script');
    expect(document).not.toContain('https://');
  });

  it('viser aldrig HTML-fejlsvar som et tekst-tv-billede', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(html()))
      .mockResolvedValueOnce(new Response('<h1>Site Unavailable</h1>'));
    await expect(loadDrTeletextPage(100, new AbortController().signal, request))
      .rejects.toEqual(new TeletextError('source'));
  });

  it('afviser en viderestilling til en anden vaert', async () => {
    const response = new Response(html());
    Object.defineProperty(response, 'url', { value: 'https://example.org/100' });
    const request = vi.fn().mockResolvedValue(response);
    await expect(loadDrTeletextPage(100, new AbortController().signal, request))
      .rejects.toEqual(new TeletextError('source'));
    expect(request).toHaveBeenCalledTimes(1);
  });
});
