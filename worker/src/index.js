/* ============================================================
   Visa Advisor proxy — Cloudflare Worker
   Hides the LLM API key, accepts the system prompt from the
   browser (fetched from /visa-advisor-prompt.md), forwards the
   query to the LLM via the OpenAI Responses API (with the
   server-side `web_search` tool), and returns the contract shape
   expected by js/ui.js → renderReport():

       { type: "report",
         markdown:     string,
         caveats?:     string,
         critical?:    Array<{ label, value, source, type }>,
         annotations?: Array<{ title, url, start, end, snippet }> }
       { type: "clarify", question: string }

   `annotations[]` is the ground-truth provenance: each entry is a
   span-level url_citation returned by the API for one grounded claim.
   The UI maps these to bullet character ranges and appends a
   "Verify on {source}" link to each.

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

    // v0.4 prompt uses server-side web_search via the Responses API.
    // max_tokens must cover thinking + a citation-heavy visible response
    // (typically ~1500 thinking + ~6500 visible with annotations).
    const requestBody = (withWebSearch) => ({
      model:    env.LLM_MODEL,
      ...(withWebSearch ? { tools: [{ type: "web_search" }] } : {}),
      max_tokens: 8192,
      instructions: systemPrompt,
      input: [
        { role: "user", content: userMessage },
      ],
    });

    let upstream = await callUpstream(env, requestBody(true));

    // If the provider rejected the web_search tool key (4xx), retry once
    // without it. The LLM still runs the prompt; output is unchanged in
    // shape but lacks real-time web grounding → annotations will be empty
    // and the UI shows its unverified-source banner.
    if (upstream.status === 400 || upstream.status === 422) {
      const detail = await upstream.text().catch(() => "");
      if (/web_search|tool/i.test(detail)) {
        upstream = await callUpstream(env, requestBody(false));
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

    return json(parseContract(data), 200, origin);
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
function parseContract(data) {
  const { text, annotations, searchCalls } = extractFromResponses(data);

  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      const parsed = JSON.parse(fence[1].trim());
      if (parsed && parsed.type === "clarify" && typeof parsed.question === "string") {
        return { type: "clarify", question: parsed.question };
      }
      if (parsed && typeof parsed.markdown === "string" && parsed.markdown.trim()) {
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
        };
      }
    } catch {
      /* fall through to raw-text fallback */
    }
  }
  // Fallback: treat the entire response as markdown.
  const out = { type: "report", markdown: text.trim() };
  if (annotations.length) out.annotations = annotations;
  if (searchCalls.length) out.searchCalls = searchCalls;
  return out;
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
