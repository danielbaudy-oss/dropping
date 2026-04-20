---
inclusion: always
---

# Dropping — Price Alert Web App

## What it is
A price tracker for Uniqlo, ARKET, COS, and Mango. Users add products via a web frontend, the Pi scrapes on schedule, and drops trigger Telegram notifications. There's also a daily Uniqlo sale monitor that sends digests of new sale items matching user size/gender filters.

## Architecture
- **Frontend**: `index.html` single-page app, hosted on GitHub Pages, talks directly to Supabase
- **Database + API**: Supabase (MIKAN project, `dropping` schema) — Postgres, PostgREST, Edge Functions, RLS
- **Scraper worker**: Node.js app on a Raspberry Pi (`pi-scraper/`), runs via cron, uses residential IP
- **Notifications**: Telegram Bot API (called from Pi and from auth Edge Functions)
- **Auth**: Chat ID + 6-digit Telegram verification code → session token stored in `dropping.sessions`, sent as `x-session-token` header, enforced by RLS

## Repo layout
- `index.html` — frontend SPA (GitHub Pages)
- `pi-scraper/` — Node.js worker that runs on the Pi
  - `src/stores/` — per-store scrapers (uniqlo, hm-group, mango, uniqlo-sales)
  - `src/jobs/` — cron-triggered entry points (check-uniqlo, check-arket, check-cos, check-mango, check-uniqlo-sales, refresh-product-cache)
  - `src/db.js` — Supabase client wrapper (uses service role key)
  - `src/telegram.js` — Telegram API
  - `src/price-check.js` — core price-check engine used by all store jobs
  - `run-job.sh` — cron wrapper that loads env
  - `crontab.txt` — cron schedule
  - `.env` — `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (not committed)
- `supabase/functions/` — Edge Functions
  - `auth-request-code/` — sends 6-digit code via Telegram
  - `auth-verify-code/` — verifies code and issues session token
- `.kiro/steering/` — project context for Kiro

## Supabase schema (`dropping`)
- `users` — chat_id PK, size prefs, sale prefs, region
- `products` — user's watched products (color, size, price, URL, store)
- `price_history` — time-series of price checks
- `notifications` — log of sent drop alerts
- `sale_cache` — previously-seen Uniqlo sale items per region/gender
- `product_cache` — full scraped product JSON (colors/sizes/stock), populated by Pi, read by frontend edit modal
- `config` — key/value (bot_token)
- `auth_codes` — short-lived Telegram verification codes
- `sessions` — active session tokens (token → chat_id, 30-day expiry)
- `current_chat_id()` — SECURITY DEFINER function that reads `x-session-token` header and returns the chat_id, used in RLS policies

## Deployment
- **Frontend**: `git push origin main` → GitHub Pages auto-publishes `index.html`
- **Pi scraper**: `scp pi-scraper/* baudy@baudypi.local:~/pi-scraper/` then `ssh baudy@baudypi.local "cd ~/pi-scraper && npm install"`
- **Edge Functions**: deploy via Supabase MCP `deploy_edge_function` or CLI `supabase functions deploy <name>`
- **DB migrations**: apply via Supabase MCP `apply_migration`

## Cron schedule (Pi, local time)
- 06:00 — refresh product_cache (full product data for all active products)
- 07:00 — Uniqlo price check
- 07:15, 13:15, 20:15 — ARKET
- 07:30, 13:30, 20:30 — COS (often Akamai-blocked)
- 07:45, 13:45, 20:45 — Mango
- 08:00 — Uniqlo sales digest

## Key patterns
- **Residential IP** on the Pi bypasses most anti-bot blocks for Uniqlo, ARKET, Mango. COS is still occasionally Akamai-blocked.
- **Pi writes full product data** to `product_cache` so the frontend edit modal is instant.
- **RLS** scopes data per user via `current_chat_id()` function that reads the `x-session-token` header.
- **Service role key** on the Pi bypasses RLS for bulk operations.
- **Anon key** on frontend can only access rows the session owns.
- Color names like "62 BLUE" are cleaned to "Blue" by `cleanColorName`.
- Uniqlo sale colors often live in price group `01`, not `00` — sales monitor checks both.

## Gotchas
- `current_chat_id()` must be `STABLE` (no UPDATE) — don't try to track last-used timestamps inside it.
- PostgREST only exposes custom headers via `current_setting('request.headers', true)::jsonb`, and the schema must be in the `pgrst.db_schemas` setting (done in a migration).
- SSH into the Pi: `ssh baudy@baudypi.local` (passwordless via key).
