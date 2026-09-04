import { describe, expect, it, vi } from 'vitest';
import { XtreamAuthError, XtreamClient, XtreamNetworkError } from './client.js';
import type { FetchLike } from './client.js';
import type { XtreamCredentials } from '../models.js';

const creds: XtreamCredentials = {
  baseUrl: 'http://panel.example:8080',
  username: 'USER',
  password: 'PASS',
};

function respondWith(body: unknown, ok = true, status = 200): FetchLike {
  return vi.fn(async () => ({ ok, status, json: async () => body }));
}

describe('XtreamClient.authenticate', () => {
  it('kalder player_api.php uden action', async () => {
    const fetchImpl = respondWith({ user_info: { auth: 1 } });
    await new XtreamClient(creds, fetchImpl).authenticate();
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://panel.example:8080/player_api.php?username=USER&password=PASS',
    );
  });

  it('kaster XtreamAuthError når auth er 0', async () => {
    const client = new XtreamClient(creds, respondWith({ user_info: { auth: 0 } }));
    await expect(client.authenticate()).rejects.toBeInstanceOf(XtreamAuthError);
  });

  it('kaster XtreamAuthError ved HTTP 401', async () => {
    const client = new XtreamClient(creds, respondWith({}, false, 401));
    await expect(client.authenticate()).rejects.toBeInstanceOf(XtreamAuthError);
  });

  it('kaster XtreamAuthError når auth er "true" (boolsk, ikke numerisk)', async () => {
    const client = new XtreamClient(creds, respondWith({ user_info: { auth: true } }));
    await expect(client.authenticate()).rejects.toBeInstanceOf(XtreamAuthError);
  });

  it('kaster XtreamAuthError når auth er et array som [1]', async () => {
    const client = new XtreamClient(creds, respondWith({ user_info: { auth: [1] } }));
    await expect(client.authenticate()).rejects.toBeInstanceOf(XtreamAuthError);
  });

  it('kaster XtreamNetworkError ved HTTP 500', async () => {
    const client = new XtreamClient(creds, respondWith({}, false, 500));
    await expect(client.authenticate()).rejects.toBeInstanceOf(XtreamNetworkError);
  });

  it('kaster XtreamNetworkError når fetch afviser', async () => {
    const failing: FetchLike = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const client = new XtreamClient(creds, failing);
    await expect(client.authenticate()).rejects.toBeInstanceOf(XtreamNetworkError);
  });

  it('kaster XtreamNetworkError når svaret ikke er gyldig JSON', async () => {
    const badJson: FetchLike = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    }));
    const client = new XtreamClient(creds, badJson);
    await expect(client.authenticate()).rejects.toBeInstanceOf(XtreamNetworkError);
  });
});

describe('XtreamClient.getLiveCategories', () => {
  it('kalder det rigtige endpoint og mapper svaret', async () => {
    const fetchImpl = respondWith([{ category_id: '1', category_name: 'Danmark' }]);
    const result = await new XtreamClient(creds, fetchImpl).getLiveCategories();
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://panel.example:8080/player_api.php' +
        '?username=USER&password=PASS&action=get_live_categories',
    );
    expect(result).toEqual([{ id: '1', name: 'Danmark' }]);
  });
});

describe('XtreamClient.getLiveStreams', () => {
  it('kalder det rigtige endpoint og mapper svaret', async () => {
    const fetchImpl = respondWith([
      { stream_id: 1, name: 'DR1', tv_archive: 1, tv_archive_duration: 3 },
    ]);
    const result = await new XtreamClient(creds, fetchImpl).getLiveStreams();
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://panel.example:8080/player_api.php' +
        '?username=USER&password=PASS&action=get_live_streams',
    );
    expect(result[0]).toMatchObject({ id: '1', hasArchive: true, archiveDays: 3 });
  });

  it('kaster XtreamNetworkError når panelet svarer med et objekt i stedet for et array', async () => {
    const client = new XtreamClient(creds, respondWith({ error: 'nope' }));
    await expect(client.getLiveStreams()).rejects.toBeInstanceOf(XtreamNetworkError);
  });

  it('frafiltrerer stadig ugyldige elementer i et array uden at kaste', async () => {
    const client = new XtreamClient(
      creds,
      respondWith([{ stream_id: 1, name: 'DR1' }, null, 'vrøvl']),
    );
    await expect(client.getLiveStreams()).resolves.toHaveLength(1);
  });
});

describe('XtreamClient.getLiveCategories fejlhåndtering', () => {
  it('kaster XtreamNetworkError når panelet svarer med et objekt i stedet for et array', async () => {
    const client = new XtreamClient(creds, respondWith({ error: 'nope' }));
    await expect(client.getLiveCategories()).rejects.toBeInstanceOf(XtreamNetworkError);
  });
});
