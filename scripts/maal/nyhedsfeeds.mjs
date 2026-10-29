// Hvilke danske nyheds-RSS-feeds virker, og baerer deres nyheder en <category>?
// Koeres med motoren "maal" (frit internet). Ingen legitimation — alt er
// offentlige feeds. Svaret bruges til at rette sync/news.ts uden at gaette.
const UA =
  'Mozilla/5.0 (Linux; Android 12; NorStream) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const CANDIDATES = [
  // DR — kendt virkende basis + kategori-gaet
  'https://www.dr.dk/nyheder/service/feeds/allenyheder',
  'https://www.dr.dk/nyheder/service/feeds/senestenyt',
  'https://www.dr.dk/nyheder/service/feeds/indland',
  'https://www.dr.dk/nyheder/service/feeds/udland',
  'https://www.dr.dk/nyheder/service/feeds/sport',
  'https://www.dr.dk/nyheder/service/feeds/sporten',
  'https://www.dr.dk/nyheder/service/feeds/penge',
  'https://www.dr.dk/nyheder/service/feeds/politik',
  'https://www.dr.dk/nyheder/service/feeds/regionale',
  'https://www.dr.dk/nyheder/service/feeds/viden',
  'https://www.dr.dk/nyheder/service/feeds/kultur',
  // TV2 — flere gaet paa adressen
  'https://nyheder.tv2.dk/rss',
  'https://nyheder.tv2.dk/feed',
  'https://feeds.tv2.dk/nyhederne/rss',
  'https://feeds.tv2.dk/nyheder/rss',
  'https://feeds.tv2.dk/general/rss',
  // Andre danske kilder som reserve
  'https://www.tv2ostjylland.dk/rss',
  'https://ekstrabladet.dk/rssfeed/all/',
  'https://politiken.dk/rss/senestenyt.rss',
  'https://nyheder.tv2.dk/rss/seneste',
];

async function get(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml, text/xml, */*' }, signal: controller.signal, redirect: 'follow' });
    const text = await r.text();
    return { status: r.status, type: r.headers.get('content-type') ?? '', text, finalUrl: r.url };
  } catch (e) {
    return { status: 0, type: '', text: '', error: String(e && e.message ? e.message : e) };
  } finally {
    clearTimeout(timer);
  }
}

function firstItems(xml, n) {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  return blocks.slice(0, n).map((b) => {
    const title = (b.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 70);
    const cats = [...b.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi)].map((m) =>
      (m[1] ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    );
    return { title, cats };
  });
}

for (const url of CANDIDATES) {
  const r = await get(url);
  const itemCount = (r.text.match(/<item\b/gi) ?? []).length + (r.text.match(/<entry\b/gi) ?? []).length;
  console.log(`\n### ${url}`);
  console.log(`status=${r.status} type=${r.type} items=${itemCount}${r.finalUrl && r.finalUrl !== url ? ` final=${r.finalUrl}` : ''}${r.error ? ` error=${r.error}` : ''}`);
  if (itemCount > 0) {
    for (const it of firstItems(r.text, 3)) {
      console.log(`  - "${it.title}"  cats=[${it.cats.join(' | ')}]`);
    }
  } else if (r.status === 200 && r.text.length > 0) {
    console.log(`  (200 men ingen items) head=${r.text.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
}
