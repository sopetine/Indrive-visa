/* ============================================================
   Visa Advisor proxy — Cloudflare Worker
   Hides the LLM API key, accepts the system prompt from the
   browser (fetched from /visa-advisor-prompt.md), forwards the
   query to the LLM, and returns the contract shape expected by
   js/ui.js → renderReport():

       { type: "report", markdown: string, caveats?: string }
       { type: "clarify", question: string }

   Env vars (set via `wrangler secret put`):
     LLM_API_KEY  — bearer token for the LLM provider
   Vars (set in wrangler.toml [vars]):
     LLM_ENDPOINT — full chat-completions URL
     LLM_MODEL    — model id (e.g. "minimax/MiniMax-M3")
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

    const { nationality, arrival, destination, date, purpose, comments, clarify, systemPrompt } = body || {};

    if (!nationality || !arrival) {
      return json({ error: "nationality and arrival are required" }, 400, origin);
    }
    if (!systemPrompt || typeof systemPrompt !== "string" || systemPrompt.length < 200) {
      return json({ error: "systemPrompt missing or too short" }, 400, origin);
    }
    if (!env.LLM_API_KEY || !env.LLM_ENDPOINT || !env.LLM_MODEL) {
      return json({ error: "Server is missing LLM configuration" }, 500, origin);
    }

    const userMessage = buildUserMessage({ nationality, arrival, destination, date, purpose, comments, clarify });

    let upstream;
    try {
      upstream = await fetch(env.LLM_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${env.LLM_API_KEY}`,
        },
        body: JSON.stringify({
          model:       env.LLM_MODEL,
          max_tokens:  2048,
          temperature: 0.2,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userMessage },
          ],
        }),
      });
    } catch (err) {
      return json({ error: "Upstream unreachable", detail: String(err) }, 502, origin);
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

    const text = extractAssistantText(data);
    return json(parseContract(text), 200, origin);
  },
};

/* ──────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────── */

function buildUserMessage({ nationality, arrival, destination, date, purpose, comments, clarify }) {
  const lines = [
    `Nationality: ${nationality}`,
    `Arrival:     ${arrival}`,
    `Destination: ${destination || "—"}`,
    `Date:        ${date || new Date().toISOString().slice(0, 10)}`,
    `Purpose:     ${purpose || "business"}`,
  ];
  if (comments) lines.push(`Comments:    ${comments}`);
  if (clarify)  lines.push(`Clarification answer: ${clarify}`);
  return lines.join("\n");
}

function extractAssistantText(data) {
  // OpenAI-compatible shape
  const oai = data?.choices?.[0]?.message?.content;
  if (typeof oai === "string") return oai;
  // Anthropic-compatible fallback
  const anth = data?.content?.[0]?.text;
  if (typeof anth === "string") return anth;
  // Last resort: stringify
  return typeof data === "string" ? data : "";
}

function parseContract(text) {
  // Per §9 of the system prompt, the LLM wraps its answer in a ```json fence.
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
        };
      }
    } catch {
      /* fall through to markdown fallback */
    }
  }
  // Fallback: treat the entire response as markdown
  return { type: "report", markdown: text.trim() };
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
