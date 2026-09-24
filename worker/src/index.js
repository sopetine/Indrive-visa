/* ============================================================
   Visa Advisor proxy — Cloudflare Worker
   Hides the LLM API key, accepts the system prompt from the
   browser (fetched from /visa-advisor-prompt.md), forwards the
   query to the LLM via the OpenAI Responses API (with the
   server-side `web_search` tool), and returns the contract shape
   expected by js/ui.js → renderReport():

       { type: "report",
         markdown:        string,
         caveats?:        string,
         critical?:       Array<{ label, value, source, type }>,
         annotations?:    Array<{ title, url, start, end, snippet }>,
         searchQueries?:  string[],                              // v0.5
         sources?:        Array<{ title, url, domain }>,         // v0.5
         sourcesReturned: number,                                // v0.5
         researchWarning?: string }                              // v0.5
       { type: "clarify", question: string }

   `annotations[]` is the ground-truth provenance: each entry is a
   span-level url_citation returned by the API for one grounded claim.
   The UI maps these to bullet character ranges and appends a
   "Verify on {source}" link to each.

   v0.5 deep-research enforcement: if the LLM returns < MIN_SOURCES
   distinct URLs in `sources[]`, the worker auto-retries once with a
   "do more searches" reminder appended to the user message. If the
   retry still falls short, the report is returned with a
   `researchWarning` so the UI shows an amber "partial research" banner.

   Form payload (from js/api.js):
     { nationality, from, destination, date, purpose, comments, clarify, systemPrompt }

   Env vars (set via `wrangler secret put`):
     LLM_API_KEY  — bearer token for the LLM provider
   Vars (set in wrangler.toml [vars]):
     LLM_ENDPOINT — full chat-completions URL (must be /v1/responses for web_search)
     LLM_MODEL    — model id (e.g. "MiniMax-M3")
     ALLOWED_ORIGIN — exact origin allowed via CORS
   ============================================================ */

const ALLOWED_ORIGIN_DEFAULT = "https://sopetine.github.io";
const MIN_SOURCES = 15;  // enforced minimum distinct URLs in sources[]

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || ALLOWED_ORIGIN_DEFAULT;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders(origin) });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, origin);
    }

    const { nationality, from, destination, date, purpose, comments, clarify, systemPrompt } = body || {};

    if (!nationality || !from) {
      return json({ error: "nationality and from are required" }, 400, origin);
    }
    if (!systemPrompt || typeof systemPrompt !== "string" || systemPrompt.length < 200) {
      return json({ error: "systemPrompt missing or too short" }, 400, origin);
    }
    if (!env.LLM_API_KEY || !env.LLM_ENDPOINT || !env.LLM_MODEL) {
      return json({ error: "Server is missing LLM configuration" }, 500, origin);
    }

    const userMessage = buildUserMessage({ nationality, from, destination, date, purpose, comments, clarify });

    /* v0.7 — server-side deterministic search via Tavily (Tier 1).
       Runs IN PARALLEL with the first upstream call below so latency
       isn't stacked. When enabled, serverSearchSources becomes the
       authoritative primary source set; LLM-emitted sources merge in
       only to fill gaps. When the key is missing or Tavily fails,
       falls through silently to the existing LLM-only path. */
    let serverSearchSources = [];
    let evidenceBlock = "";
    if (env.TAVILY_API_KEY && (env.SEARCH_PROVIDER || "") === "tavily") {
      const queries = buildSearchQueries(nationality, destination, purpose, from);
      try {
        const results = await fetchTavilyResults(env, queries);
        if (results.length) {
          serverSearchSources = results.map((r) => ({
            title:  r.title || "",
            url:    r.url,
            domain: extractDomain(r.url),
          }));
          evidenceBlock = formatEvidenceBlock(results);
          userMessage += `\n\n[EVIDENCE]\nThe search results below were pre-collected server-side from authoritative sources. Cite only these URLs in your sources[] array; do not invent URLs not present here.\n\n${evidenceBlock}\n[/EVIDENCE]`;
        }
      } catch (err) {
        console.error("Tavily search failed (continuing without):", err?.message || err);
      }
    }

    // v0.5 prompt uses server-side web_search via the Responses API.
    // max_tokens must cover thinking + a citation-heavy visible response
    // (typically ~1500 thinking + ~6500 visible with annotations) PLUS
    // the new searchQueries[] + sources[] envelope fields.
    const requestBody = (withWebSearch, msg) => ({
      model:    env.LLM_MODEL,
      ...(withWebSearch ? { tools: [{ type: "web_search" }] } : {}),
      max_tokens: 8192,
      instructions: systemPrompt,
      input: [
        { role: "user", content: msg },
      ],
    });

    // First attempt with web_search.
    let upstream = await callUpstream(env, requestBody(true, userMessage));
    let webSearchAvailable = true;

    // If the provider rejected the web_search tool key (4xx), retry once
    // without it. The LLM still runs the prompt; output is unchanged in
    // shape but lacks real-time web grounding → annotations will be empty
    // and the UI shows its unverified-source banner.
    if (upstream.status === 400 || upstream.status === 422) {
      const detail = await upstream.text().catch(() => "");
      if (/web_search|tool/i.test(detail)) {
        webSearchAvailable = false;
        upstream = await callUpstream(env, requestBody(false, userMessage));
      } else {
        return json(
          { error: "Upstream rejected request", status: 400, detail: detail.slice(0, 500) },
          400,
          origin,
        );
      }
    }

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      return json(
        { error: "Upstream rejected request", status: upstream.status, detail: detail.slice(0, 500) },
        502,
        origin,
      );
    }

    let data;
    try {
      data = await upstream.json();
    } catch {
      return json({ error: "Upstream returned non-JSON" }, 502, origin);
    }

    let parsed = parseContract(data, serverSearchSources);

    // Deep-research enforcement (v0.5): if the report has < MIN_SOURCES
    // distinct URLs in sources[] AND web_search is available, retry once
    // with an explicit "do more searches" reminder appended to the user
    // message. Cap retries at 1 to bound latency.
    if (
      webSearchAvailable &&
      parsed.type === "report" &&
      (parsed.sourcesReturned || 0) < MIN_SOURCES
    ) {
      const reminder =
        `\n\nREMINDER (round 2): your previous attempt returned only ` +
        `${parsed.sourcesReturned || 0} distinct sources. The contract ` +
        `requires ≥${MIN_SOURCES}. You MUST issue additional web searches ` +
        `covering categories you missed (recent rule changes, transit rules, ` +
        `reciprocity fees, sanctions pages, IATA matrix, official eVisa ` +
        `portal). Re-emit the JSON envelope with the full searchQueries[] ` +
        `(now 10–12 entries) and sources[] (now ≥${MIN_SOURCES} entries).`;
      const retryMsg = userMessage + reminder;
      const retryUpstream = await callUpstream(env, requestBody(true, retryMsg));
      if (retryUpstream.ok) {
        try {
          const retryData = await retryUpstream.json();
          parsed = parseContract(retryData, serverSearchSources);
        } catch {
          /* keep first attempt */
        }
      }
    }

    // Attach a warning if we still came up short after the retry attempt.
    if (parsed.type === "report" && (parsed.sourcesReturned || 0) < MIN_SOURCES) {
      parsed.researchWarning =
        `Only ${parsed.sourcesReturned || 0} of ${MIN_SOURCES} required sources ` +
        `were retrieved. Verify all claims manually with the destination embassy ` +
        `before booking travel.`;
    }

    return json(parsed, 200, origin);
  },
};

/* ──────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────── */

async function callUpstream(env, body) {
  return fetch(env.LLM_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${env.LLM_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
}

function buildUserMessage({ nationality, from, destination, date, purpose, comments, clarify }) {
  const lines = [
    `Nationality: ${nationality}`,
    `From:         ${from}`,
    `Destination:  ${destination || "—"}`,
    `Date:         ${date || new Date().toISOString().slice(0, 10)}`,
    `Purpose:      ${purpose || "business"}`,
  ];
  if (comments) lines.push(`Comments:     ${comments}`);
  if (clarify)  lines.push(`Clarification answer: ${clarify}`);
  return lines.join("\n");
}

/* ──────────────────────────────────────────────────────────
   v0.7 — server-side search (Tier 1: Tavily)
   ────────────────────────────────────────────────────────── */

/* Deterministic query list. We pin the order and exact strings so
   re-runs of the same (nationality, destination, purpose) tuple
   return the same results — reproducible for testing. */
function buildSearchQueries(nationality, destination, purpose) {
  const n  = String(nationality || "").trim();
  const d  = String(destination || "").trim() || "the destination country";
  const isRussian = /russian|russia/i.test(n);
  const q = [
    `${n} visa requirements ${d} citizens 2026`,
    `${d} visa fee processing time official site 2026`,
    `${d} travel advisory ${n} citizens`,
    `IATA travel centre ${d} passport visa`,
    `${d} eVisa ETA official government portal 2026`,
    `Schengen 90 180 rolling window rules visa`,
    `Reciprocity visa fee ${n} ${d}`,
  ];
  if (isRussian) {
    q.push(`${n} ${d} entry sanctions 2026 visa restrictions`);
    q.push(`Russian citizens visa processing time delays 2026`);
  }
  if (/business/i.test(purpose || "")) {
    q.push(`${d} business visitor visa requirements ${n} 2026`);
  }
  return q.slice(0, parseInt(env_SEARCH_QUERIES_PER_RUN(), 10) || 7);
}

function env_SEARCH_QUERIES_PER_RUN() {
  // Read at call time — kept tiny to avoid surfacing env in the helper signature.
  return process?.env?.SEARCH_QUERIES_PER_RUN || "7";
}

async function fetchTavilyResults(env, queries, maxPerQuery = 6) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const responses = await Promise.all(
      queries.map((query) =>
        fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            api_key:            env.TAVILY_API_KEY,
            query,
            max_results:        maxPerQuery,
            search_depth:       "advanced",
            include_answer:     false,
            include_raw_content: false,
          }),
        }).then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      )
    );
    const seen = new Set();
    const out  = [];
    for (const resp of responses) {
      if (!resp || !Array.isArray(resp.results)) continue;
      for (const r of resp.results) {
        if (!r || typeof r.url !== "string" || !r.url.startsWith("http")) continue;
        if (seen.has(r.url)) continue;
        seen.add(r.url);
        out.push({
          title:   typeof r.title   === "string" ? r.title : "",
          url:     r.url,
          content: typeof r.content === "string" ? r.content : "",
        });
      }
    }
    return out;
  } finally {
    clearTimeout(timeout);
  }
}

/* Formats results as numbered footnotes with optional content snippet.
   Caps at ~3,500 tokens (~14,000 chars) to keep the LLM budget safe. */
function formatEvidenceBlock(results, charCap = 14_000) {
  const lines = [];
  let budget = charCap;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const head = `[${i + 1}] ${r.title || r.url}\n    ${r.url}`;
    lines.push(head);
    budget -= head.length;
    if (r.content && budget > 200) {
      const snippet = r.content.length > 600 ? r.content.slice(0, 600) + "…" : r.content;
      const line = `\n    ${snippet.replace(/\s+/g, " ")}`;
      lines.push(line);
      budget -= line.length;
    }
    if (budget <= 0) break;
  }
  return lines.join("\n");
}

/* The Responses API may put the assistant message inside `output[]`
   (preferred) or at `output_text` (top-level convenience field). Walk
   every message block and concatenate the text parts. Pull every
   url_citation annotation as we go — these are the per-claim
   provenance the UI uses to append per-bullet verify links. */
function extractFromResponses(data) {
  let text = "";
  const annotations = [];
  const searchCalls = [];

  for (const block of data.output || []) {
    if (!block || typeof block !== "object") continue;

    if (block.type === "web_search_call" && block.action) {
      searchCalls.push({
        query: block.action.query || "",
        status: block.status || "completed",
      });
      continue;
    }

    if (block.type !== "message") continue;
    for (const part of block.content || []) {
      if (!part || part.type !== "output_text") continue;
      text += part.text || "";
      for (const a of part.annotations || []) {
        if (!a || a.type !== "url_citation") continue;
        annotations.push({
          title:   typeof a.title === "string" ? a.title : "",
          url:     typeof a.url   === "string" ? a.url   : "",
          start:   Number.isInteger(a.start_index) ? a.start_index : -1,
          end:     Number.isInteger(a.end_index)   ? a.end_index   : -1,
          snippet: typeof a.content === "string" ? a.content : "",
        });
      }
    }
  }

  // Fallback if output_text is top-level and we didn't find it above.
  if (!text && typeof data.output_text === "string") text = data.output_text;

  return { text, annotations, searchCalls };
}

/* The prompt still asks for a ```json fence around the structured
   answer. If the LLM emitted one, parse it; otherwise treat the whole
   response as the markdown body. */
function parseContract(data, serverSources = []) {
  const { text, annotations, searchCalls } = extractFromResponses(data);

  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      const parsed = JSON.parse(fence[1].trim());
      if (parsed && parsed.type === "clarify" && typeof parsed.question === "string") {
        return { type: "clarify", question: parsed.question };
      }
      if (parsed && typeof parsed.markdown === "string" && parsed.markdown.trim()) {
        const sources      = sanitiseSources(parsed.sources);
        const searchQueries = sanitiseSearchQueries(parsed.searchQueries);
        // If the LLM omitted sources[] but web_search was used, fall back
        // to the searchCalls list we extracted from the API's
        // web_search_call blocks — these are the URLs the model actually
        // visited, even if it failed to echo them in the envelope.
        const llmSources = sources.length
          ? sources
          : deriveSourcesFromSearchCalls(searchCalls, annotations);
        // v0.7: server-derived sources (Tavily) come first; LLM emits
        // anything else, both deduped by URL.
        const merged = dedupeSourcesByUrl([...serverSources, ...llmSources]);
        return {
          type: "report",
          markdown: parsed.markdown.trim(),
          ...(typeof parsed.caveats === "string" && parsed.caveats.trim()
            ? { caveats: parsed.caveats.trim() }
            : {}),
          ...(Array.isArray(parsed.critical) && parsed.critical.length
            ? { critical: sanitiseCritical(parsed.critical) }
            : {}),
          ...(annotations.length ? { annotations } : {}),
          ...(searchCalls.length ? { searchCalls } : {}),
          ...(searchQueries.length ? { searchQueries } : {}),
          ...(merged.length ? { sources: merged } : {}),
          sourcesReturned: merged.length,
          ...(serverSources.length ? { serverSearchAvailable: true } : {}),
        };
      }
    } catch {
      /* fall through to raw-text fallback */
    }
  }
  // Fallback: treat the entire response as markdown. Derive sources
  // from whatever ground-truth we have (search_calls + annotations).
  const fallbackSources = deriveSourcesFromSearchCalls(searchCalls, annotations);
  const merged = dedupeSourcesByUrl([...serverSources, ...fallbackSources]);
  const out = {
    type: "report",
    markdown: text.trim(),
    sourcesReturned: merged.length,
  };
  if (annotations.length) out.annotations = annotations;
  if (searchCalls.length) out.searchCalls = searchCalls;
  if (merged.length)     out.sources = merged;
  if (serverSources.length) out.serverSearchAvailable = true;
  return out;
}

function sanitiseSearchQueries(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const q of raw) {
    if (typeof q !== "string") continue;
    const trimmed = q.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= 32) break;  // sanity cap
  }
  return out;
}

function sanitiseSources(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const url = typeof s.url === "string" ? s.url.trim() : "";
    if (!url || !/^https?:\/\//i.test(url)) continue;
    out.push({
      title:  typeof s.title  === "string" ? s.title.trim()  : "",
      url,
      domain: typeof s.domain === "string" && s.domain.trim()
        ? s.domain.trim().toLowerCase()
        : extractDomain(url),
    });
  }
  return out;
}

function deriveSourcesFromSearchCalls(searchCalls, annotations) {
  const out = [];
  const seen = new Set();
  // Annotations are span-level — they often repeat the same URL across
  // claims. We dedupe below, so just push every URL.
  for (const a of annotations || []) {
    if (!a || typeof a.url !== "string" || !a.url) continue;
    const url = a.url.trim();
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({
      title:  typeof a.title === "string" ? a.title.trim() : "",
      url,
      domain: extractDomain(url),
    });
  }
  return out;
}

function dedupeSourcesByUrl(sources) {
  const map = new Map();
  for (const s of sources) {
    if (!s || !s.url) continue;
    const existing = map.get(s.url);
    if (existing) {
      if (!existing.title && s.title) existing.title = s.title;
      if (!existing.domain && s.domain) existing.domain = s.domain;
    } else {
      map.set(s.url, { ...s });
    }
  }
  return Array.from(map.values());
}

function extractDomain(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    // Strip leading "www." for a cleaner display label.
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return "";
  }
}

function sanitiseCritical(raw) {
  const out = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    if (typeof c.label !== "string" || !c.label.trim()) continue;
    const type = ["money", "deadline", "entry", "doc", "stale"].includes(c.type) ? c.type : "";
    out.push({
      label:  c.label.trim(),
      value:  typeof c.value  === "string" ? c.value.trim()  : "",
      source: typeof c.source === "string" ? c.source.trim() : "",
      ...(type ? { type } : {}),
    });
  }
  return out;
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin":  origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age":       "86400",
    "Vary":                         "Origin",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}
