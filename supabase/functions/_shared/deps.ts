// Wires the agent to Supabase, the Meta Model API and the environment.
import type { AgentDeps } from "../_core/agent.ts";
import { MetaClient } from "../_core/meta.ts";
import { SupabaseStore } from "./supabase-store.ts";

export function env(name: string, fallback?: string): string {
  const v = Deno.env.get(name) ?? fallback;
  if (v === undefined) throw new Error(`Missing secret ${name}`);
  return v;
}

export function makeDeps(limits: AgentDeps["limits"]): AgentDeps & { store: SupabaseStore } {
  const store = new SupabaseStore();
  const meta = new MetaClient(env("MODEL_API_KEY"));
  meta.onCall = (e) => console.log(JSON.stringify({ meta_call: e }));
  return {
    store,
    meta,
    publicUrl: env("PUBLIC_URL", "https://example.github.io/eco-climate-os"),
    limits,
    log: (event, data) => console.log(JSON.stringify({ event, data })),
  };
}

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
