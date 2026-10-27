# Deploying ECO · Proof of Planet (free tiers only)

You need three things: a **Supabase** project, a **Meta developer app** with WhatsApp, and a **Meta Model API** key.
The website is hosted on GitHub Pages from this repo, and the backend deploys from GitHub Actions. No keys ever go into chat or code.

## 1. Supabase (database, storage, functions)

1. Create a free project at supabase.com. From **Project Settings**, note:
   - the **Project URL**
   - the **anon key**
   - the **project ref** (the id in the URL)
   - the **database password** you chose
2. Create an access token at supabase.com → Account → Access Tokens.
3. GitHub repo → Settings → Secrets and variables → Actions. Add `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` and `SUPABASE_DB_PASSWORD`.
4. Run **Actions → Deploy backend → Run workflow**. It applies the schema and deploys the `whatsapp`, `simulate` and `atlas` functions.
5. In Supabase, go to **Edge Functions → Secrets** and add:

| Secret | Value |
|---|---|
| `MODEL_API_KEY` | Meta Model API key (Standard mode): SAM 3.1, Muse Spark 1.3, Muse Image |
| `BASETEN_API_KEY` | Baseten hackathon key for **Muse Spark Open** (Meta's open-weight model). Works on its own if the Meta key isn't ready yet. |
| `CHAT_PROVIDER` | optional: `baseten` to run the agent and reasoning on Muse Spark Open even when the Meta key is set |
| `PUBLIC_URL` | `https://<github-user>.github.io/proof-of-planet` |
| `WHATSAPP_TOKEN` | WhatsApp access token (a temporary token works for the demo) |
| `WHATSAPP_PHONE_NUMBER_ID` | From WhatsApp → API Setup |
| `WHATSAPP_APP_SECRET` | App settings → Basic → App secret |
| `WHATSAPP_VERIFY_TOKEN` | Any random string you choose |
| `OPS_PHONES` | Comma-separated WhatsApp numbers of ECO reviewers (digits only) |
| optional caps | `SIM_DAILY_CAP` (300), `MESSAGES_PER_DAY` (80), `VERIFICATIONS_PER_DAY` (10) |

## 2. WhatsApp Cloud API

1. Go to developers.facebook.com → Create app → Business, then add **WhatsApp**. Meta gives you a free test number.
2. In WhatsApp → API Setup, add up to 5 recipient phones (yours, plus a second phone for the shop or business). Copy the temporary token and the phone number ID.
3. In WhatsApp → Configuration → Webhook:
   - Callback URL: `https://<ref>.supabase.co/functions/v1/whatsapp`
   - Verify token: your `WHATSAPP_VERIFY_TOKEN`
   - Subscribe to **messages**.
4. Send "hi" to the test number.

## 3. Website (GitHub Pages)

1. In `web/config.js`, set `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `WHATSAPP_NUMBER` (digits only). The anon key is public by design: it can only read the `public_*` views.
2. Repo → Settings → Pages → Source: **GitHub Actions**. Every push to `main` runs the tests and publishes `web/`.

## Before submitting

- Open the repo in a logged-out browser window.
- Make sure `bun test` passes.
- Run `bun run audit` once with the key, then commit `evals/`.
