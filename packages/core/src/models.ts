export interface Category {
  id: string;
  name: string;
}

export interface Channel {
  id: string;
  name: string;
  number: number | null;
  logoUrl: string | null;
  categoryId: string | null;
  epgChannelId: string | null;
  hasArchive: boolean;
  archiveDays: number;
}

export interface Programme {
  channelId: string;
  title: string;
  description: string | null;
  start: Date;
  stop: Date;
}

export interface XtreamCredentials {
  /** Basis-URL uden afsluttende skråstreg, fx "http://panel.example:8080" */
  baseUrl: string;
  username: string;
  password: string;
}

export type StreamFormat = 'ts' | 'm3u8';

export type TimeshiftDialect = 'php' | 'path';
