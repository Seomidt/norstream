/**
 * Gendan fra link: til tv'et, som hverken har Drev-appen eller en filvaelger.
 *
 * Brugeren deler filen fra Google Drev, Dropbox eller OneDrive med "alle
 * med linket" og skriver linket her. Delelinks peger paa en webside om
 * filen, ikke paa filen; her skrives de om til den adresse der giver selve
 * indholdet. Andre adresser bruges som de er.
 */
export function directDownloadUrl(input: string): string {
  const url = input.trim();
  // Google Drev: .../file/d/<id>/view, .../open?id=<id>, .../uc?id=<id>
  const driveFile = /drive\.google\.com\/file\/d\/([\w-]+)/.exec(url);
  if (driveFile !== null) return `https://drive.google.com/uc?export=download&id=${driveFile[1]}`;
  const driveId = /drive\.google\.com\/(?:open|uc)\?(?:.*&)?id=([\w-]+)/.exec(url);
  if (driveId !== null) return `https://drive.google.com/uc?export=download&id=${driveId[1]}`;
  // Dropbox: dl=0 viser siden, dl=1 giver filen.
  if (/dropbox\.com\//.test(url)) {
    const withoutDl = url.replace(/([?&])dl=0(&|$)/, (_match, before: string, after: string) => (after === '&' ? before : ''));
    return `${withoutDl}${withoutDl.includes('?') ? '&' : '?'}dl=1`;
  }
  // OneDrive: ?download=1 giver filen.
  if (/1drv\.ms\/|onedrive\.live\.com\//.test(url) && !/download=1/.test(url)) {
    return `${url}${url.includes('?') ? '&' : '?'}download=1`;
  }
  return url;
}

/** Sandt naar svaret ligner en webside i stedet for filen. */
export function looksLikeHtml(text: string): boolean {
  return /^\s*<(!doctype|html|head|body)/i.test(text);
}

export type TextFetch = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** Henter filens indhold; kaster med en forklaring brugeren kan handle paa. */
export async function fetchBackupFromLink(input: string, fetchImpl: TextFetch = fetch): Promise<string> {
  if (input.trim().length === 0) throw new Error('Skriv linket til filen først.');
  const url = directDownloadUrl(input);
  if (!/^https?:\/\//i.test(url)) throw new Error('Det ligner ikke et link. Det skal begynde med https://.');
  let response: Awaited<ReturnType<TextFetch>>;
  try {
    response = await fetchImpl(url);
  } catch {
    throw new Error('Linket kunne ikke hentes. Er tv’et på nettet?');
  }
  if (!response.ok) throw new Error(`Linket svarede med HTTP ${response.status}. Er filen delt med “Alle med linket”?`);
  const text = await response.text();
  if (looksLikeHtml(text)) {
    throw new Error('Linket gav en webside, ikke filen. Del filen med “Alle med linket” og prøv igen.');
  }
  return text;
}
