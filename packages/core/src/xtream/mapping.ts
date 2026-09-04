import type { Category, Channel } from '../models.js';

export interface RawXtreamCategory {
  category_id?: string | number;
  category_name?: string;
}

export interface RawXtreamStream {
  stream_id?: string | number;
  name?: string;
  num?: string | number;
  stream_icon?: string | null;
  category_id?: string | number | null;
  epg_channel_id?: string | null;
  tv_archive?: string | number;
  tv_archive_duration?: string | number;
}

function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function integer(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function truthyFlag(value: unknown): boolean {
  return integer(value) === 1;
}

export function mapCategory(raw: RawXtreamCategory): Category | null {
  const id = text(raw.category_id);
  const name = text(raw.category_name);
  if (!id || !name) return null;
  return { id, name };
}

export function mapChannel(raw: RawXtreamStream): Channel | null {
  const id = text(raw.stream_id);
  const name = text(raw.name);
  if (!id || !name) return null;

  const hasArchive = truthyFlag(raw.tv_archive);

  return {
    id,
    name,
    number: integer(raw.num),
    logoUrl: text(raw.stream_icon),
    categoryId: text(raw.category_id),
    epgChannelId: text(raw.epg_channel_id),
    hasArchive,
    archiveDays: hasArchive ? (integer(raw.tv_archive_duration) ?? 0) : 0,
  };
}

function mapArray<TRaw, TOut>(
  raw: unknown,
  map: (item: TRaw) => TOut | null,
): TOut[] {
  if (!Array.isArray(raw)) return [];
  const out: TOut[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const mapped = map(item as TRaw);
    if (mapped) out.push(mapped);
  }
  return out;
}

export function mapCategories(raw: unknown): Category[] {
  return mapArray<RawXtreamCategory, Category>(raw, mapCategory);
}

export function mapChannels(raw: unknown): Channel[] {
  return mapArray<RawXtreamStream, Channel>(raw, mapChannel);
}
