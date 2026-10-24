import { describe, expect, it } from 'vitest';
import { parseGeoLocation, parseOpenMeteo, weatherIcon, weatherText } from './weather.js';

describe('parseGeoLocation', () => {
  it('laeser koordinater og by fra et ipwho.is-svar', () => {
    expect(parseGeoLocation({ success: true, latitude: 55.7, longitude: 12.5, city: 'København' })).toEqual({
      lat: 55.7,
      lon: 12.5,
      city: 'København',
    });
  });

  it('accepterer tal som strenge', () => {
    expect(parseGeoLocation({ latitude: '56.1', longitude: '10.2', city: '  Aarhus  ' })).toEqual({
      lat: 56.1,
      lon: 10.2,
      city: 'Aarhus',
    });
  });

  it('afviser success:false, manglende og umulige koordinater', () => {
    expect(parseGeoLocation({ success: false, latitude: 55, longitude: 12 })).toBeNull();
    expect(parseGeoLocation({ latitude: 55 })).toBeNull();
    expect(parseGeoLocation({ latitude: 200, longitude: 12 })).toBeNull();
    expect(parseGeoLocation(null)).toBeNull();
    expect(parseGeoLocation('nej')).toBeNull();
  });

  it('lader byen vaere null naar den mangler', () => {
    expect(parseGeoLocation({ latitude: 55.7, longitude: 12.5 })).toEqual({ lat: 55.7, lon: 12.5, city: null });
  });
});

describe('parseOpenMeteo', () => {
  it('laeser nu-temperatur, kode og dagens yderpunkter', () => {
    const raw = {
      current: { temperature_2m: 17.4, weather_code: 3 },
      daily: { temperature_2m_max: [19.1, 18], temperature_2m_min: [10.2, 9] },
    };
    expect(parseOpenMeteo(raw)).toEqual({ tempNow: 17.4, tempMax: 19.1, tempMin: 10.2, code: 3 });
  });

  it('klarer sig uden dagsdata', () => {
    expect(parseOpenMeteo({ current: { temperature_2m: 12, weather_code: 61 } })).toEqual({
      tempNow: 12,
      tempMax: null,
      tempMin: null,
      code: 61,
    });
  });

  it('er null uden en nu-temperatur', () => {
    expect(parseOpenMeteo({ current: { weather_code: 0 } })).toBeNull();
    expect(parseOpenMeteo({})).toBeNull();
    expect(parseOpenMeteo(null)).toBeNull();
  });
});

describe('weatherText / weatherIcon', () => {
  it('giver dansk tekst for kendte koder', () => {
    expect(weatherText(0)).toBe('Klart');
    expect(weatherText(3)).toBe('Overskyet');
    expect(weatherText(63)).toBe('Regn');
    expect(weatherText(95)).toBe('Tordenvejr');
  });

  it('falder tilbage til "Vejr" for ukendte koder', () => {
    expect(weatherText(123)).toBe('Vejr');
  });

  it('vaelger et ikon der passer til koden', () => {
    expect(weatherIcon(0)).toBe('sun');
    expect(weatherIcon(2)).toBe('cloud');
    expect(weatherIcon(48)).toBe('fog');
    expect(weatherIcon(65)).toBe('rain');
    expect(weatherIcon(73)).toBe('snow');
    expect(weatherIcon(96)).toBe('storm');
  });
});
