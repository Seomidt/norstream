// NorStream sky-backup edge-funktion.
//
// Appen (packages/app/src/features/settings/cloudSync.ts) sender
// { action, code, data? }. `code` er brugerens hemmelige kodeord. Kopien
// krypteres med en noegle udledt af koden (PBKDF2 + AES-GCM), saa panelets
// adresse ALDRIG ligger i klartekst i databasen. Raekken slaas op paa en hash
// af koden; forkert kode => intet fundet.
//
// Tabellen public.sky_backup har RLS til og ingen policies, og grants er
// trukket fra anon/authenticated — kun denne funktion (service_role) kan roere
// den. verify_jwt er slaaet fra med vilje: hemmeligheden er kodeordet, som
// aldrig gemmes.
//
// Projekt: "Seomidt's Project" (ref usewnyvdxxfgvwaefvmq).
// Deploy sker via Supabase-vaerktoejet; denne fil er kilden i git.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PEPPER = "norstream-sky-v1";
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function rowId(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(PEPPER + "|id|" + code));
  return b64(new Uint8Array(digest));
}
async function deriveKey(code: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(PEPPER + "|" + code), "PBKDF2", false, ["deriveKey"]);
  return await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function storeBackup(code: string, data: string): Promise<boolean> {
  const id = await rowId(code);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(code, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(data)));
  const res = await fetch(`${SB_URL}/rest/v1/sky_backup`, {
    method: "POST",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ id, blob: b64(ct), iv: b64(iv), salt: b64(salt), updated_at: new Date().toISOString() }),
  });
  return res.ok;
}
async function readBackup(code: string): Promise<string | null> {
  const id = await rowId(code);
  const res = await fetch(
    `${SB_URL}/rest/v1/sky_backup?id=eq.${encodeURIComponent(id)}&select=blob,iv,salt`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } },
  );
  if (!res.ok) throw new Error("read");
  const rows = (await res.json()) as Array<{ blob: string; iv: string; salt: string }>;
  if (rows.length === 0) return null;
  const row = rows[0];
  const key = await deriveKey(code, unb64(row.salt));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(row.iv) }, key, unb64(row.blob));
  return dec.decode(new Uint8Array(pt));
}
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json(405, { ok: false, error: "method" });
  let body: { action?: string; code?: string; data?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "bad-json" });
  }
  const action = body.action;
  const code = (body.code ?? "").trim();
  if (code.length < 3) return json(400, { ok: false, error: "code-too-short" });

  if (action === "save") {
    const ok = await storeBackup(code, body.data ?? "");
    return ok ? json(200, { ok: true }) : json(500, { ok: false, error: "store" });
  }
  if (action === "load") {
    try {
      const data = await readBackup(code);
      if (data === null) return json(404, { ok: false, error: "notfound" });
      return json(200, { ok: true, data });
    } catch {
      return json(500, { ok: false, error: "read" });
    }
  }
  return json(400, { ok: false, error: "bad-action" });
});
