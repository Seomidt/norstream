import { describe, expect, it } from 'vitest';
import { logoCandidates } from './logo.js';

const PANEL = 'http://panel.example:8080';

describe('logoCandidates', () => {
  it('proever ogsaa panelets egen vaert naar logoet ligger et andet sted', () => {
    // Maalt paa brugerens panel: logoerne staar paa en vaert telefonen
    // svarer "Host unreachable" paa, mens panelet selv virker fint.
    expect(logoCandidates('http://103.176.90.95/images/978715.png', PANEL)).toEqual([
      'http://103.176.90.95/images/978715.png',
      'http://panel.example:8080/images/978715.png',
    ]);
  });

  it('gaetter ikke naar logoet allerede ligger paa panelet', () => {
    const url = `${PANEL}/images/1.png`;
    expect(logoCandidates(url, PANEL)).toEqual([url]);
  });

  it('regner port med i sammenligningen', () => {
    // Samme maskine, anden port, er stadig et andet sted at hente fra.
    expect(logoCandidates('http://panel.example/images/1.png', PANEL)).toHaveLength(2);
  });

  it('tager forespoergslen med over', () => {
    expect(logoCandidates('http://andet.example/logo.php?id=7', PANEL)[1]).toBe(
      'http://panel.example:8080/logo.php?id=7',
    );
  });

  it('giver ingenting naar der ikke er noget logo', () => {
    expect(logoCandidates(null, PANEL)).toEqual([]);
    expect(logoCandidates('', PANEL)).toEqual([]);
  });

  it('lader en adresse den ikke forstaar staa alene', () => {
    // Panel-data er fulde af halve adresser. En der ikke kan deles, kan
    // heller ikke skrives om — men den skal stadig proeves.
    expect(logoCandidates('images/1.png', PANEL)).toEqual(['images/1.png']);
    expect(logoCandidates('http://x/1.png', 'ikke en adresse')).toEqual(['http://x/1.png']);
  });
});
