export const VERIFIED_META_UPSERT = `INSERT INTO vod_posters (item_key, url, rating, tried_ms, genres, year, tmdb_id, metadata_version)
 VALUES (?, ?, ?, ?, ?, ?, ?, 1)
 ON CONFLICT(item_key) DO UPDATE SET url=excluded.url, rating=excluded.rating,
 tried_ms=excluded.tried_ms, genres=CASE WHEN vod_posters.metadata_version=1 AND vod_posters.tmdb_id=excluded.tmdb_id AND COALESCE(excluded.genres, '')='' THEN COALESCE(vod_posters.genres, excluded.genres) ELSE excluded.genres END,
 year=CASE WHEN vod_posters.metadata_version=1 AND vod_posters.tmdb_id=excluded.tmdb_id THEN COALESCE(excluded.year, vod_posters.year) ELSE excluded.year END, tmdb_id=excluded.tmdb_id,
 metadata_version=1, providers=CASE WHEN vod_posters.tmdb_id=excluded.tmdb_id THEN vod_posters.providers ELSE NULL END`;

