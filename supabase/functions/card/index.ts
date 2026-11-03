// Proof Card: GET ?claim=<id> or ?trade=<id>. Paints a Muse Image card the first time a verified outcome's card is
// opened, then serves the cached one. Only verified claims and settled trades get a card; one card per outcome.
import { claimFacts, proofCardPrompt, tradeFacts } from "../_core/proofcard.ts";
import { cors, env, json, makeDeps } from "../_shared/deps.ts";

const ID = /^[0-9a-f-]{36}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const u = new URL(req.url);
  const claimId = u.searchParams.get("claim"), tradeId = u.searchParams.get("trade");
  const id = claimId ?? tradeId;
  if (!id || !ID.test(id)) return json({ error: "claim or trade id required" }, 400);
  const deps = makeDeps({ messagesPerDay: 0, verificationsPerDay: 0 });
  const { store } = deps;
  const kind = `card:${claimId ? "claim" : "trade"}:${id}`;

  let facts, subject;
  if (claimId) {
    const c = await store.claim(id);
    if (!c || c.status !== "consistent") return json({ error: "Proof Cards are made only for verified actions." }, 404);
    facts = claimFacts(c, deps.publicUrl, await store.adoptionOf(c.id)); subject = { kind: "claim" as const, protocol: c.protocol };
  } else {
    const t = await store.trade(id);
    if (!t || !["released", "settled"].includes(t.status)) return json({ error: "Proof Cards are made only for completed trades." }, 404);
    facts = tradeFacts(t, deps.publicUrl); subject = { kind: "trade" as const, material: t.material };
  }

  const { data: cached } = await store.db.from("briefs").select("body, created_at").eq("kind", kind).limit(1).maybeSingle();
  if (cached) return json({ ...cached.body, facts, generated_at: cached.created_at });

  if ((await store.bump("proof_cards")) > Number(env("CARD_DAILY_CAP", "60"))) return json({ facts, path: null, note: "Today's card limit is reached; the facts are still verified." });
  try {
    const prompt = proofCardPrompt(subject);
    const bytes = await deps.meta.generateImage(prompt);
    const path = await store.savePhoto(bytes, "image/png");
    const body = { path, model: "muse-image-1.0", prompt };
    await store.db.from("briefs").insert({ kind, body });
    return json({ ...body, facts });
  } catch (e) {
    console.error("proof card failed", String(e));
    return json({ facts, path: null, note: "The artwork couldn't be painted right now; the verified facts stand." });
  }
});
