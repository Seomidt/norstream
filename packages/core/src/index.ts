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
  buildXmltvUrl,
  formatTimeshiftStart,
  normaliseBaseUrl,
} from './urls.js';

export { decodeBase64Utf8 } from './base64.js';

export { countryFlag, deriveCountry } from './country/countries.js';
export type { Country } from './country/countries.js';

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

export { mapEpgListings } from './xtream/epgListings.js';
export type { RawEpgListing } from './xtream/epgListings.js';

export { panelOffsetFromServerInfo } from './xtream/serverInfo.js';
