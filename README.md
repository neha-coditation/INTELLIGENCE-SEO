# Coditation SEO Intelligence — Cloudflare Free-Tier Starter

A standalone, no-n8n web app for **live technical SEO** and **user-supplied backlink/off-page verification**. Uses **Cloudflare Workers + HTMLRewriter + D1**. There is no OpenAI API or paid SEO API in this starter.

## What actually works

- Password-protected web dashboard, responsive desktop/mobile UI.
- Sitemap-first discovery and small-batch website crawling on **Coditation only** (www and apex host variants).
- HTTP errors, redirects, title, description, H1, canonical, basic social metadata, HTML language, noindex meta, image alt and JSON-LD presence checks.
- Same-site links, internal link discovery, downstream 404 alerts and duplicate-title checks on completed scans.
- Persistent run history, pages, issues, status review, and CSV export in D1.
- Backlink inventory: add URLs manually or upload a CSV; inspect source page HTML to check whether a known link exists and whether its `rel` includes `nofollow`, `sponsored`, or `ugc`.
- Manual audits plus **Monday 09:00 IST** weekly schedule; the 2-hour cron continues incomplete jobs in small batches.
- Security: fail-closed HTTP Basic authentication (set secret), protected static assets/API, configured-target-only crawling, HTTPS-only external backlink checks, blocked local/IP hosts, no automatic production fixes.

## What this starter does NOT provide

- No autonomous discovery of every backlink on the internet. GSC has no public backlinks-report API; import links from GSC's **Links** report (CSV) or your own spreadsheet instead.
- No automatic GA4/GSC authorization. The Integrations screen explicitly shows them as **Not connected**; these can be added later with OAuth.
- No AI-generated recommendations. Deterministic guidance works without Ollama. A local Ollama model can be added later via a secure gateway—not a publicly exposed Ollama port.
- No Google indexing status: the crawl examines server-returned HTML, not Googlebot's rendering or Google's index.
- No full JavaScript-rendered pages, arbitrary external link discovery, backlink "authority scores", unlimited crawling, automatic page edits, or outreach email sending.
- No production-hosted URL until you deploy into your own Cloudflare account.

## Requirements

- Node.js 20+
- Free Cloudflare account (Workers and D1 enabled)
- `npm install` (one-time download of the `wrangler` developer tool)
- No n8n instance and no OpenAI key

## 1. Run locally

```bash
npm install
cp .dev.vars.example .dev.vars
# IMPORTANT: replace ADMIN_PASSWORD in .dev.vars with a random password of 12+ characters
# IMPORTANT: configure a local D1 database_id in wrangler.jsonc as needed
npx wrangler d1 migrations apply coditation-seo-db --local
npm run dev
```

Open the URL shown in the terminal (typically `http://localhost:8787`). Authenticate with the `ADMIN_USER` and `ADMIN_PASSWORD` in `.dev.vars`.

Demo UI without API calls: append `?demo=1` to the local dashboard URL (you must still authenticate). Every preview record is clearly labeled fictional; you cannot publish or verify it.

**Important:** Your D1 configuration's `database_id` must contain a valid UUID to deploy remotely. Create the remote database below before your first deployment. For local development, Wrangler may require a correctly formatted placeholder or the remote database ID even with `--local`.

## 2. Deploy free to Cloudflare

```bash
npx wrangler login
npx wrangler d1 create coditation-seo-db
```

Copy the printed `database_id` into the `d1_databases[0].database_id` field of `wrangler.jsonc` (keep the `binding` set to `DB`).

```bash
npx wrangler d1 migrations apply coditation-seo-db --remote
npx wrangler secret put ADMIN_USER
npx wrangler secret put ADMIN_PASSWORD
npm run deploy
```

For `ADMIN_USER`, you can use `admin`. For `ADMIN_PASSWORD`, use a unique random value of 16+ characters. Secrets are typed in the terminal and are not committed to your repository.

The deployment returns a `*.workers.dev` website URL for your dashboard. It is *not* a public Coditation page, and your website's existing deployment remains unchanged.

Optionally connect a separate custom subdomain, e.g. `seo.coditation.com`, after authorization from the owner.

### Note on setting secrets

Set secrets before deploying (after creating the Worker if Wrangler requests it). If the first `wrangler secret put` prompts you to create a Worker, follow the prompt. If you encounter a "Worker not found" error, run `npm run deploy` once (it will remain access-denied until the secrets are set), then put both secrets. The Worker deliberately refuses all requests if the password is missing/short.

## 3. First live run

1. Open the password-protected Cloudflare dashboard.
2. Choose **Configuration → Maximum Pages = 10**, then start the audit.
3. Watch the technical page and issue list populate. Results are **live** from `https://www.coditation.com/`.
4. The site may rate-limit automated requests: such errors are recorded as crawl/access failures rather than fabricated SEO issues.
5. Open **Off-page SEO → Track a backlink** or import your CSV of known referring pages, then choose **Check**.
6. Open **Audit History** and **Technical SEO → Export CSV** to review records.

For local quick sanity tests use:

```bash
npm test
```

## 4. Scheduled scans

Wrangler config includes:

```json
"triggers": { "crons": ["30 3 * * 1", "0 */2 * * *"] }
```

Cloudflare cron expressions are UTC. `30 3 * * 1` is **Monday at 09:00 IST**. The second trigger resumes open scans every 2 hours, processing up to 3 pages per invocation. While the dashboard is open, clicking **Run Live Audit** advances batches interactively for faster results.

### Free-tier limits and crawl realism

- Workers Free: typically 100,000 requests/day, 10ms CPU per invocation and a limited number of subrequests.
- D1 Free: 5 million rows read/day, 100,000 written/day, 5 GB total storage (subject to changes).
- Default maximum 40 URLs per audit, hard limit 75 (not a full enterprise-site crawl).
- HTML is capped at 640 KB/page; redirects are reported but not automatically followed; HTML-only parser does not render JavaScript.
- Be courteous to the audited site. Scheduled processing is intentionally spread out; the interactive run performs short sequential batches.
- Worker CPU/subrequest quotas and target rate limiting may still require a paid tier or a hybrid runner for large sites.

## 5. Backlink CSV format

```csv
Source URL,Target URL,Anchor Text
https://partner.example.com/blog/my-article,https://www.coditation.com/,AI consulting
https://example.org/resources,https://www.coditation.com/capability/data-engineering,Data engineering
```

Only **source URLs you enter** are verified. Link verification fetches the source document and looks for an anchor whose hostname/path matches the target. It records active, missing, redirected, or inaccessible—**not** PageRank, domain authority, or full backlink counts. The parser does not execute JS.

## 6. Where to add Google Search Console and GA4

Next phase: add protected Google OAuth 2.0 connection (encrypted token storage), Search Console Search Analytics and URL Inspection API, and GA4 Data API. Cloudflare D1 would hold page/date aggregates. Search Console is free within quotas; actual Google account permissions and OAuth consent configuration are required. Do not use a Google API key alone for private reports.

## 7. Production hardening before team-wide access

- Replace Basic Auth with **Cloudflare Access** (identity login and MFA), with an application-specific policy protecting the whole dashboard.
- Add per-user audit roles and access logs for a team installation.
- Add complete robots directive handling, configurable request rate, retries, canonical status checks and verification re-fetch endpoints.
- Isolate crawling in a dedicated queue-backed worker for larger sites and abuse resilience.
- Add SEO issue fingerprints across runs and change detection; current issue statuses are per run.
- Enable Google OAuth only after securely planning token encryption and rotation.
- Consider a separate Python crawler on your own laptop/VM for deep crawling, retaining Cloudflare as the dashboard and data store.

## Architecture

```text
Browser  ──>  Cloudflare Worker (password protected)
                  │             │
                  │             ├── Static dashboard assets
                  │             ├── API /api/runs + /api/issues
                  │             ├── HTTPS fetch + HTMLRewriter
                  │             ├── Backlink HTML verification
                  │             └── UTC Cron triggers
                  │
                  └──── Cloudflare D1
                            ├── runs
                            ├── queue
                            ├── pages
                            ├── links
                            ├── issues
                            └── backlinks
```
