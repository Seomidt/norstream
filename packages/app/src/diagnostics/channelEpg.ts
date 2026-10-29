import { normaliseChannelName } from '@norstream/core';
import { safe } from './log.js';

/** Kun offentligt kanalnavn og statusflag; aldrig id, programtitel eller adgang. */
export function channelEpgSummary(
  channel: { name: string; hasArchive: boolean; archiveDays: number; epgChannelId: string | null },
  state: { hasDialect: boolean; hasCurrent: boolean; programmeCount?: number },
): string {
  const name = normaliseChannelName(safe(channel.name)).slice(0, 80) || '?';
  const yes = (value: boolean) => value ? 'ja' : 'nej';
  const days = Number.isFinite(channel.archiveDays) ? Math.max(0, Math.trunc(channel.archiveDays)) : 0;
  const full = state.programmeCount === undefined ? '' : `, fuld tabel ${state.programmeCount}`;
  return `kanal v388: ${name}, EPG-id ${yes(Boolean(channel.epgChannelId))}, arkiv ${yes(channel.hasArchive)}, dage ${days}, arkivvej ${yes(state.hasDialect)}, nu ${yes(state.hasCurrent)}${full}`;
}
