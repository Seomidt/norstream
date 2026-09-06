import type { FetchLike, XtreamCredentials } from '@norstream/core';
import { applyStreamFormatSetting } from './features/player/format.js';
import { createFetchImpl } from './net/fetchImpl.js';
import { openDatabase } from './storage/db.js';
import { getStreamFormatSetting } from './storage/settings.js';
import type { SqlDatabase } from './storage/types.js';

export interface AppSession {
  db: SqlDatabase;
  creds: XtreamCredentials;
  fetchImpl: FetchLike;
}

export async function createSession(creds: XtreamCredentials): Promise<AppSession> {
  const db = await openDatabase();
  // Streamformatet laeses her, foer noget kan tegnes: baade afspilleren og
  // previewet bygger deres URL synkront i foerste render, og et format der
  // skiftede bagefter ville aabne stream nummer to paa et panel der kun
  // tillader én.
  applyStreamFormatSetting(await getStreamFormatSetting(db));
  return { db, creds, fetchImpl: createFetchImpl() };
}
