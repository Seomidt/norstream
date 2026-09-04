export type {
  Category,
  Channel,
  Programme,
  StreamFormat,
  TimeshiftDialect,
  XtreamCredentials,
} from './models.js';

export {
  buildLiveUrl,
  buildTimeshiftUrl,
  formatTimeshiftStart,
  normaliseBaseUrl,
} from './urls.js';

export { createXmltvParser } from './epg/parser.js';
export type { XmltvParser } from './epg/parser.js';
export { parseXmltvTimestamp } from './epg/timestamp.js';
export { decodeXmlEntities } from './epg/entities.js';

export { parseM3u } from './m3u/parser.js';
export type { M3uEntry } from './m3u/parser.js';

export {
  mapCategories,
  mapCategory,
  mapChannel,
  mapChannels,
} from './xtream/mapping.js';
export type { RawXtreamCategory, RawXtreamStream } from './xtream/mapping.js';

export { XtreamAuthError, XtreamClient, XtreamNetworkError } from './xtream/client.js';
export type { FetchLike, FetchLikeResponse } from './xtream/client.js';

export { detectTimeshiftDialect } from './xtream/probe.js';
