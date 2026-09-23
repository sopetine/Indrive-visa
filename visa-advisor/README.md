# Visa Advisor

> Open-source web app that returns current visa requirements for any (nationality, arrival, destination) — sourced from Wikipedia, IATA, and official `.gov` sites.
>
> **Status:** Live. Powered by **MiniMax M3** via a Cloudflare Worker proxy that holds the API key. See [How it works](#how-it-works).

---

## What it does

A user enters free-form text:

- **Nationality** (their passport) — e.g. "Russian", "American"
- **Arrival** (country) — e.g. "Georgia", "Turkey"
- **Destination** (city) — e.g. "Tbilisi", "Istanbul"
- **Comments** (optional) — e.g. dual citizenship, layover, diplomatic passport

The app auto-fills the arrival date (today) and trip purpose (business) so the form stays tight. The LLM gets the optional free-form comments for context.

The app returns a structured report:

- Visa status (visa-free / eTA / eVisa / VOA / embassy / restricted)
- Allowed stay, passport-validity rule, fee, processing time
- Required documents
- Official application link (only `.gov` / official)
- Exception rules, travel advisories (collapsible)
- Sources (Wikipedia, IATA, official sites)
- ⚠️ Caveats callout when applicable
- Disclaimer (always last)

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
GitHub Pages (static)             Cloudflare Worker (proxy)              MiniMax API
─────────────────────             ─────────────────────────              ────────────
visa-advisor/index.html ─fetch─→ api/visa-query.js ───Bearer───→ /v1/chat/completions
visa-advisor/js/api.js   ←JSON── { markdown, caveats }  ←tokens──  minimax/MiniMax-M3
        │
        └─fetch→ visa-advisor/visa-advisor-prompt.md (once, cached)
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
  "markdown": "### Visa status\nVisa-free\n\n### Allowed stay\n...",
  "caveats": "Optional short string for the ⚠️ callout"
}
```

…or, if the LLM needs clarification (per §4 of the prompt):

```json
{ "type": "clarify", "question": "Which passport will you travel on?" }
```

The `markdown` field follows the section order in §2 of the prompt. The UI in `js/ui.js → renderReport()` parses it; the disclaimer is appended automatically.

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

### Worker (one-time setup)

```bash
cd worker
npm install
npx wrangler login                     # opens browser, OAuth
npx wrangler secret put LLM_API_KEY    # paste your key when prompted
npx wrangler deploy                    # prints the workers.dev URL
```

Copy the printed URL (e.g. `https://visa-advisor.YOUR_SUBDOMAIN.workers.dev`) into `visa-advisor/js/api.js`:

```js
const API_ENDPOINT = "https://visa-advisor.YOUR_SUBDOMAIN.workers.dev";
```

### Static site

Push to `main` → GitHub Pages auto-deploys. No build step.

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

## Deploy

Any static host works — the app has no backend of its own.

- **GitHub Pages** — push to `gh-pages` branch, enable Pages. Done.
- **Netlify / Vercel / Cloudflare Pages** — drag-and-drop the folder.
- **Custom domain** — point a CNAME at your Pages URL.

For analytics, consider [Plausible](https://plausible.io/) or [Umami](https://umami.is/) — both privacy-respecting. Add the script tag in `index.html` if you want it.

---

## License

[MIT](./LICENSE)

---

## Credits

- **Design language** — derived from the [inDrive.com](https://indrive.com/) styleguide (interior DS).
- **Countries dataset** — curated subset; full list from [imorte/passport-index-data](https://github.com/imorte/passport-index-data) (MIT).
- **System prompt** — see [`visa-advisor-prompt.md`](./visa-advisor-prompt.md), sourced from the same spec.
- **Disclaimer** — text matches the prompt's `§8f` disclaimer template.
