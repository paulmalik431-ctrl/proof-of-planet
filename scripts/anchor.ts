import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { SUPABASE_ANON_KEY as CONFIG_ANON_KEY, SUPABASE_URL as CONFIG_URL } from "../web/config.js";
import { nextAnchor } from "../web/js/anchor.js";

const url = process.env.SUPABASE_URL || CONFIG_URL;
const anonKey = process.env.SUPABASE_ANON_KEY || CONFIG_ANON_KEY;
const file = resolve(import.meta.dir, "../anchors/ledger-heads.jsonl");
const response = await fetch(url + "/rest/v1/public_ledger?select=seq,hash,at&order=seq.desc&limit=1", {
  headers: { apikey: anonKey, Authorization: "Bearer " + anonKey },
});
if (!response.ok) throw new Error("Could not read public ledger head (" + response.status + ").");
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1) throw new Error("Public ledger has no head to anchor.");
const head = { seq: Number(rows[0].seq), hash: String(rows[0].hash), at: String(rows[0].at) };
let existing = "";
try { existing = await readFile(file, "utf8"); } catch (error) {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
}
const line = nextAnchor(existing, head);
if (!line) {
  console.log("Ledger fingerprint #" + head.seq + " is already published.");
} else {
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, line, "utf8");
  console.log("Prepared ledger fingerprint #" + head.seq + ".");
}

