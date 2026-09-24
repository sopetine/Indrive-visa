# Visa Advisor — Functional Requirements (Web App)

> **Scope:** functional behavior for the responsive web app. Visual design is driven by a separate styleguide (to be applied later) and the inDrive-style UI requirement per the BRD. This spec describes **what** the app does, not **how** it looks.

**Version:** v0.3 — companion to `visa-advisor-prompt.md` v0.5 (deep-research mandate: 10–12 searches, ≥15 distinct sources, Research log + Sources (N) sections visible in the report)

---

## 1. Tech assumptions

- Single-page web app (SPA). No backend server for the visa query itself — the web app calls the MiniMax API directly from the browser (or via a thin serverless proxy to hide the API key).
- API key never exposed to client. Recommended: Vercel / Cloudflare Worker proxy.
- No user accounts, no login, no persistence beyond `localStorage`.
- Static deployable (Vercel / Netlify / Cloudflare Pages).
- Works fully on mobile browsers (iOS Safari, Android Chrome). Desktop is a secondary surface.

---

## 2. User flows

### 2.1 Primary flow (happy path)

```
[Landing] → [First-use disclaimer modal] → [Form] → [Submit] → [Loading] → [Report] → [Re-query or Done]
```

1. User opens the app.
2. **First time only:** disclaimer modal appears. User must acknowledge ("I understand") to proceed. State persists in `localStorage` so the modal does not reappear unless the user clears site data or the disclaimer text changes.
3. User lands on the main form (single screen).
4. User selects nationality, destination, arrival date.
5. User submits → app sends the query to the MiniMax API using the v0.4 system prompt (via the OpenAI Responses API with server-side `web_search`).
6. Loading state appears (functional placeholder; visual defined in styleguide).
7. Structured report renders on screen.
8. User can: edit inputs and re-query, copy the report, share via URL.

### 2.2 Re-query flow

- After a report is shown, the form remains visible (collapsed or pinned at top).
- User changes any field and submits → loading state replaces the previous report.
- The previous report is discarded (not stored).

### 2.3 Error / empty flows

- **API failure** → error card with "Retry" button. Reason shown in plain English ("Couldn't reach the service" / "Request timed out"). No technical error messages to the user.
- **Invalid input combinations** → inline field-level errors before submit (e.g., arrival date in the past).
- **LLM returns malformed output** → fallback error card with "Try again" button. Do not display partial / broken markdown.
- **Network offline** → detected at submit time; show "You're offline" card.

### 2.4 Edge case — dual citizenship

- After the form is submitted and before the API call, if the LLM needs clarification (e.g., which passport the user is travelling on), the app surfaces a follow-up question inline below the loading state.
- The user's answer is appended to the original query and re-sent.

### 2.5 Edge case — layover / multi-leg

- Optional secondary input: "Transit country (optional)" — a single dropdown shown only when the user opts in ("Adding a layover?").
- If provided, the report includes both the destination requirements and any transit visa call-out.

---

## 3. Input form

### 3.1 Fields

| Field | Type | Required | Behavior |
|---|---|---|---|
| **Nationality** | Searchable dropdown | Yes | Lists ~250 passports; search by country name or ISO code; defaults to last-used value from `localStorage` |
| **From** | Searchable dropdown | Yes | Country the user is currently based in / will apply from. Same search behavior as nationality; used by the LLM for Schengen consulate-jurisdiction advice. |
| **Destination** | Searchable dropdown | Yes | Destination city. LLM infers the destination country. |
| **Arrival date** | Date picker | Yes | Constrained to today + 2 years forward; format YYYY-MM-DD; defaults to today |
| **Transit country** | Searchable dropdown | No | Revealed by a toggle "Add layover?"; same list as From |
| **Trip purpose** | Radio: `Leisure` / `Business` / `Family` / `Other` | No | Defaults to `Business`; influences the LLM prompt context |

### 3.2 Validation rules

- All three required fields must be non-empty.
- Arrival date must be today or later.
- Sanctioned-destination detection moved to the LLM (it infers the country from the destination city). If destination is Iran / North Korea / Syria / Crimea / DNR / LNR, the LLM refuses in its response and surfaces a caveats entry recommending professional immigration counsel.

### 3.3 Submit behavior

- Submit button is disabled until all required fields are valid.
- On submit, the app sends the form values + the v0.4 system prompt to the MiniMax API.
- Loading state appears within 100 ms (optimistic).
- Request timeout: 120 seconds. Each query typically takes 30–90s because the LLM actually fetches pages via `web_search`.

---

## 4. Result display

### 4.1 Report structure

The app renders the LLM response in the structured order defined in the v0.4 prompt, with span-level `url_citation` annotations from the API attached to bullets:

1. **Visa status** — large, prominent, single value (badge / pill / heading — style TBD)
2. **Before you book** — NEW color-coded numbered checklist (money / deadline / entry / doc / stale), each step with a verify link
3. **Allowed stay** — supporting line
4. **Passport validity rule** — supporting line
5. **Fee** — typed `[MONEY]` critical (amber/red accent)
6. **Processing time** — typed `[DEADLINE]` critical
7. **Required documents** — bulleted list, each bullet ending with a "Verify on {source}" link to the URL the LLM actually read via web_search
8. **Official application URL** — primary CTA button (only if a `.gov` / official URL was provided)
9. **Exception rules** — collapsible section (collapsed by default), bullets with verify links
10. **Travel advisories** — collapsible section (collapsed by default), bullets with verify links
11. **Last verified** — small footer line
12. **Sources** — annotated list with snippet excerpts
13. **Disclaimer** — always present, at bottom

Zero-annotation fallback: if `annotations[]` is empty (e.g. `web_search` tool was rejected and fell back to no-search mode), an amber "Web research did not return grounded sources" banner is shown above the report so the user knows to verify manually.

### 4.2 Caveats / uncertainty

- If the LLM response includes a ⚠️ Caveats section, it is rendered above the disclaimer as a callout (yellow/amber-styled — color in styleguide).

### 4.3 Actions available on the result

- **Copy report** — copies the full text + URLs to clipboard
- **Share via URL** — encodes the query parameters into the URL so the recipient can re-run the same query (no PII, just nationality/destination/date)
- **Re-query** — edits fields and re-submits
- **Report incorrect info** — opens an email or feedback form (mailto: or form endpoint, TBD)

---

## 5. Accessibility (functional, not visual)

- All form fields are keyboard-navigable.
- All interactive elements have accessible labels (aria-label or visible text).
- Loading state announces to screen readers (`aria-live="polite"`).
- Result sections use semantic HTML (headings for status, lists for docs/sources).
- Color is not the only signal for status (icon or text accompanies).
- Target contrast meets WCAG 2.1 AA (4.5:1 for body text).
- Focus is visible and logical (top to bottom on result render).

---

## 6. Responsive behavior

### 6.1 Breakpoints (functional)

| Breakpoint | Behavior |
|---|---|
| **Mobile** (< 640 px) | Single column. Form fields stack vertically. Result sections stack. Action buttons are full-width. Sticky bottom CTA on result screen. |
| **Tablet** (640–1024 px) | Single column with wider padding. Same flow. |
| **Desktop** (> 1024 px) | Two-column layout possible: form left, result right. Or single column with max-width container — TBD per styleguide. |

### 6.2 Functional constraints

- Form fits in viewport without scrolling on mobile (initial state).
- Result is scrollable; the first section (visa status) is visible above the fold.
- Date picker uses native input on mobile (`<input type="date">`), styled per styleguide.
- No horizontal scrolling at any breakpoint.

---

## 7. Persistence

- **Last-used nationality** — saved to `localStorage`, pre-fills next visit.
- **Disclaimer acknowledgement** — saved to `localStorage`, suppresses modal on subsequent visits unless text changes.
- **No history** of past queries stored. (Optional v2: store last 5 queries locally.)

---

## 8. Out of scope (MVP)

- User accounts / login / multi-user
- Server-side history / analytics dashboard
- Multi-leg itineraries beyond one transit stop
- Multi-passport comparison (compare requirements across 2+ nationalities)
- Live appointment availability / embassies map
- Application form autofill
- Push notifications for tracked pairs
- Translation (English-only MVP)
- Offline mode
- Native mobile app (iOS / Android shell)

---

## 9. Open questions for the next iteration

1. **Proxy or direct API?** Serverless proxy adds a hop but hides the API key. Direct call needs the key embedded (insecure). Default: proxy.
2. **Share via URL encoding scope** — what fields go into the URL? Suggest: nationality, destination, arrival date, purpose. NOT transit (optional).
3. **Feedback channel** — `mailto:` with prefilled subject, or a hosted form (Google Forms / Tally / Formbricks)?
4. **Rate limiting** — per-IP limits on the proxy to prevent abuse (even for personal use).
5. **Theme** — light only, dark only, or both (follow system preference)?
6. **Analytics** — privacy-respecting (Plausible / Umami) or none for MVP?

---

## 10. Acceptance criteria (MVP gate)

- [ ] First-use disclaimer modal appears on first visit, persists on revisit.
- [ ] All required form fields validate correctly (nationality ≠ destination, arrival date ≥ today).
- [ ] Submit triggers API call, loading state shows within 100 ms.
- [ ] Loading state replaces previous report on re-query.
- [ ] Result renders all 12 sections from §4.1 in correct order.
- [ ] Caveats (⚠️) section renders above disclaimer when present in LLM response.
- [ ] "Copy report" copies full text + URLs to clipboard.
- [ ] Share URL reproduces the same query when opened.
- [ ] Mobile, tablet, and desktop layouts all function without horizontal scrolling.
- [ ] All form fields and result actions are keyboard-accessible.
- [ ] API timeout at 60 s triggers error card with retry.
- [ ] Sanctioned-destination check disables submit and shows notice.
- [ ] Last-used nationality pre-fills on next visit.