import { describe, expect, it } from 'vitest';
import { youtubeProofConfig } from './youtubeProofConfig.js';

describe('aktuel YouTube-session', () => {
  it('samler alle kald saa en sen visitorData ikke sender HD-afspilleren til reserven', () => {
    const html = '<script>ytcfg.set({"EVENT_ID":"first","TEXT":"} ); \\\""});</script>' +
      '<script>ytcfg.set({"VISITOR_DATA":"current-session","EVENT_ID":"last"});</script>';
    expect(youtubeProofConfig(html)).toMatchObject({ VISITOR_DATA: 'current-session', EVENT_ID: 'last' });
  });
  it('laeser visitorData fra den aktuelle klient uden at opfinde en anden session', () => {
    expect(youtubeProofConfig('ytcfg.set({"INNERTUBE_CONTEXT":{"client":{"visitorData":"client-session"}}});').VISITOR_DATA).toBe('client-session');
    expect(youtubeProofConfig('ytcfg.set({"INNERTUBE_CONTEXT":{"client":{"visitorData":"client"}},"VISITOR_DATA":"explicit"});').VISITOR_DATA).toBe('explicit');
    expect(youtubeProofConfig('<html>consent</html>').VISITOR_DATA).toBeUndefined();
  });
});
