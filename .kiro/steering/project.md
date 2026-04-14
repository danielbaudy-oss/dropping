---
inclusion: always
---

# Dropping — Price Alert Web App

## What it is
A price tracker for Uniqlo, ARKET, COS, and Mango. Users add products via a web frontend, and the backend checks prices on a schedule. When prices drop, users get Telegram notifications. There's also a Uniqlo sale monitor that sends daily digests of new sale items matching user size/gender filters.

## Architecture
- Backend: Google Apps Script (`.gs` files, edited locally as `.js`)
- Frontend: `index.html` hosted on GitHub Pages
- Notifications: Telegram Bot API
- Database: Google Sheets (Config, Users, Products, PriceHistory, Notifications)

## Files
- `Code.js` — Web app entry point (`doGet`), API handlers
- `Database.js` — Sheet CRUD, user auth, product management
- `Telegram.js` — `sendMessage`, `sendPhoto` with fallback
- `PriceChecker.js` — Scheduled price checks, batch updates, drop notifications
- `ArketStore.js` — ARKET scraping, shared HTML parsers, `getCurrencyInfo`
- `CosStore.js` — COS scraping (reuses ARKET's fetch/parse)
- `MangoStore.js` — Mango API-based scraping
- `Uniqlo.js` — Uniqlo API integration
- `UniqloSales.js` — Sale page monitor, size/color filtering, daily digest
- `Setup.js` — Install, triggers, debug/test functions
- `index.html` — Frontend SPA (GitHub Pages)

## Deployment
- `clasp push` — pushes `.js` files to Apps Script as `.gs`
- `clasp pull` — pulls latest from Apps Script
- `git push origin main` — pushes to GitHub (includes `index.html`)
- Redeploy in Apps Script only needed when `Code.js` changes (new deployment version)
- Triggers run against HEAD, no redeploy needed for schedule changes

## Key patterns
- Currency maps are per-store (ARKET, COS, Mango each have their own)
- `getCurrencyInfo()` in ArketStore.js is the shared currency symbol resolver
- ARKET/COS share the same H&M Group Next.js platform — shared HTML parsers
- Proxy fetching for sites behind Akamai (ARKET, COS, Mango)
- Frontend does client-side fetching via CORS proxies, falls back to backend
- Sale alerts: daily digest header + individual item cards with size→color matrix
