// Atlas — turns verified climate activity into a brief for funders and investors:
// what to fund, where action is needed, where the risk is. Muse Spark writes it from the
// public numbers only (every claim it makes is checkable on the map), refreshed at most every 6 hours.
import { MetaClient } from "../_core/meta.ts";
import { cors, env, json } from "../_shared/deps.ts";
import { SupabaseStore } from "../_shared/supabase-store.ts";

const FRESH_MS = 6 * 3600_000;
const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["headline", "summary", "fund_next", "risks", "data_gaps"],
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    fund_next: { type: "array", items: { type: "object", additionalProperties: false, required: ["lat", "lng", "why"], properties: { lat: { type: "number" }, lng: { type: "number" }, why: { type: "string" } } } },
    risks: { type: "array", items: { type: "string" } },
    data_gaps: { type: "array", items: { type: "string" } },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const { db } = new SupabaseStore();
  const [{ data: cells }, { data: stats }, { data: last }] = await Promise.all([
    db.from("public_atlas").select("*"),
    db.from("public_stats").select("*").single(),
    db.from("briefs").select("body, created_at").eq("kind", "atlas").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (last && Date.now() - Date.parse(last.created_at) < FRESH_MS) return json({ brief: last.body, generated_at: last.created_at, cells, stats });
  if (!cells?.length) return json({ brief: null, cells: [], stats });

  try {
    const meta = new MetaClient(env("MODEL_API_KEY"));
    const brief = await meta.chatJSON({
      system: `You are Atlas, ECO's climate-intelligence analyst. Write a brief for climate funders and impact investors from ECO's verified data.
Use ONLY the numbers given. Each cell is ~5 km: verified actions, trees, trees confirmed alive after 30 days, cleanups, recycling, claims held back by checks, integrity (share of checked claims that passed), ECOIN paid, recyclable units traded.
headline ≤14 words. summary ≤70 words. fund_next: up to 3 cells (use their lat/lng exactly) where more funding would buy the most verified action, with a one-sentence why.
risks: up to 3 (e.g. low integrity, low survival, thin data). data_gaps: up to 3. Plain language; no hype; no invented facts.`,
      user: JSON.stringify({ totals: stats, cells }),
      name: "atlas_brief",
      schema: SCHEMA,
    });
    const { data: saved } = await db.from("briefs").insert({ kind: "atlas", body: brief }).select("created_at").single();
    return json({ brief, generated_at: saved?.created_at ?? new Date().toISOString(), cells, stats });
  } catch (e) {
    console.error("atlas brief failed", String(e));
    return json({ brief: last?.body ?? null, generated_at: last?.created_at ?? null, cells, stats });
  }
});
