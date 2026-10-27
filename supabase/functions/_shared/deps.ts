// Wires the agent to Supabase, the Meta Model API, WhatsApp and the environment.
import type { AgentDeps } from "../_core/agent.ts";
import { clientFromEnv } from "../_core/meta.ts";
import { sendText, type WaConfig } from "../_core/whatsapp.ts";
import { SupabaseStore } from "./supabase-store.ts";

export function env(name: string, fallback?: string): string {
  const v = Deno.env.get(name) ?? fallback;
  if (v === undefined) throw new Error(`Missing secret ${name}`);
  return v;
}

/** Simulator numbers start with 999 (not a real country code): a sandbox that shares the real ledger rules. */
export const SANDBOX_PREFIX = "999";
export const isSandbox = (phone: string) => phone.startsWith(SANDBOX_PREFIX);

export const wa: WaConfig = {
  token: env("WHATSAPP_TOKEN", ""),
  phoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID", ""),
  version: env("WHATSAPP_API_VERSION", "v23.0"),
};

export function makeDeps(limits: AgentDeps["limits"]): AgentDeps & { store: SupabaseStore } {
  const store = new SupabaseStore();
  const meta = clientFromEnv((k) => Deno.env.get(k));
  meta.onCall = (e) => console.log(JSON.stringify({ meta_call: e }));
  return {
    store,
    meta,
    publicUrl: env("PUBLIC_URL", "https://paulmalik431-ctrl.github.io/proof-of-planet"),
    limits,
    isSandbox,
    // Messages to other people: WhatsApp for real numbers, the simulator inbox for sandbox numbers.
    notify: async (accountId, text) => {
      const a = await store.accountById(accountId);
      if (!a) return;
      if (isSandbox(a.phone) || !wa.token) return store.enqueue(accountId, text);
      try { await sendText(wa, a.phone, text); } catch (e) { console.error("notify failed", String(e)); await store.enqueue(accountId, text); }
    },
    log: (event, data) => console.log(JSON.stringify({ event, data })),
  };
}

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
