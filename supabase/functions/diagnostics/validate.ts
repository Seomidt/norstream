export function redact(text: string): string {
  return text.replace(/(\btrailer:\s*TV:).+?(,\s*direkte HD)/gi, '$1 [titel]$2').replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[adresse]')
    .replace(/\b(username|password|token|apikey|api_key|authorization)\s*[=:]\s*[^&\s,;]+/gi, '$1=…')
    .replace(/\bBearer\s+\S+/gi, 'Bearer …');
}
export function cleanReport(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const v=value as Record<string, unknown>;
  if (v.schema!==1 || !Number.isSafeInteger(v.version) || (v.version as number)<1 || (v.version as number)>100000 ||
      !Array.isArray(v.entries) || v.entries.length>80 || !Number.isFinite(v.sentAt)) return null;
  const entries=[];
  for (const entry of v.entries) {
    if (!entry || typeof entry!=='object' || !Number.isFinite(entry.at) || typeof entry.line!=='string' || entry.line.length>300) return null;
    entries.push({at:entry.at,line:redact(entry.line)});
  }
  const context: Record<string, number | string | boolean | null>={};
  if (v.playback && typeof v.playback==='object') {
    const p=v.playback as Record<string,unknown>;
    for (const key of ['observedAt','programmeStart','programmeStop','segmentStart','position','buffered','duration','queued','rendered','dropped']) {
      const n=p[key]; if (typeof n==='number' && Number.isFinite(n) && n>=0 && n<=1e15) context[key]=n;
    }
    if (['archive','live','closed'].includes(p.mode as string)) context.mode=p.mode as string;
    if (['idle','loading','readyToPlay','error'].includes(p.status as string)) context.status=p.status as string;
    if (typeof p.playing==='boolean') context.playing=p.playing;
  }
  return {schema:1,kind:v.kind==='failure'?'failure':'heartbeat',version:v.version,sentAt:v.sentAt,entries,playback:context};
}
