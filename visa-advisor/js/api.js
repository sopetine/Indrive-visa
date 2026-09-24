/* ============================================================
   API — LLM call via the Cloudflare Worker proxy.

   The browser fetches the system prompt once from
   `./visa-advisor-prompt.md` (relative to the visa-advisor/
   static root on GitHub Pages) and POSTs it together with the
   form values. The Worker holds the API key in env vars and
   forwards the call to the LLM.

   Response contract (enforced by the Worker):
       { type: "report",  markdown: string, caveats?: string }
       { type: "clarify", question: string }

   Throws on failure (network, timeout, malformed). The UI
   catches and renders the retry card.
   ============================================================ */

const API_ENDPOINT       = "https://visa-advisor.sopetine.workers.dev";
const SYSTEM_PROMPT_URL  = "./visa-advisor-prompt.md";
const REQUEST_TIMEOUT_MS = 120_000;  // web_search can take 30-90s per query

let _promptCache = null;

/**
 * Fetch and cache the system prompt. The prompt is static, lives
 * next to the app in the repo, and is sent on every request so
 * the repo owner can edit it without redeploying the Worker.
 */
async function loadSystemPrompt() {
  if (_promptCache) return _promptCache;
  const res = await fetch(SYSTEM_PROMPT_URL, { cache: "force-cache" });
  if (!res.ok) {
    const e = new Error(`Failed to load system prompt (HTTP ${res.status})`);
    e.code = "PROMPT_LOAD";
    throw e;
  }
  _promptCache = (await res.text()).trim();
  return _promptCache;
}

/**
 * @typedef {Object} QueryInput
 * @property {string} nationality   passport (e.g. "Russian")
 * @property {string} from          current residence / where user is based (e.g. "Georgia")
 * @property {string} destination   destination city (e.g. "Munich")
 * @property {string} date          YYYY-MM-DD
 * @property {string} purpose
 * @property {string} [comments]
 * @property {string} [clarify]
 */

/**
 * @returns {Promise<{type:"report", markdown:string, caveats?:string}
 *                 |{type:"clarify", question:string}>}
 */
export async function queryAdvisor(input) {
  const systemPrompt = await loadSystemPrompt();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, systemPrompt }),
      signal: controller.signal,
    });

    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).error || ""; } catch { /* ignore */ }
      const e = new Error(detail || `Proxy returned HTTP ${res.status}`);
      e.code = res.status >= 500 ? "UPSTREAM" : "CLIENT";
      throw e;
    }

    const data = await res.json();
    if (!data || (data.type !== "report" && data.type !== "clarify")) {
      const e = new Error("Malformed response from proxy");
      e.code = "MALFORMED";
      throw e;
    }
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

/**
 * Test-only: reset the prompt cache so tests can swap prompts.
 * Not used by the app.
 */
export function _resetPromptCache() {
  _promptCache = null;
}
