import { describe, expect, it } from 'vitest';
import { redactCredentials } from './redact.js';

describe('redactCredentials', () => {
  it('lader en almindelig logo-adresse staa', () => {
    expect(redactCredentials('http://panel.example:8080/images/dr1.png')).toBe(
      'http://panel.example:8080/images/dr1.png',
    );
  });

  it('fjerner legitimation i vaertsdelen', () => {
    expect(redactCredentials('http://bruger:kode@panel.example/dr1.png')).toBe(
      'http://***@panel.example/dr1.png',
    );
  });

  it('fjerner brugernavn og kode i forespoergslen', () => {
    // Diagnostikken kan ende paa et skaermbillede. Panelets adgangskode maa
    // ikke vaere det der slipper ud med det.
    expect(
      redactCredentials('http://panel.example/logo.php?username=seomidt&password=hemmelig'),
    ).toBe('http://panel.example/logo.php?username=***&password=***');
  });

  it('rammer ogsaa store bogstaver og korte navne', () => {
    expect(redactCredentials('http://x/y?USER=a&PASS=b')).toBe('http://x/y?USER=***&PASS=***');
  });
});
