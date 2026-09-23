# Visa Advisor

> Open-source web app that returns current visa requirements for any (nationality, arrival, destination) — sourced from Wikipedia, IATA, and official `.gov` sites.
>
> **Status:** UI complete. LLM integration is a stub — see [Adding your LLM](#adding-your-llm).

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
visa-advisor/
├── index.html                ← SPA shell (form + report views, hash routing)
├── README.md                 ← This file
├── LICENSE                   ← MIT
├── .gitignore
├── css/
│   ├── tokens.css            ← Design tokens (from inDrive styleguide)
│   ├── reset.css             ← Modern CSS reset
│   ├── base.css              ← Typography, container, badge
│   ├── buttons.css           ← Button system
│   ├── accessibility.css     ← A11y patches
│   └── advisor.css           ← Visa-advisor-specific styles
└── js/
    ├── countries.js          ← ~120 country list + sanctioned set
    ├── api.js                ← LLM API stub + mock data
    ├── ui.js                 ← Form, modal, combobox, report renderer
    └── main.js               ← Bootstrap + hash router
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

## Adding your LLM

The UI is wired but the LLM is not. Three things to do:

### 1. Set up a serverless proxy

**Never embed your API key in the browser.** Create a thin proxy that hides the key. Vercel/Cloudflare Worker examples:

```js
// Vercel Edge Function — api/visa-query.ts
export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  const body = await req.json();
  const systemPrompt = await Deno.readTextFile("./visa-advisor-prompt.md");

  const res = await fetch("https://api.your-provider.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: "your-model-id",
      system: systemPrompt,
      messages: [{ role: "user", content: buildUserMessage(body) }],
    }),
  });
  // parse the LLM response and return it in the contract below
}
```

### 2. Implement the response contract

The UI (`js/ui.js → renderReport`) parses a structured markdown response. Your proxy must return one of:

**On success:**

```json
{
  "type": "report",
  "markdown": "### Visa status\nVisa-free\n\n### Allowed stay\n...",
  "caveats": "Optional short string for the ⚠️ callout"
}
```

The markdown must follow the section order defined in `visa-advisor-prompt.md` §2:

```
### Visa status
### Allowed stay
### Passport validity rule
### Fee
### Typical processing time
### Required documents (typical)
### Official application URL
### Exception rules
### Travel advisories
### Last verified
### Sources
```

**If the LLM needs clarification** (spec §2.4, e.g. dual citizenship):

```json
{ "type": "clarify", "question": "Which passport will you travel on?" }
```

The UI will display a question input and re-send the original query with the user's answer appended as a `clarify` field.

### 3. Point the UI at your proxy

Edit [`js/api.js`](./js/api.js) — set `API_ENDPOINT`:

```js
const API_ENDPOINT = "/api/visa-query"; // or your full URL
```

When set, `queryAdvisor()` will `POST` the form data there instead of returning the mock report.

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
