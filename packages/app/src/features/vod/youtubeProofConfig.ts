/** YouTube fordeler sessionens konfiguration over flere ytcfg.set-kald. */
export function youtubeProofConfig(html: string): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  const calls = /ytcfg\.set\(\s*(\{)/g;
  for (const match of html.matchAll(calls)) {
    const start = match.index + match[0].length - 1;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let i = start; i < html.length; i++) {
      const char = html[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        try { Object.assign(config, JSON.parse(html.slice(start, i + 1))); } catch { /* Naeste kald kan indeholde sessionen. */ }
        break;
      }
    }
  }
  const context = config.INNERTUBE_CONTEXT as { client?: { visitorData?: unknown } } | undefined;
  if (typeof config.VISITOR_DATA !== 'string' && typeof context?.client?.visitorData === 'string') config.VISITOR_DATA = context.client.visitorData;
  return config;
}
