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
  return vi.fn(async () => ({ ok, status, text: async () => '', json: async () => body }));
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
      text: async () => '', json: async () => {
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

describe('XtreamClient.getShortEpg', () => {
  const listing = {
    title: 'VFYgQXZpc2Vu',
    description: 'TnloZWRlciBmcmEgRGFubWFya3MgUmFkaW8=',
    start_timestamp: '1788624000',
    stop_timestamp: '1788625800',
  };

  it('kalder get_short_epg med stream_id og limit', async () => {
    const fetchImpl = respondWith({ epg_listings: [listing] });
    await new XtreamClient(creds, fetchImpl).getShortEpg('247634', 6);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://panel.example:8080/player_api.php' +
        '?username=USER&password=PASS&action=get_short_epg&stream_id=247634&limit=6',
    );
  });

  it('mapper svaret til programmer med stream_id som noegle', async () => {
    const client = new XtreamClient(creds, respondWith({ epg_listings: [listing] }));
    const result = await client.getShortEpg('247634');
    expect(result).toEqual([
      {
        channelId: '247634',
        title: 'TV Avisen',
        description: 'Nyheder fra Danmarks Radio',
        start: new Date(1788624000_000),
        stop: new Date(1788625800_000),
      },
    ]);
  });

  it('accepterer et objektsvar — det er ikke en liste som de oevrige endpoints', async () => {
    // requestList ville kaste her; getShortEpg skal ikke bruge den.
    const client = new XtreamClient(creds, respondWith({ epg_listings: [] }));
    await expect(client.getShortEpg('1')).resolves.toEqual([]);
  });

  it('giver en tom liste naar panelet ikke kender endpointet og svarer tomt', async () => {
    const client = new XtreamClient(creds, respondWith({}));
    await expect(client.getShortEpg('1')).resolves.toEqual([]);
  });

  it('kaster XtreamAuthError ved HTTP 401', async () => {
    const client = new XtreamClient(creds, respondWith({}, false, 401));
    await expect(client.getShortEpg('1')).rejects.toBeInstanceOf(XtreamAuthError);
  });

  it('kaster XtreamNetworkError ved HTTP 500', async () => {
    const client = new XtreamClient(creds, respondWith({}, false, 500));
    await expect(client.getShortEpg('1')).rejects.toBeInstanceOf(XtreamNetworkError);
  });

  it('bruger mindst limit 1, ogsaa naar kalderen beder om nul', async () => {
    const fetchImpl = respondWith({ epg_listings: [] });
    await new XtreamClient(creds, fetchImpl).getShortEpg('1', 0);
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('limit=1'));
  });

  it('URL-koder stream_id', async () => {
    const fetchImpl = respondWith({ epg_listings: [] });
    await new XtreamClient(creds, fetchImpl).getShortEpg('a b&c');
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('stream_id=a%20b%26c'));
  });
});

describe('XtreamClient.getPanelOffsetMinutes', () => {
  it('laeser panelets offset af server_info', async () => {
    const fetchImpl = respondWith({
      server_info: { time_now: '2026-09-05 18:34:12', timestamp_now: 1788626052 },
    });
    const client = new XtreamClient(creds, fetchImpl);
    await expect(client.getPanelOffsetMinutes()).resolves.toBe(120);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://panel.example:8080/player_api.php?username=USER&password=PASS',
    );
  });

  it('returnerer null naar panelet ikke oplyser nok', async () => {
    const client = new XtreamClient(creds, respondWith({ user_info: { auth: 1 } }));
    await expect(client.getPanelOffsetMinutes()).resolves.toBeNull();
  });
});
