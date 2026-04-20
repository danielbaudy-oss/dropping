# dropping

Price tracker for Uniqlo, ARKET, COS, and Mango. Get Telegram alerts when products you're watching drop in price, plus daily digests of new items on the Uniqlo sale page matching your size.

## Architecture

- **Frontend** — `index.html` (GitHub Pages), talks directly to Supabase
- **Database** — Supabase Postgres (`dropping` schema), with Row-Level Security keyed by Telegram Chat ID
- **Scraper** — Node.js worker on a Raspberry Pi, runs via cron, uses residential IP to bypass anti-bot blocks
- **Notifications** — Telegram Bot API
- **Auth** — Chat ID + 6-digit code sent via Telegram → session token (30-day expiry)

## Local dev

```bash
# Frontend — just open index.html in a browser or serve with any static server
python -m http.server 8000

# Pi scraper — run a job manually
cd pi-scraper
export SUPABASE_URL=https://<project>.supabase.co
export SUPABASE_SERVICE_KEY=<service-role-key>
node src/jobs/check-uniqlo.js
```

## Deploy

- Frontend: `git push origin main` — GitHub Pages auto-publishes
- Pi scraper: `scp -r pi-scraper/* baudy@baudypi.local:~/pi-scraper/`
- Edge Functions: `supabase functions deploy <name>`
