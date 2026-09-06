import { describe, expect, it } from 'vitest';
import { channelKey, isValidSourceId, parseChannelKey } from './source.js';

describe('channelKey', () => {
  it('holder to kilders kanal 1 adskilt', () => {
    // Uden det ville den ene udbyders DR1 overskrive den andens ved naeste
    // synkronisering, og favoritter pege paa den forkerte kanal.
    expect(channelKey('a', '1')).not.toBe(channelKey('b', '1'));
  });

  it('kan deles op igen', () => {
    expect(parseChannelKey(channelKey('src1', '247634'))).toEqual({
      sourceId: 'src1',
      streamId: '247634',
    });
  });

  it('deler ved det foerste kolon, ikke det sidste', () => {
    // Kanalens eget id kommer udefra. En M3U-liste kan sagtens have et
    // tvg-id med kolon i, og det maa ikke rive kildenoeglen fra hinanden.
    expect(parseChannelKey('src1:http://vaert:8080/kanal')).toEqual({
      sourceId: 'src1',
      streamId: 'http://vaert:8080/kanal',
    });
  });

  it('afviser noegler der ikke er noegler', () => {
    expect(parseChannelKey('247634')).toBeNull();
    expect(parseChannelKey('')).toBeNull();
    // Tom kildedel eller tom kanaldel er lige saa ubrugelig som ingen noegle.
    expect(parseChannelKey(':247634')).toBeNull();
    expect(parseChannelKey('src1:')).toBeNull();
  });
});

describe('isValidSourceId', () => {
  it('afviser id med skilletegnet i', () => {
    expect(isValidSourceId('src1')).toBe(true);
    expect(isValidSourceId('src:1')).toBe(false);
    expect(isValidSourceId('')).toBe(false);
  });
});
