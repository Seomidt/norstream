import { describe, expect, it } from 'vitest';
import { runConnectionCheck, splitPanelUrl } from './connectionCheck.js';
import type { Probe } from './connectionCheck.js';

const DOH = JSON.stringify({ Answer: [{ type: 1, data: '203.0.113.7' }, { type: 5, data: 'cname' }] });

/** Svarer efter adresse: et tal er en HTTP-status, `null` er intet svar. */
function probeWith(rules: Array<[RegExp, number | null | string]>): Probe & { calls: Array<[string, Record<string, string> | undefined]> } {
  const calls: Array<[string, Record<string, string> | undefined]> = [];
  const probe = (async (url: string, headers?: Record<string, string>) => {
    calls.push([url, headers]);
    for (const [pattern, answer] of rules) {
      if (!pattern.test(url)) continue;
      if (answer === null) throw new Error('Network request failed');
      if (typeof answer === 'string') return { status: 200, text: answer };
      return { status: answer, text: '' };
    }
    throw new Error(`uventet adresse ${url}`);
  }) as Probe & { calls: Array<[string, Record<string, string> | undefined]> };
  probe.calls = calls;
  return probe;
}

describe('splitPanelUrl', () => {
  it('skiller skema, vaert og port ad', () => {
    expect(splitPanelUrl('http://line.example.xyz/')).toEqual({
      scheme: 'http', host: 'line.example.xyz', port: '', hostHeader: 'line.example.xyz',
    });
    expect(splitPanelUrl('HTTP://panel.example:8080/x')).toEqual({
      scheme: 'http', host: 'panel.example', port: '8080', hostHeader: 'panel.example:8080',
    });
    expect(splitPanelUrl('panel.example')).toBeNull();
  });
});

describe('runConnectionCheck', () => {
  it('siger ok naar panelet svarer paa sit navn, uanset hvad det svarer', async () => {
    const probe = probeWith([
      [/generate_204/, 204],
      [/line\.example\.xyz\/player_api/, 403],
      [/dns\.google/, DOH],
      [/203\.0\.113\.7/, 403],
    ]);
    const report = await runConnectionCheck(probe, 'http://line.example.xyz');
    expect(report.verdict).toBe('ok');
    expect(report.steps.map((s) => s.ok)).toEqual([true, true, true, true]);
  });

  it('ser en DNS-blokering: navnet svarer ikke, adressen goer', async () => {
    const probe = probeWith([
      [/generate_204/, 204],
      [/line\.example\.xyz:8080\/player_api/, null],
      [/dns\.google/, DOH],
      [/203\.0\.113\.7:8080\/player_api/, 200],
    ]);
    const report = await runConnectionCheck(probe, 'http://line.example.xyz:8080');
    expect(report.verdict).toBe('dns-block');
    // Navnet sendes med som Host, saa panelet ved hvem der spoerges om.
    const direct = probe.calls.find(([url]) => url.includes('203.0.113.7'));
    expect(direct?.[1]).toEqual({ Host: 'line.example.xyz:8080' });
    expect(report.advice).toContain('Privat DNS');
  });

  it('ser en spaerret adresse: hverken navn eller adresse svarer', async () => {
    const probe = probeWith([
      [/generate_204/, 204],
      [/line\.example\.xyz\/player_api/, null],
      [/dns\.google/, DOH],
      [/203\.0\.113\.7\/player_api/, null],
    ]);
    const report = await runConnectionCheck(probe, 'http://line.example.xyz');
    expect(report.verdict).toBe('ip-block');
    expect(report.advice).toContain('mobildata');
  });

  it('stopper ved manglende internet', async () => {
    const probe = probeWith([[/generate_204/, null]]);
    const report = await runConnectionCheck(probe, 'http://line.example.xyz');
    expect(report.verdict).toBe('no-internet');
    expect(report.steps).toHaveLength(1);
  });

  it('proever Cloudflare naar Google ikke svarer', async () => {
    const probe = probeWith([
      [/generate_204/, 204],
      [/line\.example\.xyz\/player_api/, null],
      [/dns\.google/, null],
      [/cloudflare-dns/, DOH],
      [/203\.0\.113\.7\/player_api/, 200],
    ]);
    const report = await runConnectionCheck(probe, 'http://line.example.xyz');
    expect(report.verdict).toBe('dns-block');
    expect(report.steps[2]?.detail).toContain('Cloudflare');
  });

  it('ved ikke, naar ikke engang krypteret DNS svarer', async () => {
    const probe = probeWith([
      [/generate_204/, 204],
      [/line\.example\.xyz\/player_api/, null],
      [/dns\.google/, null],
      [/cloudflare-dns/, null],
    ]);
    const report = await runConnectionCheck(probe, 'http://line.example.xyz');
    expect(report.verdict).toBe('unknown');
  });

  it('bruger aldrig rigtige adgangsoplysninger', async () => {
    const probe = probeWith([
      [/generate_204/, 204],
      [/player_api/, 200],
      [/dns\.google/, DOH],
    ]);
    await runConnectionCheck(probe, 'http://line.example.xyz');
    for (const [url] of probe.calls) {
      if (url.includes('player_api')) expect(url).toContain('username=test&password=test');
    }
  });
});
