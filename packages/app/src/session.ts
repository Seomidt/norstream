import type { FetchLike, XtreamCredentials } from '@norstream/core';
import { createFetchImpl } from './net/fetchImpl.js';
import { openDatabase } from './storage/db.js';
import type { SqlDatabase } from './storage/types.js';

export interface AppSession {
  db: SqlDatabase;
  creds: XtreamCredentials;
  fetchImpl: FetchLike;
}

export async function createSession(creds: XtreamCredentials): Promise<AppSession> {
  return { db: await openDatabase(), creds, fetchImpl: createFetchImpl() };
}
