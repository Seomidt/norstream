import { describe, expect, it } from 'vitest';
import {
  createMultipartBody,
  parseDeviceCode,
  parseFileId,
  parseRefreshedToken,
  parseTokenPoll,
} from './googleDriveParse.js';

describe('parseDeviceCode', () => {
  it('reads the code and normalises the verification field', () => {
    const code = parseDeviceCode({
      device_code: 'dev123',
      user_code: 'ABCD-EFGH',
      verification_url: 'https://www.google.com/device',
      interval: 5,
      expires_in: 1800,
    });
    expect(code.userCode).toBe('ABCD-EFGH');
    expect(code.verificationUrl).toBe('https://www.google.com/device');
    expect(code.intervalSeconds).toBe(5);
  });

  it('accepts verification_uri as well', () => {
    const code = parseDeviceCode({ device_code: 'd', user_code: 'u', verification_uri: 'https://g.co/x' });
    expect(code.verificationUrl).toBe('https://g.co/x');
  });

  it('throws when the code is missing', () => {
    expect(() => parseDeviceCode({ user_code: 'u' })).toThrow();
  });
});

describe('parseTokenPoll', () => {
  it('returns the tokens on success', () => {
    const poll = parseTokenPoll({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
    expect(poll).toEqual({ status: 'ok', accessToken: 'a', refreshToken: 'r', expiresInSeconds: 3600 });
  });

  it('maps the waiting states', () => {
    expect(parseTokenPoll({ error: 'authorization_pending' }).status).toBe('pending');
    expect(parseTokenPoll({ error: 'slow_down' }).status).toBe('slow_down');
    expect(parseTokenPoll({ error: 'expired_token' }).status).toBe('expired');
    expect(parseTokenPoll({ error: 'access_denied' }).status).toBe('denied');
  });
});

describe('parseRefreshedToken', () => {
  it('returns the access token', () => {
    expect(parseRefreshedToken({ access_token: 'a' })).toBe('a');
  });
  it('throws reauth when the refresh is rejected', () => {
    expect(() => parseRefreshedToken({ error: 'invalid_grant' })).toThrow('reauth');
  });
});

describe('parseFileId', () => {
  it('returns the id', () => {
    expect(parseFileId({ id: 'file1' })).toBe('file1');
  });
  it('throws when there is no id', () => {
    expect(() => parseFileId({})).toThrow();
  });
});

describe('createMultipartBody', () => {
  it('includes the name and the content', () => {
    const body = createMultipartBody('backup.json', '{"a":1}');
    expect(body).toContain('backup.json');
    expect(body).toContain('{"a":1}');
    expect(body).toContain('norstream-grms-boundary');
  });
});
