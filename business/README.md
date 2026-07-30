# Business portal (GitHub Pages)

Static venue dashboard for **Bttr Nghts** business accounts. Hosted on Pages; auth and payments run on your existing API.

## Abuse / spam protection

Server (authoritative):

- Per-IP ceiling on all `/api/web/*` (`WEB_PORTAL_IP_MAX`, default 90/min)
- Login: 8 attempts/min/IP, per-phone lockout, per-IP spray lockout, jittered fail delay
- Successful login minting capped per account (`WEB_ACCOUNT_LOGIN_SUCCESS_MAX`, default 6/min)
- Concurrent refresh sessions capped per account (`AUTH_MAX_SESSIONS_PER_ACCOUNT`, default 12; oldest revoked)
- `Retry-After` on 429 responses
- Security headers (`nosniff`, `DENY` framing, HSTS in production)
- Map tiles never hit the API (S3 only)
- Opening many static tabs (GitHub Pages HTML/JS/CSS) does not hit the API; only `/api/*` calls do — and those are IP-capped above

Browser (UX layer, not a substitute for server limits):

- Login / OTP / signup cooldowns with exponential backoff (survives reload via `sessionStorage`)
- Double-submit locks + mutating request queue
- Skips rapid `/me` probes after known logged-out state
- Overview refresh throttled

For edge DDoS (volumetric), keep Cloudflare (or similar) in front of `api.betternights.app` with bot fight / rate limiting enabled — that is the real volumetric shield; this app layer stops application abuse.

## Maps (same as iOS — not through your API)

The portal uses **MapLibre + the same Protomaps PMTiles** archive as the iOS app:

- Style: `web/business/map/style-dark.json` (static on Pages)
- Tiles: `https://bttr-nghts-map-tiles.s3.us-east-2.amazonaws.com/...` (browser → S3)
- Glyphs/sprites: `protomaps.github.io`

**Map pans never hit `api.betternights.app`.** That keeps tile traffic off your Node process so a map DDoS cannot take down auth/payments. Optional hardening: put the S3 tile bucket behind CloudFront + WAF rate rules.

## Local testing

Do **not** open `index.html` via `file://` — browsers will show **Failed to fetch**.

**Easiest:** double-click **`Serve-Business-Portal.command`** in the repo root.  
It serves `web/` on port 5500 with a **same-origin `/api` proxy** to production (bypasses Cloudflare OPTIONS hang), then opens:

`http://127.0.0.1:5500/business/?api=local`

Sign in with your real business account (Stripe Checkout works against production).

Optional local empty API (demo login only):

```bash
START_LOCAL_API=1 /Users/williamcleaves/Desktop/Better-Nights-main/Serve-Business-Portal.command
```

### Why “Failed to fetch” happened

The portal uses `credentials: 'include'` for HttpOnly cookies. If the API answered with `Access-Control-Allow-Origin: *`, browsers block the response. The API now reflects the request `Origin` (and still allowlists `CORS_ORIGIN` when set). Redeploy/restart the API for this fix against production.

## Pages layout

```
web/business/
  index.html          ← sign in / create account
  onboarding.html     ← venue setup, verification, PIN
  app.html            ← Overview / Event / Map / Info
  css/portal.css
  js/
    config.js         ← public API base URL only (no secrets)
    api.js            ← cookie + CSRF fetch helper
    auth-page.js
    onboarding.js
    app.js
  README.md
```

## Deploy to betternights.app (GitHub Pages)

The marketing site is already on Pages. The business portal is **not** live yet (`/business/` returns 404 until you copy it up).

### 1. Copy portal into your Pages repo

```bash
# From your website / GitHub Pages repo root (the one that publishes betternights.app)
cp -R /Users/williamcleaves/Desktop/Better-Nights-main/web/business ./business
git add business
git commit -m "Add business portal"
git push
```

After Pages builds:

- `https://betternights.app/business/`
- `https://betternights.app/business/app.html`

### 2. Required before login works from Pages

Browsers send a CORS **OPTIONS** preflight to `api.betternights.app`. Cloudflare is currently **dropping those OPTIONS requests**, so Sign in / Start Event hang with a grey button.

Pick **one** fix:

**A (recommended). Cloudflare Worker** — deploy [`server/cloudflare-api-cors-worker.js`](../../server/cloudflare-api-cors-worker.js) on route `api.betternights.app/*` (answers OPTIONS instantly, proxies the rest to your EC2 origin). Set Worker vars `ORIGIN_URL=http://YOUR_EC2_IP` and `CORS_ORIGIN=https://betternights.app`.

**B. DNS-only (grey cloud)** on the `api` record in Cloudflare, and terminate HTTPS on the EC2 box (nginx + Let’s Encrypt). Traffic bypasses the broken CF OPTIONS path.

**C. Keep using local** `Serve-Business-Portal.command` (same-origin `/api` proxy) until A or B is done.

### 3. API env (EC2)

```bash
CORS_ORIGIN=https://betternights.app,http://127.0.0.1:5500,http://localhost:5500
BUSINESS_PORTAL_URL=https://betternights.app/business
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_BUSINESS_AMOUNT_CENTS=799
```

GitHub Actions deploy already upserts Stripe secrets when set in the API repo.

Prefer the custom domain (`betternights.app`) over `*.github.io` so cookies + CORS stay simple.

## Server env (required for the hybrid)

On the API host (`api.betternights.app`), set:

```bash
# Exact Pages origin(s), comma-separated — enables credentialed CORS
CORS_ORIGIN=https://betternights.app

# Where Stripe should redirect after Checkout
BUSINESS_PORTAL_URL=https://betternights.app/business

# Stripe (Dashboard → Developers → API keys + Webhooks)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
# Optional: use a Price ID, otherwise amount below is used
# STRIPE_BUSINESS_PRICE_ID=price_...
STRIPE_BUSINESS_AMOUNT_CENTS=799
STRIPE_BUSINESS_CURRENCY=usd
```

### Stripe Checkout setup (Workbench map)

The portal already implements Stripe’s one-time-payment blueprint. You configure keys and a webhook — you do **not** paste Workbench snippets into the repo.

| Stripe Workbench step | Our code | What you configure |
|---|---|---|
| 1. Create product + price | Optional. If `STRIPE_BUSINESS_PRICE_ID` is unset, the API uses inline `price_data` ($7.99 / 799¢) | Optional: Product catalog → Add product → copy `price_…` |
| 2. Create Checkout Session (`mode: payment`) | `POST /api/web/promotions/checkout` → redirect to `session.url` | `BUSINESS_PORTAL_URL` for success/cancel |
| 3. Handle `checkout.session.completed` | `POST /api/stripe/webhook` + publish redeem with `session_id` | Register webhook + `whsec_…` |

**Keys (API host only — never in `web/business/` or git):**

| Env / key | Needed? |
|---|---|
| `STRIPE_SECRET_KEY` (`sk_test_…` / `sk_live_…`) | **Yes** |
| `STRIPE_WEBHOOK_SECRET` (`whsec_…`) | **Yes** |
| `STRIPE_BUSINESS_PRICE_ID` (`price_…`) | Optional (else `STRIPE_BUSINESS_AMOUNT_CENTS`) |
| Publishable key (`pk_…`) | **No** — hosted Checkout redirect, no Stripe.js |
| `BUSINESS_PORTAL_URL` + `CORS_ORIGIN` | Yes |

**Ops checklist**

1. Dashboard → API keys → set `STRIPE_SECRET_KEY` (start with test). If a key was ever pasted into chat or a public place, rotate it first.
2. Optional: Test mode → Product catalog → Products → Add product (one-time USD) → set `STRIPE_BUSINESS_PRICE_ID`, or leave cents fallback at $7.99.
3. Webhooks → Add endpoint `https://api.betternights.app/api/stripe/webhook` → event `checkout.session.completed` (optionally `checkout.session.async_payment_succeeded`) → set `STRIPE_WEBHOOK_SECRET`.
4. Set `BUSINESS_PORTAL_URL` (e.g. `https://betternights.app/business`) and `CORS_ORIGIN`.
5. Put the same values in **GitHub → repo Settings → Secrets** (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, optional price/portal/CORS). Deploys to EC2 upsert them into the server `.env` and restart.
6. Redeploy API (`NODE_ENV=production`); smoke-test **Start Event** → Stripe Checkout → event goes live. Edits of an owned live event stay free.

Until `STRIPE_SECRET_KEY` is on the API host, **Start Event** will explain that checkout is not configured (it will no longer silently fail with “purchase required”).

Local/dev without Stripe: `NODE_ENV` not `production` still allows unpaid publish (same as iOS StoreKit mock path).

## How auth works (simple hybrid)

1. Browser posts phone + password to `POST /api/web/auth/login`.
2. API sets **HttpOnly** session cookies (`bn_at`, `bn_rt`) plus a readable CSRF cookie (`bn_csrf`).
3. Portal JS calls APIs with `credentials: 'include'` and header `X-CSRF-Token`.
4. No access/refresh tokens are stored in `localStorage`.

## Override API base (optional)

Before `config.js`, you can set:

```html
<script>window.BN_API_BASE = 'https://api.betternights.app';</script>
```

## Mobile / iPad / desktop

- **&lt;900px (phone / iPad):** floating capsule tab bar sized like the iOS business app (~78px hits, SF-style icons).
- **≥900px (desktop):** sticky left rail with rectangular nav buttons and denser dashboard/login chrome. Touch targets and safe-area padding remain for notched phones.
