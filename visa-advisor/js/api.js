/* ============================================================
   API — LLM call with mock fallback.

   This file has TWO responsibilities:
     1. Provide `queryAdvisor(input)` so the UI can request a
        report from whatever backend the project owner wires up.
     2. Ship a `MOCK_REPORT` so the UI is fully usable today,
        before the real LLM is connected.

   ──────────────────────────────────────────────────────────
   INTEGRATION CONTRACT (what the real backend must return)
   ──────────────────────────────────────────────────────────
   On success, return an object:

       {
         type: "report",
         markdown: "### Visa status\nVisa-free\n\n### Allowed stay\n...",
         caveats: "Optional short string for the ⚠️ callout"
       }

   If the LLM needs clarification (spec §2.4 dual-citizenship):

       { type: "clarify", question: "Which passport will you travel on?" }

   Throw on failure (network, timeout, malformed). The UI
   catches and renders the retry card.

   ──────────────────────────────────────────────────────────
   HOW TO PLUG IN YOUR LLM
   ──────────────────────────────────────────────────────────
   1. Set `API_ENDPOINT` below to your proxy URL (Vercel /
      Cloudflare Worker that hides the API key — DO NOT embed
      the key in the browser).
   2. The proxy receives `{ nationality, arrival, destination,
      date, purpose, comments?, clarify? }` and returns the
      shape above.
   3. The system prompt to forward lives in
      `../visa-advisor-prompt.md`. Inject it as the LLM
      `system` message and the form values as the `user`
      message.
   4. Delete or guard `MOCK_REPORT` behind a dev flag.
   ============================================================ */

const API_ENDPOINT = ""; // e.g. "/api/visa-query" — leave empty for mock mode
const REQUEST_TIMEOUT_MS = 60_000;

/* ──────────────────────────────────────────────────────────
   MOCK REPORT — used when API_ENDPOINT is empty or fails.
   Replace by wiring the real LLM through API_ENDPOINT.
   ────────────────────────────────────────────────────────── */
const MOCK_REPORT = {
  type: "report",
  markdown: `### Visa status
Visa-free

### Allowed stay
90 days within any 180-day period

### Passport validity rule
6 months beyond intended stay, 1 blank page required

### Fee
~$0 USD (visa-free — verify on official site)

### Typical processing time
N/A (visa-free)

### Required documents (typical)
- Valid passport (6+ months validity)
- Return or onward ticket
- Proof of accommodation (hotel booking, invitation letter)
- Proof of sufficient funds

### Official application URL
Contact nearest embassy/consulate

### Exception rules
Schengen C visa holders may transit. US green card holders exempt from short-stay visa requirements in some cases — verify before travel.

### Travel advisories
None relevant

### Last verified
2026-09-23

### Sources
- [Wikipedia — Visa policy of Georgia](https://en.wikipedia.org/wiki/Visa_policy_of_Georgia)
- [Wikipedia — Visa requirements for Russian citizens](https://en.wikipedia.org/wiki/Visa_requirements_for_Russian_citizens)
- [IATA Travel Centre](https://www.iatatravelcentre.com/)
- [MFA Georgia — Visas](https://www.geoconsul.gov.ge/)`,
  caveats: "Russian nationals: confirm that your passport is not on the destination's restricted list before booking. Schengen/EU consulates have varying policies for Russian applicants since 2022."
};

/* ──────────────────────────────────────────────────────────
   Public API
   ────────────────────────────────────────────────────────── */

/**
 * @typedef {Object} QueryInput
 * @property {string} nationality   - free-form text, e.g. "Russian"
 * @property {string} arrival       - free-form text (country), e.g. "Georgia"
 * @property {string} destination   - free-form text (city), e.g. "Tbilisi"
 * @property {string} date          - YYYY-MM-DD (always today)
 * @property {string} purpose       - always "business" for MVP
 * @property {string} [comments]    - free-form optional user note
 * @property {string} [clarify]     - User's answer to a follow-up question
 * @property {string} [clarifyFor]  - Original query that prompted the follow-up
 */

/**
 * @returns {Promise<{type:"report", markdown:string, caveats?:string}
 *                 |{type:"clarify", question:string}>}
 */
export async function queryAdvisor(input) {
  if (!API_ENDPOINT) {
    // No backend wired — return mock data after a small delay.
    await delay(900);
    return structuredClone(MOCK_REPORT);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      const e = new Error("Request timed out");
      e.code = "TIMEOUT";
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* ──────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────── */
function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}
