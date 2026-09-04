import { describe, expect, it } from 'vitest';
import { mapCategories, mapCategory, mapChannel, mapChannels } from './mapping.js';

describe('mapCategory', () => {
  it('mapper med numerisk id', () => {
    expect(mapCategory({ category_id: 5, category_name: 'Danmark' })).toEqual({
      id: '5',
      name: 'Danmark',
    });
  });

  it('mapper med streng-id', () => {
    expect(mapCategory({ category_id: '5', category_name: 'Danmark' })).toEqual({
      id: '5',
      name: 'Danmark',
    });
  });

  it('returnerer null når navnet mangler', () => {
    expect(mapCategory({ category_id: 5 })).toBeNull();
  });
});

describe('mapChannel', () => {
  const raw = {
    stream_id: 123,
    name: 'DR1 HD',
    num: '4',
    stream_icon: 'http://logo/dr1.png',
    category_id: '2',
    epg_channel_id: 'dr1.dk',
    tv_archive: 1,
    tv_archive_duration: 7,
  };

  it('mapper et fuldt udfyldt svar', () => {
    expect(mapChannel(raw)).toEqual({
      id: '123',
      name: 'DR1 HD',
      number: 4,
      logoUrl: 'http://logo/dr1.png',
      categoryId: '2',
      epgChannelId: 'dr1.dk',
      hasArchive: true,
      archiveDays: 7,
    });
  });

  it('behandler tv_archive som streng', () => {
    expect(mapChannel({ ...raw, tv_archive: '1' })?.hasArchive).toBe(true);
  });

  it('behandler tv_archive 0 som intet arkiv', () => {
    expect(mapChannel({ ...raw, tv_archive: 0 })?.hasArchive).toBe(false);
  });

  it('nulstiller archiveDays når arkiv er slået fra', () => {
    expect(mapChannel({ ...raw, tv_archive: 0 })?.archiveDays).toBe(0);
  });

  it('oversætter tom stream_icon til null', () => {
    expect(mapChannel({ ...raw, stream_icon: '' })?.logoUrl).toBeNull();
  });

  it('oversætter tom epg_channel_id til null', () => {
    expect(mapChannel({ ...raw, epg_channel_id: '' })?.epgChannelId).toBeNull();
  });

  it('returnerer null når stream_id mangler', () => {
    expect(mapChannel({ name: 'Uden id' })).toBeNull();
  });

  it('returnerer null når navnet er tomt', () => {
    expect(mapChannel({ stream_id: 1, name: '   ' })).toBeNull();
  });

  it('klemmer negativ tv_archive_duration til 0', () => {
    expect(mapChannel({ ...raw, tv_archive_duration: '-5' })?.archiveDays).toBe(0);
  });
});

describe('mapChannels', () => {
  it('frafiltrerer ugyldige poster', () => {
    const result = mapChannels([
      { stream_id: 1, name: 'God' },
      { name: 'Uden id' },
      null,
      'vrøvl',
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('God');
  });

  it('returnerer tom liste når svaret ikke er et array', () => {
    expect(mapChannels({ user_info: {} })).toEqual([]);
    expect(mapCategories(null)).toEqual([]);
  });

  it('frafiltrerer array-elementer der selv er arrays', () => {
    const result = mapChannels([{ stream_id: 1, name: 'God' }, ['ikke', 'en', 'kanal']]);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('God');
  });
});
