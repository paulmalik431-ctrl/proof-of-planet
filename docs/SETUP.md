# Deploying ECO (free tiers only)

You need three accounts, all free: **Supabase**, a **Meta developer app** with WhatsApp, and the **Meta Model API** key.
The web pages are hosted on GitHub Pages from this repo.

## 1. Supabase (database, storage, functions)

1. Create a project at supabase.com (free plan). Note the **Project URL**, the **anon key** and the **project ref** (Settings → API).
2. Apply the schema. Either:
   - SQL editor → paste `supabase/migrations/20261026200000_eco_init.sql` → Run, or
   - `supabase link --project-ref <ref> && supabase db push`.
3. Deploy the functions:
   ```bash
   supabase functions deploy whatsapp --no-verify-jwt
   supabase functions deploy simulate --no-verify-jwt
   ```
4. Set the secrets (Edge Functions → Secrets, or `supabase secrets set`):

| Secret | Value |
|---|---|
| `MODEL_API_KEY` | Meta Model API key (Standard mode) |
| `PUBLIC_URL` | `https://<github-user>.github.io/eco-climate-os` |
| `WHATSAPP_TOKEN` | WhatsApp access token (temporary token works for the demo; system-user token for long-lived) |
| `WHATSAPP_PHONE_NUMBER_ID` | From WhatsApp → API Setup |
| `WHATSAPP_APP_SECRET` | App settings → Basic → App secret |
| `WHATSAPP_VERIFY_TOKEN` | Any random string you choose |
| optional: `SIM_DAILY_CAP`, `MESSAGES_PER_DAY`, `VERIFICATIONS_PER_DAY` | Cost caps (defaults 400 / 60 / 8) |

## 2. WhatsApp Cloud API

1. developers.facebook.com → Create app → Business → add **WhatsApp**. Meta gives you a free test number.
2. WhatsApp → API Setup: add your own phone as a recipient. Copy the temporary token and the phone number ID.
3. WhatsApp → Configuration → Webhook:
   - Callback URL: `https://<ref>.supabase.co/functions/v1/whatsapp`
   - Verify token: the same `WHATSAPP_VERIFY_TOKEN`
   - Subscribe to **messages**.
4. Send "hi" to the test number.

## 3. Web pages (GitHub Pages)

1. Edit `web/config.js`: `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `WHATSAPP_NUMBER` (digits only).
2. Repo → Settings → Pages → Source: **GitHub Actions**. Every push to `main` runs the tests and publishes `web/`.

## Checks before submitting

- Open the repo in a logged-out browser window.
- `bun test` passes.
- Run `bun run audit` once with the key and commit `evals/`.
