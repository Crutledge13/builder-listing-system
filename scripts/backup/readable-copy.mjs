// Backup layer 3: readable copies anyone on our team can open (docs/backups.md).
//   Google Sheet: one tab per builder with every listing, rewritten each run
//   Dropbox:      photo and video originals in Builder / Community / Home folders
// Each part runs only when its settings exist. No packages needed (Node 22).
import { createSign } from "node:crypto";

const env = process.env;
const SUPABASE_URL = env.SUPABASE_URL?.replace(/\/$/, "");
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;

function need(...names) {
  const missing = names.filter((n) => !env[n]);
  if (missing.length) throw new Error(`Missing settings: ${missing.join(", ")}`);
}

async function supa(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

const clean = (s) => String(s ?? "").replace(" (demo)", "").trim();

// ---------------------------------------------------------------------------
// Google Sheet
// ---------------------------------------------------------------------------
async function googleToken() {
  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  if (!res.ok) throw new Error(`Google sign-in failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function sheets(token, path, method = "GET", body) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Google Sheets ${res.status}: ${await res.text()}`);
  return res.json();
}

const COLUMNS = [
  ["Address", (h) => h.unparsed_address],
  ["City", (h) => h.city],
  ["ZIP", (h) => h.postal_code],
  ["Community", (h) => h.communities?.name],
  ["Plan", (h) => h.plan_name],
  ["Lot and block", (h) => h.lot_number],
  ["Status", (h) => h.workflow_status],
  ["On the market", (h) => h.market_status],
  ["MLS number", (h) => h.mls_number],
  ["List price", (h) => h.list_price],
  ["Bedrooms", (h) => h.bedrooms_total],
  ["Full baths", (h) => h.bathrooms_full],
  ["Half baths", (h) => h.bathrooms_half],
  ["Square feet", (h) => h.living_area],
  ["Lot acres", (h) => h.lot_size_acres],
  ["Stories", (h) => h.stories],
  ["Garage", (h) => h.garage_spaces],
  ["Build stage", (h) => h.build_stage],
  ["Estimated completion", (h) => h.estimated_completion],
  ["Description", (h) => h.public_remarks],
  ["Last changed", (h) => h.updated_at],
  ["In trash since", (h) => h.deleted_at],
  ["Home ID", (h) => h.id],
];

async function googleSheet() {
  need("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_SHEET_ID");
  const [builders, homes] = await Promise.all([
    supa("builders?select=id,name&order=name"),
    supa("homes?select=*,communities(name)&order=unparsed_address"),
  ]);
  const token = await googleToken();
  const meta = await sheets(token, "?fields=sheets.properties");
  const existing = new Set(meta.sheets.map((s) => s.properties.title));
  const tabs = [{ title: "About", rows: [["Builder Listings backup copy"], ["Updated", new Date().toISOString()], ["Homes", homes.length], [""], ["Read-only copy for browsing. Restores come from the Backblaze vault, not this sheet."]] }];
  for (const b of builders) {
    const title = clean(b.name).replace(/[[\]*?/\\:]/g, " ").slice(0, 90) || b.id;
    const list = homes.filter((h) => h.builder_id === b.id);
    tabs.push({ title, rows: [COLUMNS.map(([c]) => c), ...list.map((h) => COLUMNS.map(([, f]) => f(h) ?? ""))] });
  }
  const add = tabs.filter((t) => !existing.has(t.title)).map((t) => ({ addSheet: { properties: { title: t.title } } }));
  if (add.length) await sheets(token, ":batchUpdate", "POST", { requests: add });
  const ref = (t) => `'${t.title.replace(/'/g, "''")}'`; // quote tab names (O'Brien Homes)
  await sheets(token, "/values:batchClear", "POST", { ranges: tabs.map(ref) });
  await sheets(token, "/values:batchUpdate", "POST", {
    valueInputOption: "RAW",
    data: tabs.map((t) => ({ range: `${ref(t)}!A1`, values: t.rows })),
  });
  console.log(`Google Sheet: ${tabs.length - 1} builder tabs, ${homes.length} homes.`);
}

// ---------------------------------------------------------------------------
// Dropbox photo mirror
// ---------------------------------------------------------------------------
async function dropboxToken() {
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.DROPBOX_APP_KEY}:${env.DROPBOX_APP_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: env.DROPBOX_REFRESH_TOKEN }),
  });
  if (!res.ok) throw new Error(`Dropbox sign-in failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function dbx(token, path, body) {
  const res = await fetch(`https://api.dropboxapi.com/2/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 409) return { conflict: true, ...(await res.json()) };
  if (!res.ok) throw new Error(`Dropbox ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

const ROOT = "/Builder Listings";
const safe = (s) => clean(s).replace(/[\\/:*?"<>|]/g, "-").slice(0, 120) || "Untitled";

async function listAll(token) {
  const seen = new Set();
  let r = await dbx(token, "files/list_folder", { path: ROOT, recursive: true, limit: 2000 });
  if (r.conflict) return seen; // folder doesn't exist yet
  for (;;) {
    r.entries.filter((e) => e[".tag"] === "file").forEach((e) => seen.add(e.path_lower));
    if (!r.has_more) return seen;
    r = await dbx(token, "files/list_folder/continue", { cursor: r.cursor });
  }
}

async function upload(token, path, buf) {
  // Dropbox reads this from a header, which must be plain ASCII.
  const arg = (extra) => JSON.stringify(extra).replace(/[\u007f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  const CHUNK = 64 * 1024 * 1024;
  const call = async (endpoint, apiArg, body) => {
    const res = await fetch(`https://content.dropboxapi.com/2/${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Dropbox-API-Arg": apiArg, "Content-Type": "application/octet-stream" },
      body,
    });
    if (!res.ok) throw new Error(`Dropbox upload ${res.status}: ${await res.text()}`);
    return res.json();
  };
  const commit = { path, mode: "add", autorename: false, mute: true };
  if (buf.length <= 140 * 1024 * 1024) return call("files/upload", arg(commit), buf);
  // Big videos go up in pieces.
  const { session_id } = await call("files/upload_session/start", arg({}), buf.subarray(0, CHUNK));
  let offset = CHUNK;
  while (buf.length - offset > CHUNK) {
    await call("files/upload_session/append_v2", arg({ cursor: { session_id, offset } }), buf.subarray(offset, offset + CHUNK));
    offset += CHUNK;
  }
  return call("files/upload_session/finish", arg({ cursor: { session_id, offset }, commit }), buf.subarray(offset));
}

async function dropboxMirror() {
  need("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DROPBOX_APP_KEY", "DROPBOX_APP_SECRET", "DROPBOX_REFRESH_TOKEN");
  const media = await supa(
    "media?select=id,title,storage_path,plan_name,builders(name),communities(name),homes(unparsed_address)&source=eq.upload&deleted_at=is.null&storage_path=not.is.null&order=created_at",
  );
  const token = await dropboxToken();
  const have = await listAll(token);
  let copied = 0;
  for (const m of media) {
    const ext = m.storage_path.split(".").pop();
    const place = m.homes?.unparsed_address ? [safe(m.communities?.name ?? "No community"), safe(m.homes.unparsed_address)]
      : m.communities?.name ? [safe(m.communities.name), "Community photos"]
      : m.plan_name ? ["Floor plan library", safe(`${m.plan_name} plan`)]
      : ["Builder-wide"];
    const path = [ROOT, safe(m.builders?.name), ...place, `${safe(m.title)} (${m.id.slice(0, 8)}).${ext}`].join("/");
    if (have.has(path.toLowerCase())) continue;
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/media/${m.storage_path.split("/").map(encodeURIComponent).join("/")}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    if (!res.ok) throw new Error(`Couldn't read ${m.storage_path}: ${res.status}`);
    await upload(token, path, Buffer.from(await res.arrayBuffer()));
    copied++;
  }
  console.log(`Dropbox: ${copied} new files copied, ${media.length} files in total.`);
}

// ---------------------------------------------------------------------------
let failed = false;
for (const [name, enabled, run] of [
  ["Google Sheet", !!env.GOOGLE_SHEET_ID, googleSheet],
  ["Dropbox", !!env.DROPBOX_REFRESH_TOKEN, dropboxMirror],
]) {
  if (!enabled) continue;
  try {
    await run();
  } catch (e) {
    failed = true;
    console.error(`::error::${name} copy failed: ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
