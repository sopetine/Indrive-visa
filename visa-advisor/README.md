# Visa Advisor

> Open-source web app that returns current visa requirements for any (nationality, arrival, destination) — sourced from Wikipedia, IATA, and official `.gov` sites.
>
> **Status:** Live. Powered by **MiniMax M3** via a Cloudflare Worker proxy that holds the API key. See [How it works](#how-it-works).

---

## What it does

A user enters free-form text:

- **Nationality** (their passport) — e.g. "Russian", "American"
- **From** (country they're currently based in / where they'll apply from) — e.g. "Georgia", "Turkey"
- **Destination** (city) — e.g. "Tbilisi", "Istanbul"
- **Comments** (optional) — e.g. dual citizenship, layover, diplomatic passport

The app auto-fills the arrival date (today) and trip purpose (business) so the form stays tight. The LLM gets the optional free-form comments for context. The `From` field tells the advisor where to apply (e.g. for Schengen, consulate jurisdiction = country of legal residence).

The app returns a structured report:

- Visa status (visa-free / eTA / eVisa / VOA / embassy / restricted)
- Allowed stay, passport-validity rule, fee, processing time
- Required documents — **each bullet has a "Verify on {source}" link to the URL the LLM actually read**
- Official application link (only `.gov` / official)
- Exception rules, travel advisories (collapsible, with verify links)
- **"Before you book" numbered checklist** — color-coded by critical type (money / deadline / entry / doc / stale), each step links to its source
- Sources (live from web search)
- ⚠️ Caveats callout when applicable
- Disclaimer (always last)

Research is **live**, not from the LLM's training data: the Worker calls the OpenAI Responses API (`/v1/responses`) with the server-side `web_search` tool. MiniMax M3 actually fetches Wikipedia, IATA Travel Centre, and the destination's official `.gov` site, and attaches a `url_citation` annotation to every grounded claim. The UI maps those annotations to bullet character ranges and appends a hover-tooltip verify link to each one. Each query takes ~30–90 seconds.

See [`visa-advisor-functional-spec.md`](./visa-advisor-functional-spec.md) for the full functional spec and [`visa-advisor-prompt.md`](./visa-advisor-prompt.md) for the system prompt you should send to the LLM.

---

## Run locally

No build step. Serve the directory over HTTP (ES modules require a server):

```bash
# From this directory
python3 -m http.server 8080
# or
npx serve .

# Then visit
open http://localhost:8080
```

You should see the disclaimer modal on first load. Accept it to reach the form. Fill in your nationality, arrival country, and destination city, hit **Check requirements** — you'll get a mock report (since no LLM is wired yet).

---

## File tree

```
.
├── visa-advisor/                 ← static site (deployed to GitHub Pages)
│   ├── index.html                ← SPA shell (form + report views, hash routing)
│   ├── README.md                 ← This file
│   ├── LICENSE                   ← MIT
│   ├── .gitignore
│   ├── visa-advisor-prompt.md    ← System prompt sent to the LLM (fetched at runtime)
│   ├── css/
│   │   ├── tokens.css            ← Design tokens (from inDrive styleguide)
│   │   ├── reset.css             ← Modern CSS reset
│   │   ├── base.css              ← Typography, container, badge
│   │   ├── buttons.css           ← Button system
│   │   ├── accessibility.css     ← A11y patches
│   │   └── advisor.css           ← Visa-advisor-specific styles + stepper
│   └── js/
│       ├── countries.js          ← ~120 country list + sanctioned set
│       ├── api.js                ← Calls the Worker proxy; fetches & caches system prompt
│       ├── ui.js                 ← Form, modal, stepper, report renderer
│       └── main.js               ← Bootstrap + hash router
└── worker/                       ← Cloudflare Worker proxy (hides the LLM API key)
    ├── package.json
    ├── wrangler.toml
    ├── .dev.vars.example         ← Template for local secrets (gitignored)
    └── src/
        └── index.js              ← Edge handler: CORS → prompt fetch → LLM call → response
```

The first five CSS files are **copied verbatim** from the inDrive styleguide (`../css/`) — the inDrive design language is the visual source of truth. If you update the inDrive files, propagate the changes here.

---

## Tech stack

| Layer | Choice | Rationale |
|---|---|---|
| Markup | Plain HTML5 | No framework overhead |
| Styling | Hand-authored CSS + design tokens | Matches styleguide, no preprocessor |
| JS | Vanilla ES2020 modules | No build step, no bundler |
| State | `localStorage` + `sessionStorage` | Spec §7 — no accounts, no backend history |
| Routing | `window.location.hash` | Works on any static host |

---

## Responsive

| Breakpoint | Layout |
|---|---|
| Mobile (< 540 px) | Single column, full-width buttons, status stack |
| Tablet (540–1024 px) | Single column, comfortable padding |
| Desktop (> 1024 px) | Narrow container (861 px) — focused reading |

Tested at 360, 414, 768, 1024, 1440 px. No horizontal scroll at any width.

---

## Accessibility

Built on top of the inDrive a11y baseline (skip link, `:focus-visible` rings, `prefers-reduced-motion`, `forced-colors`, safe-area insets) plus:

- **Combobox** — full ARIA combobox pattern: `role`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, keyboard nav (↑↓, Enter, Esc, Tab).
- **Live region** — `[aria-live="polite"]` announces "Visa report ready" and "Copied to clipboard".
- **Status badge** — icon accompanies color (not color-only signal).
- **Form errors** — inline, programmatic, announced via live region.
- **Modal** — `role="dialog"`, `aria-modal="true"`, focus moved to acknowledge button.
- **Headings** — single `<h1>` per view, strict h2/h3 outline in the report.

---

## How it works

```
Browser (GitHub Pages)            Cloudflare Worker (proxy)              MiniMax API
─────────────────────             ─────────────────────────              ────────────
visa-advisor/js/api.js ─POST───→ worker/src/index.js ───Bearer───→ /v1/responses
              ←JSON── { markdown, caveats?, critical[], annotations[] }
                                            ←tools: [{ type: 'web_search' }]
                                            ←annotations: span-level url_citations
        │
        └─fetch (cached)─→ visa-advisor/visa-advisor-prompt.md
```

The browser never sees the API key. The Worker holds it in `wrangler` secrets.

### What lives where

| File | Role |
|---|---|
| `visa-advisor/visa-advisor-prompt.md` | The full system prompt. **Edit this to change advisor behavior.** Fetched by the browser at runtime and sent to the Worker. |
| `visa-advisor/js/api.js` | Sets `API_ENDPOINT`, fetches & caches the prompt, POSTs form values to the Worker, normalizes the response. |
| `worker/src/index.js` | Edge handler: CORS preflight, validates the request, calls the LLM with `system` + `user` messages, unwraps the §9 JSON fence, returns the contract shape. |
| `worker/wrangler.toml` | Vars: `LLM_ENDPOINT`, `LLM_MODEL`, `ALLOWED_ORIGIN`. Secret: `LLM_API_KEY`. |
| `visa-advisor/index.html` + `ui.js` + `advisor.css` | The 3-step stepper ("Loading knowledge base → Consulting sources → Compiling report") replaces the old single pulse during live calls. |

### Response contract (enforced by the Worker)

The system prompt instructs the LLM to wrap its answer in a ```json fence (see §9 of `visa-advisor-prompt.md`). The Worker unwraps that fence and forwards:

```json
{
  "type": "report",
  "markdown":  "### Visa status\nVisa-free\n\n### 🚨 [MONEY] Fee\n~90 EUR\n\n### Required documents (typical)\n- Valid passport\n- Completed application form\n...",
  "caveats":   "Optional 1–3 sentences for the ⚠️ callout",
  "critical":  [
    { "label": "Fee",             "value": "~90 EUR",                                     "source": "[1][3]", "type": "money"    },
    { "label": "Processing time", "value": "15–45 calendar days",                         "source": "[3]",    "type": "deadline" }
  ],
  "annotations": [
    { "title": "Wikipedia — Visa policy of Romania",          "url": "https://en.wikipedia.org/wiki/Visa_policy_of_Romania",                 "start": 42,  "end": 87,  "snippet": "may enter Romania visa-free for a maximum of 90 days within any 180-day period" },
    { "title": "EU Schengen Visa Policy",                     "url": "https://home-affairs.ec.europa.eu/policies/schengen/visa-policy_en",  "start": 120, "end": 165, "snippet": "The standard Schengen visa fee is 90 EUR" }
  ],
  "searchQueries": [
    "Visa policy Romania Wikipedia",
    "Visa requirements for US citizens Wikipedia",
    "IATA Travel Centre Romania",
    "Schengen visa fee 2026 site:europa.eu",
    "Schengen visa processing time official",
    "Romania travel advisory US State Department",
    "Schengen 90/180 calculator",
    "Romania eVisa portal official",
    "US passport validity Schengen rule",
    "Recent Schengen fee change 2025 2026",
    "Romania US embassy guidance"
  ],
  "sources": [
    { "title": "Visa policy of Romania",                       "url": "https://en.wikipedia.org/wiki/Visa_policy_of_Romania",                "domain": "wikipedia.org" },
    { "title": "Visa requirements for United States citizens", "url": "https://en.wikipedia.org/wiki/Visa_requirements_for_United_States_citizens", "domain": "wikipedia.org" },
    { "title": "IATA Travel Centre — Romania",                 "url": "https://www.iatatravelcentre.com/passport-visas-health.php?country=RO", "domain": "iatatravelcentre.com" },
    { "title": "EU Schengen Visa Policy",                      "url": "https://home-affairs.ec.europa.eu/policies/schengen/visa-policy_en", "domain": "ec.europa.eu" },
    { "title": "Schengen 90/180 calculator",                   "url": "https://ec.europa.eu/assets/home/visa-calculator/calculator.htm?lang=en", "domain": "ec.europa.eu" },
    { "title": "US State Department — Romania travel advisory","url": "https://travel.state.gov/content/travel/en/international-travel/International-Travel-Country-Information-Pages/Romania.html", "domain": "travel.state.gov" },
    { "title": "Romania travel advisory — European Commission","url": "https://home-affairs.ec.europa.eu/policies/schengen/visa-policy_en", "domain": "ec.europa.eu" },
    { "title": "Romania MFA — consular fees",                  "url": "https://www.mae.ro/en/node/2110", "domain": "mae.ro" },
    { "title": "Wikipedia — Schengen Area",                    "url": "https://en.wikipedia.org/wiki/Schengen_Area", "domain": "wikipedia.org" },
    { "title": "Wikipedia — Visa requirements for US citizens","url": "https://en.wikipedia.org/wiki/Visa_requirements_for_United_States_citizens", "domain": "wikipedia.org" },
    { "title": "Schengen visa fee — 2026 update",              "url": "https://home-affairs.ec.europa.eu/news/schengen-visa-fee-increase-2026_en", "domain": "ec.europa.eu" },
    { "title": "Romania US Embassy guidance",                  "url": "https://ro.usembassy.gov/visas/", "domain": "usembassy.gov" },
    { "title": "IATA Timatic — passport validity",             "url": "https://www.iatatravelcentre.com/passport-visas-health.php", "domain": "iatatravelcentre.com" },
    { "title": "Wikipedia — Visa policy of Romania §US",       "url": "https://en.wikipedia.org/wiki/Visa_policy_of_Romania#United_States", "domain": "wikipedia.org" },
    { "title": "Romania Ministry of Foreign Affairs — visa info","url": "https://www.mae.ro/en/node/2110", "domain": "mae.ro" }
  ],
  "sourcesReturned": 15,
  "researchWarning": null
}
```

…or, if the LLM needs clarification (per §4 of the prompt):

```json
{ "type": "clarify", "question": "Which passport will you travel on?" }
```

The `markdown` field follows the section order in §2 of the prompt with `🚨 [TYPE]` prefixes on critical sections. The `critical[]` array drives the color-coded "Before you book" numbered checklist at the top of the report. The `annotations[]` array is the ground-truth provenance — each entry is a span-level `url_citation` returned by the API for one grounded claim (the LLM actually visited the URL via the `web_search` tool). The UI maps these annotations to bullet character ranges and appends a "Verify on {source}" hover-tooltip link to each bullet. Empty `annotations[]` triggers an "unverified" banner at the top.

**v0.5 deep-research envelope** — `searchQueries[]`, `sources[]`, `sourcesReturned`, `researchWarning`. Every query must perform **10–12 web searches** yielding **≥15 distinct URLs** in `sources[]`. `searchQueries[]` is the ordered list of queries the LLM actually executed. `sources[]` is the deduped list of URLs it consulted, with `title` + `url` + registrable `domain`. `sourcesReturned` is the distinct-URL count (also enforced by the Worker). If the first attempt returns fewer than 15 sources, the Worker **auto-retries once** with a "do more searches" reminder; if the retry also falls short, the response includes a `researchWarning` string and the UI surfaces an amber partial-research banner.

## Local development

```bash
# 1. Run the Worker locally (holds the key in env vars)
cd worker
cp .dev.vars.example .dev.vars          # then fill in your LLM_API_KEY
npm install
npx wrangler dev                        # http://localhost:8787

# 2. Point the static site at the local Worker
#    edit visa-advisor/js/api.js:
#      const API_ENDPOINT = "http://localhost:8787";

# 3. Serve the static site
cd ../visa-advisor
python3 -m http.server 8080
# → http://localhost:8080
```

## Deploy

### Worker

```bash
./scripts/deploy.sh
```

The script installs dependencies, checks the `LLM_API_KEY` wrangler secret (prompts to set it on first run), deploys the Worker, and prints the `workers.dev` URL. Copy that URL into `visa-advisor/js/api.js`:

```js
const API_ENDPOINT = "https://visa-advisor.YOUR_SUBDOMAIN.workers.dev";
```

The raw steps (what the script wraps):

```bash
cd worker
npm ci
npx wrangler login                     # opens browser, OAuth (one-time)
npx wrangler secret put LLM_API_KEY    # paste your key when prompted
npx wrangler deploy                    # prints the workers.dev URL
```

### Static site

Push to `main` → GitHub Pages auto-deploys. No build step. Any static host (Netlify / Vercel / Cloudflare Pages) works the same way — drag-and-drop the `visa-advisor/` folder.

## Security notes

- **Key:** The LLM API key lives only in the Worker's secrets. It is never bundled into the browser JS, never committed, and never logged.
- **Public proxy:** Anyone with the Worker URL can spend tokens. For a personal/demo tool this is acceptable; for production, add IP-based rate limiting at the Worker (e.g. via Cloudflare KV).
- **System prompt trust:** The browser sends the prompt to the Worker; the Worker uses it verbatim. If you want to lock the prompt, pin a SHA-256 hash in `worker/src/index.js` and reject mismatches.
- **Output sanitisation:** All LLM output is HTML-escaped before insertion in `js/ui.js → renderReport()`. Markdown links from `### Sources` are matched with a strict regex; no raw HTML is ever injected.

---

## Out of scope (per spec §8)

Not in MVP, intentionally:

- User accounts / login
- Server-side query history
- Multi-leg itineraries beyond one transit stop
- Multi-passport comparison
- Live appointment availability / embassy finder
- Application form autofill
- Push notifications for tracked (passport, destination) pairs
- Translation (English only)
- Offline mode
- Native mobile app

---

## License

[MIT](./LICENSE)

---

## Credits

- **Design language** — derived from the [inDrive.com](https://indrive.com/) styleguide (interior DS).
- **Countries dataset** — curated subset; full list from [imorte/passport-index-data](https://github.com/imorte/passport-index-data) (MIT).
- **System prompt** — see [`visa-advisor-prompt.md`](./visa-advisor-prompt.md) (v0.5 — 10–12 web searches per query, ≥15 distinct sources, server-side `web_search` for live research, typed `[MONEY]/[DEADLINE]/[ENTRY]/[DOC]/[STALE]` critical markers, Research log + Sources (N) envelope), sourced from the same spec.
- **Disclaimer** — text matches the prompt's `§8f` disclaimer template.
