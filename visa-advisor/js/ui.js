/* ============================================================
   UI — form, validation, modal, report rendering
   v0.5 — deep-research renderer: Research log + Sources (N) sections,
   per-report research meta line, partial-research warning banner.
   v0.4 — span-annotation renderer, "Before you book" checklist,
   per-bullet verify links, typed critical markers.

   Form: Nationality + From (where you're based) + Destination (city)
   ============================================================ */

import { findByCode } from "./countries.js";
import { queryAdvisor } from "./api.js";

/* ──────────────────────────────────────────────────────────
   DISCLAIMER MODAL
   ────────────────────────────────────────────────────────── */

const DISCLAIMER_VERSION = "v1"; // bump to re-prompt after content change

/* ──────────────────────────────────────────────────────────
   BUTTON RIPPLE — tactile press flourish on any .btn, delegated
   at document level so it also covers buttons rendered later
   (report actions, retry, clarify submit, etc).
   ────────────────────────────────────────────────────────── */
document.addEventListener("pointerdown", (e) => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const btn = e.target.closest && e.target.closest(".btn");
  if (!btn) return;
  let ripple = btn.querySelector(".btn-ripple");
  if (!ripple) {
    ripple = document.createElement("span");
    ripple.className = "btn-ripple";
    ripple.setAttribute("aria-hidden", "true");
    btn.appendChild(ripple);
  }
  ripple.classList.remove("is-active");
  // Force reflow so re-triggering the class on rapid clicks still animates.
  void ripple.offsetWidth;
  ripple.classList.add("is-active");
  setTimeout(() => ripple.classList.remove("is-active"), 180);
});

export function initModal() {
  const modal   = document.querySelector("[data-modal]");
  const ackBtn  = modal.querySelector("[data-modal-ack]");
  const backdrop= modal.querySelector("[data-modal-backdrop]");

  const accepted = localStorage.getItem("visa-advisor.disclaimer") === DISCLAIMER_VERSION;

  function open() {
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    ackBtn.focus();
  }
  function close() {
    modal.hidden = true;
    document.body.style.overflow = "";
  }
  function accept() {
    localStorage.setItem("visa-advisor.disclaimer", DISCLAIMER_VERSION);
    close();
  }

  ackBtn.addEventListener("click", accept);
  backdrop.addEventListener("click", () => { /* require explicit accept */ });

  if (!accepted) open();
  return { open, close };
}

/* ──────────────────────────────────────────────────────────
   FORM — Nationality + From + Destination (+ optional Comments)
   ────────────────────────────────────────────────────────── */

export function initForm({ onSubmit }) {
  const form         = document.querySelector("[data-form]");
  const submitBtn    = form.querySelector("[data-submit]");
  const nationalityEl= form.querySelector("#input-nationality");
  const fromEl       = form.querySelector("#input-from");
  const destinationEl= form.querySelector("#input-destination");
  const commentsEl   = form.querySelector("#input-comments");
  const sanctionedUI = form.querySelector("[data-notice=sanctioned]");
  const pillEl       = document.querySelector("[data-view-pill]");
  const pillRouteEl  = document.querySelector("[data-pill-route]");

  // Hydrate the "Back to last report" pill + the nationality field from
  // localStorage. Migration shim: legacy shape { arrival } → { from }.
  let cachedInput = null;
  try {
    const raw = localStorage.getItem("visa-advisor.last-input");
    if (raw) {
      cachedInput = JSON.parse(raw);
      if (cachedInput && !cachedInput.from && cachedInput.arrival) {
        cachedInput.from = cachedInput.arrival;
      }
    }
  } catch { /* ignore parse errors */ }
  if (cachedInput && cachedInput.nationality) {
    nationalityEl.value = cachedInput.nationality;
  }
  if (cachedInput && pillEl && pillRouteEl) {
    const route = [cachedInput.nationality, cachedInput.destination || cachedInput.from]
      .filter(Boolean).join(" / ");
    if (route) {
      pillRouteEl.textContent = route;
      pillEl.hidden = false;
      const openBtn = pillEl.querySelector("[data-action=open-report]");
      if (openBtn) {
        openBtn.addEventListener("click", () => {
          if (typeof onSubmit === "function") onSubmit(cachedInput);
        });
      }
    }
  }

  function setError(field, msg) {
    const el = form.querySelector(`[data-error-for="${field}"]`);
    el.textContent = msg;
    el.hidden = !msg;
    const wrap = form.querySelector(`[data-field="${field}"]`);
    if (wrap) wrap.classList.toggle("has-error", !!msg);
  }

  function clearErrors() {
    form.querySelectorAll(".field-error").forEach((el) => {
      el.hidden = true;
      el.textContent = "";
    });
    form.querySelectorAll("[data-field]").forEach((el) => el.classList.remove("has-error"));
  }

  function readField(el) {
    return (el.value || "").trim();
  }

  function validate() {
    clearErrors();
    const nat = readField(nationalityEl);
    const fr  = readField(fromEl);
    const dst = readField(destinationEl);
    let ok = true;

    if (!nat) { setError("nationality", "Enter your nationality"); ok = false; }
    if (!fr)  { setError("from",        "Enter where you're based");  ok = false; }
    if (!dst) { setError("destination", "Enter a destination city");  ok = false; }

    // We do NOT block nationality == from. A Russian citizen CAN be based
    // in Russia; that's a legitimate query ("am I OK to fly domestic?").
    // Sanctioned-destination detection moved to the LLM (it knows the
    // country inferred from the destination city). The frontend sanctioned
    // notice is hidden by default; the LLM emits it via caveats when needed.
    sanctionedUI.hidden = true;

    submitBtn.disabled = !ok;
    return ok;
  }

  function refreshSubmitState() {
    const ok =
      !!readField(nationalityEl) &&
      !!readField(fromEl) &&
      !!readField(destinationEl);
    submitBtn.disabled = !ok;
  }
  [nationalityEl, fromEl, destinationEl].forEach((el) => {
    el.addEventListener("input",  refreshSubmitState);
    el.addEventListener("change", refreshSubmitState);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validate()) return;

    const input = {
      nationality: readField(nationalityEl),
      from:        readField(fromEl),
      destination: readField(destinationEl),
      date:        new Date().toISOString().slice(0, 10),
      purpose:     "business",
      comments:    readField(commentsEl),
    };

    try {
      localStorage.setItem("visa-advisor.last-input", JSON.stringify(input));
    } catch { /* quota or privacy mode — ignore */ }

    onSubmit(input);
  });

  clearErrors();
  submitBtn.disabled = !readField(nationalityEl) || !readField(fromEl) || !readField(destinationEl);

  return {
    getFormData() {
      return {
        nationality: readField(nationalityEl),
        from:        readField(fromEl),
        destination: readField(destinationEl),
        date:        new Date().toISOString().slice(0, 10),
        purpose:     "business",
        comments:    readField(commentsEl),
      };
    },
    setFormData(data) {
      if (data.nationality) nationalityEl.value = data.nationality;
      if (data.from)        fromEl.value        = data.from;
      if (data.destination) destinationEl.value = data.destination;
      if (data.comments)    commentsEl.value    = data.comments;
      refreshSubmitState();
    },
  };
}

/* ──────────────────────────────────────────────────────────
   v0.4 REPORT RENDERER
   ────────────────────────────────────────────────────────── */

const STATUS_CLASS = {
  "visa-free": "status-badge--visa-free",
  "eta required": "status-badge--eta",
  "evisa required": "status-badge--evisa",
  "visa on arrival": "status-badge--voa",
  "embassy / consulate visa required": "status-badge--embassy",
  "admission restricted / banned": "status-badge--restricted",
};
const STATUS_TONE = {
  "visa-free": "visa-free",
  "eta required": "eta",
  "evisa required": "evisa",
  "visa on arrival": "voa",
  "embassy / consulate visa required": "embassy",
  "admission restricted / banned": "restricted",
};
const STATUS_ICON = {
  "visa-free": "check_circle",
  "eta required": "flight",
  "evisa required": "description",
  "visa on arrival": "badge",
  "embassy / consulate visa required": "account_balance",
  "admission restricted / banned": "block",
};

/* Critical-type → icon + Material Symbol + tone. */
const CRITICAL_TYPE_META = {
  money:    { icon: "attach_money",       tone: "money"    },
  deadline: { icon: "schedule",           tone: "deadline" },
  entry:    { icon: "block",              tone: "entry"    },
  doc:      { icon: "description",        tone: "doc"      },
  stale:    { icon: "history_toggle_off", tone: "stale"    },
};
/* Matches a critical marker at the start of a heading or bullet:
 *   "🚨 [MONEY] Fee"
 *   "🚨 Fee"             (v0.3 compat — no type)
 * The [TYPE] group is optional; type is undefined for untyped markers. */
const CRITICAL_HEADING_RE = /^[\s\u00A0]*🚨(?:\s*\[(MONEY|DEADLINE|ENTRY|DOC|STALE)\])?\s*/i;

/* ------------------------------------------------------------
   v0.9 — inline phrase highlighter
   Wraps key tokens in <mark class="hl-sm"> so they pop visually the
   same way the "in seconds." and ".gov" highlights do in the form
   heading. Used on the visa status badge, allowed-stay, fee, processing
   time, and the required-documents body.
   ------------------------------------------------------------ */

/* Escape special regex chars for safe assembly of alternations. */
function regexEscape(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* Patterns are merged into a single alternation so a single pass never
   double-wraps overlapping matches. Order matters — longer patterns
   (multi-word tokens, ranges) must come before their shorter substrings. */
const HL_TOKENS = [
  // Status strings (must come before shorter substrings like "Visa-free" / "ETA")
  "Embassy / consulate visa required",
  "Professional counsel required",
  "eTA required",
  "eVisa required",
  "Visa on arrival",
  "Visa-free",
  // Authorisation & form names
  "consular jurisdiction", "Schengen visa",
  "embassy appointment", "Yellow Fever",
  "Schengen", "eVisa", "ETIAS", "ESTA", "DS-160",
  "apostille", "apostilled", "biometrics", "reciprocity", "ETA",
];

const HL_TOKEN_GROUP = HL_TOKENS.map(regexEscape).join("|");

/* Stay window: "90 days within any 180-day period" or "30 days". */
const HL_STAY_RE_SRC =
  `(\\d+\\s*(?:hours?|days?|weeks?|months?)(?:\\s+within\\s+any\\s+\\d+\\s*[-–]?\\s*day\\s+period)?)`;

/* Processing-time range: "15–45 calendar days" or "30 calendar days".
   Note: this matches plain day counts which also overlap with HL_STAY_RE —
   the alternation above lists the longer-with-context variant first so
   it wins on greedy left-to-right alternation. */
const HL_DAYS_RE_SRC =
  `(\\d+\\s*[-–]\\s*\\d+\\s*(?:calendar|business|working)?\\s*days?|\\d+\\s*(?:calendar|business|working)?\\s*days?)`;

/* Money: ~90 EUR, 90 EUR, $50 USD, 90€, EUR 50, €30, etc. */
const HL_MONEY_RE_SRC =
  `(?:~\\$?\\s*\\d+(?:[,.]\\d+)?|\\d+[-–]\\d+|(?:USD|EUR|GBP|RUB|CAD|AUD|JPY|CNY|CHF|\\$|€|£|¥|₽|₹)\\s*\\d+(?:[,.]\\d+)?)\\s*(?:USD|EUR|GBP|RUB|CAD|AUD|JPY|CNY|CHF|\\$|€|£|¥|₽|₹)?`;

/* Single combined regex with case-insensitive flag. Longest alternatives
   first, then shorter ones — alternation is left-biased. */
const HL_RE = new RegExp(
  `\\b(?:${HL_TOKEN_GROUP})\\b|${HL_STAY_RE_SRC}|${HL_DAYS_RE_SRC}|${HL_MONEY_RE_SRC}`,
  "gi"
);

/* Wrap a single occurrence. The strings we feed in are plain LLM output
   (no prior <mark>), so a straight escape → regex → mark pipeline is
   safe. Re-running hl() on already-wrapped text would double-wrap; we
   never do that — the function is called once on each freshly-rendered
   section value. */
function hl(s) {
  if (!s || typeof s !== "string") return "";
  // Trim trailing whitespace that the money/stay regex may have eaten
  // (e.g. "EUR 50 fee" → match "EUR 50 " with trailing space → strip it).
  return escapeHtml(s).replace(HL_RE, (m) => {
    const trimmed = m.replace(/\s+$/, "");
    return `<mark class="hl-sm">${trimmed}</mark>`;
  });
}

/* ------------------------------------------------------------
   v0.9 — route-keyed report cache (Back-to-report opens cached)
   One entry per (nationality, from, destination) tuple. TTL 12h.
   Capped at 8 most-recent entries; oldest pruned on insert.
   Stored in localStorage so the Back-to-last-report pill works
   across tab closes.
   ------------------------------------------------------------ */
const CACHE_PREFIX = "visa-advisor.report.";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 8;

function reportCacheKey(input) {
  return [input.nationality, input.from, input.destination || ""]
    .map((s) => String(s || "").trim().toLowerCase())
    .join("|");
}

export function readReportCache(input) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + reportCacheKey(input));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.ts !== "number" || (Date.now() - parsed.ts) > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_PREFIX + reportCacheKey(input));
      return null;
    }
    if (typeof parsed.markdown !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeReportCache(input, envelope) {
  const key = reportCacheKey(input);
  const payload = { ...envelope, ts: Date.now() };
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(payload));
    pruneReportCache();
  } catch {
    /* quota / private mode — ignore */
  }
}

function pruneReportCache() {
  try {
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) entries.push(k);
    }
    if (entries.length <= CACHE_MAX_ENTRIES) return;
    entries.sort((a, b) => {
      const ta = safeParseTs(localStorage.getItem(a)) || 0;
      const tb = safeParseTs(localStorage.getItem(b)) || 0;
      return ta - tb;
    });
    const drop = entries.length - CACHE_MAX_ENTRIES;
    for (let i = 0; i < drop; i++) localStorage.removeItem(entries[i]);
  } catch {
    /* ignore */
  }
}

function safeParseTs(raw) {
  try { return JSON.parse(raw).ts; } catch { return null; }
}

function reportCacheAgeText(envelope) {
  if (!envelope || typeof envelope.ts !== "number") return "";
  const ageMs = Date.now() - envelope.ts;
  const min = Math.floor(ageMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hr ago`;
  return new Date(envelope.ts).toLocaleString();
}

/* ──────────────────────────────────────────────────────────
   PUBLIC: renderReport(body, markdown, annotations, critical, caveats, research)
   ────────────────────────────────────────────────────────── */

/**
 * @param {HTMLElement} body
 * @param {string}      markdown     LLM-produced markdown with `### ` sections
 * @param {Array<{title,url,start,end,snippet}>} annotations  span-level url_citation
 *                                          annotations returned by the API.
 *                                          May be empty/undefined for the
 *                                          zero-annotation fallback.
 * @param {Array<{label,value,source,type}>}    critical    typed critical facts
 *                                          for the "Before you book" card.
 *                                          May be empty/undefined.
 * @param {string}      [caveats]    optional ⚠️ callout text
 * @param {object}      [research]   v0.5 deep-research envelope:
 *                                          { searchQueries: string[],
 *                                            sources:       Array<{title,url,domain}>,
 *                                            sourcesReturned: number,
 *                                            researchWarning: string }
 */
export function renderReport(body, markdown, annotations, critical, caveats, research) {
  body.innerHTML = "";

  const sections  = parseSections(markdown);
  const titles    = sections.__titles || {};
  const ann       = Array.isArray(annotations) ? annotations : [];
  const crit      = Array.isArray(critical)     ? critical   : [];
  const searchQs  = Array.isArray(research?.searchQueries) ? research.searchQueries : [];
  const sources   = Array.isArray(research?.sources)       ? research.sources       : [];
  const meta      = extractMeta(markdown);

  // Status hero
  if (sections.visaStatus) {
    body.appendChild(renderStatus(sections.visaStatus, sections.allowedStay));
  }

  // Partial-research warning banner (v0.5) — surfaces when the worker
  // came up short of the 15-distinct-source minimum even after the
  // auto-retry. Kept (it's a meaningful signal); the zero-annotation
  // "Web research did not return grounded sources" banner was removed
  // per product feedback — it was always-on and noisy.
  if (research?.researchWarning && research.researchWarning.trim()) {
    body.appendChild(renderResearchWarning(research.researchWarning.trim(), research.sourcesReturned));
  }

  // "Before you book" numbered checklist (critical types drive color)
  if (crit.length) {
    body.appendChild(renderBeforeYouBook(crit, sections, ann));
  }

  // Required documents — bullets get per-source verify links
  if (sections.requiredDocs) {
    body.appendChild(renderDocsSection(sections.requiredDocs, titles.requiredDocs, ann, markdown));
  }

  // Passport validity, Fee, Processing time — small grid
  const grid = document.createElement("div");
  grid.className = "report-grid";
  if (sections.passportValidity) grid.appendChild(renderMetaSection(titles.passportValidity || "Passport validity", "passport", sections.passportValidity));
  if (sections.fee)              grid.appendChild(renderMetaSection(titles.fee              || "Fee",              "fee",      sections.fee));
  if (sections.processingTime)   grid.appendChild(renderMetaSection(titles.processingTime   || "Processing time",  "time",     sections.processingTime));
  if (grid.children.length) body.appendChild(grid);

  // Official URL CTA
  if (sections.officialUrl && /^https?:\/\//.test(sections.officialUrl.trim())) {
    body.appendChild(renderCta(sections.officialUrl));
  } else if (sections.officialUrl) {
    body.appendChild(renderMetaSection(titles.officialUrl || "Official application", "shield", sections.officialUrl));
  }

  // Exception rules — bullets with verify links
  if (sections.exceptions && sections.exceptions !== "None identified") {
    body.appendChild(renderBulletSection(titles.exceptions || "Exception rules", "rule", sections.exceptions, ann, { fullMarkdown: markdown }));
  }

  // Travel advisories — bullets with verify links, collapsible (open by default)
  if (sections.advisories && sections.advisories !== "None relevant") {
    body.appendChild(renderBulletSection(titles.advisories || "Travel advisories", "campaign", sections.advisories, ann, { collapsible: true, fullMarkdown: markdown }));
  }

  // Research log — every search query the LLM ran (v0.5)
  if (searchQs.length) {
    body.appendChild(renderResearchLog(searchQs));
  }

  // Sources (N) — v0.8 tag cloud split by cited vs surveyed.
  let sourcesSection = null;
  if (sources.length) {
    const citedUrls = new Set(
      crit.map((c) => (c.source || "").trim()).filter((u) => /^https?:\/\//.test(u))
    );
    sourcesSection = renderSourcesSection(sources, citedUrls);
    body.appendChild(sourcesSection);
  }

  // v0.7.1 — async HEAD reachability probe (L3). Runs after render so the
  // user sees the report immediately and the dots fill in as probes resolve.
  if (sourcesSection) {
    verifySources(sourcesSection, sources);
  }

  // Last verified + research stats line
  const metaLineParts = [];
  if (meta.lastVerified)         metaLineParts.push(`Last verified: ${meta.lastVerified}`);
  const citedCount = new Set(
    crit.map((c) => (c.source || "").trim()).filter((u) => /^https?:\/\//.test(u))
  ).size;
  if (searchQs.length || sources.length || ann.length) {
    metaLineParts.push(renderResearchMetaLine({
      queries:        searchQs.length,
      citedSources:   citedCount,
      sources:        sources.length,
      inlineCitations: ann.length,
    }));
  }

  // v0.7.1+ — defensive: if every parsed `### ` heading was empty, don't
  // leave the report body silently empty (previously this branch only
  // fired when sources[] was non-empty, so a heading-format break with
  // zero sources rendered nothing at all but the meta line + disclaimer).
  // Instead always fall back to showing the raw markdown so the user
  // gets *something* readable even when the contract drifts.
  const sectionKeys = ["visaStatus","allowedStay","passportValidity","fee","processingTime","requiredDocs","officialUrl","exceptions","advisories"];
  const filledKeys = sectionKeys.filter((k) => sections[k] && String(sections[k]).trim());
  if (filledKeys.length === 0) {
    body.insertBefore(renderRawMarkdownFallback(markdown, sources.length), body.firstChild);
    console.warn("[visa-advisor] renderReport: no parsed sections, falling back to raw markdown. markdown length:", (markdown || "").length);
  }
  if (metaLineParts.length) {
    const meta_el = document.createElement("p");
    meta_el.className = "report-meta";
    meta_el.innerHTML = metaLineParts.join(" &nbsp;·&nbsp; ");
    body.appendChild(meta_el);
  }

  // Disclaimer (always last)
  body.appendChild(renderDisclaimer(meta.lastVerified));

  // Caveats callout (above disclaimer)
  if (caveats && caveats.trim()) {
    const dis = body.querySelector(".report-disclaimer");
    if (dis) body.insertBefore(renderCaveats(caveats), dis);
  }

  // Post-render: strip 🚨 [TYPE] markers and tag the right CSS classes.
  markCriticalFacts(body);

  // Activate the shared tooltip singleton (idempotent — safe to call repeatedly).
  ensureTooltip();
}

/* ---- Section parser ---- */
function parseSections(md) {
  const out = {};
  const titles = {};
  if (!md) { out.__titles = titles; return out; }

  /* Layer-1 — strict path: split on `\n### ` (the prompt's H3 contract). */
  const h3 = md.split(/^###\s+/m).slice(1);
  h3.forEach((block) => {
    const nl = block.indexOf("\n");
    const title = block.slice(0, nl).trim();
    const body  = block.slice(nl + 1).trim();
    const slug  = slugify(title);
    if (slug && slug !== title && body) {
      out[slug]    = body;
      titles[slug] = title;
    }
  });

  /* Layer-2 — tolerant fallbacks. Only run if the strict path found
     none of the canonical sections. Lets the report render when the
     LLM emits a slightly different heading style. */
  const CANONICAL = ["visaStatus","allowedStay","passportValidity","fee","processingTime","requiredDocs","officialUrl","exceptions","advisories","lastVerified"];
  const filled = CANONICAL.filter((k) => out[k] && String(out[k]).trim());
  if (!filled.length) {
    /* Fallback A — `## ` H2 headings */
    const h2 = md.split(/^##\s+/m).slice(1);
    h2.forEach((block) => {
      const nl = block.indexOf("\n");
      const title = block.slice(0, nl).trim();
      const body  = block.slice(nl + 1).trim();
      const slug  = slugify(title);
      if (CANONICAL.includes(slug) && body && !out[slug]) {
        out[slug]    = body;
        titles[slug] = title;
      }
    });
  }
  if (!filled.length) {
    /* Fallback B — `**Section name**` bold paragraphs immediately followed
       by body content (separated by a blank line or newline). */
    const boldRe = /^\*\*([^*]+)\*\*\s*[:\n]+([\s\S]*?)(?=^\*\*[^*]+\*\*|\Z)/gm;
    let m;
    while ((m = boldRe.exec(md)) !== null) {
      const title = m[1].trim();
      const body  = (m[2] || "").trim();
      const slug  = slugify(title);
      if (CANONICAL.includes(slug) && body && !out[slug]) {
        out[slug]    = body;
        titles[slug] = title;
      }
    }
  }
  if (!filled.length) {
    /* Fallback C — plain text "Section name:" followed by newline + body. */
    const colonRe = /^([A-Z][^:\n]{2,60}):\s*\n([\s\S]*?)(?=^[A-Z][^:\n]{2,60}:\s*\n|\Z)/gm;
    let m;
    while ((m = colonRe.exec(md)) !== null) {
      const title = m[1].trim();
      const body  = (m[2] || "").trim();
      const slug  = slugify(title);
      if (CANONICAL.includes(slug) && body && !out[slug]) {
        out[slug]    = body;
        titles[slug] = title;
      }
    }
  }
  out.__titles = titles;
  return out;
}

function slugify(t) {
  // Strip leading 🚨 and [TYPE] decorations before tokenising, so
  // "🚨 [MONEY] Fee" → slug "fee", not "money".
  const cleaned = String(t || "")
    .replace(/^🚨\s*/, "")
    .replace(/^\[[A-Z]+\]\s*/, "")
    .replace(/^[^\p{L}\p{N}]+/u, "");
  const firstWord = cleaned.toLowerCase().replace(/[^a-z]+/g, " ").trim().split(" ")[0];
  const map = {
    "visa":      "visaStatus",
    "allowed":   "allowedStay",
    "passport":  "passportValidity",
    "fee":       "fee",
    "typical":   "processingTime",
    "required":  "requiredDocs",
    "official":  "officialUrl",
    "exception": "exceptions",
    "travel":    "advisories",
    "last":      "lastVerified",
    "sources":   "sources",
    "disclaimer":"disclaimer",
  };
  return map[firstWord] || firstWord;
}

/* Find the character offset of a section's body within the full markdown,
   so annotation offsets from the API (which are relative to the full
   response) can be translated to body-local coords for bullet matching. */
function findSectionOffset(markdown, rawTitle) {
  if (!rawTitle || !markdown) return 0;
  const lines = markdown.split("\n");
  let pos = 0;
  // Compare by stripping decorations from both sides.
  const target = rawTitle
    .replace(/^🚨\s*(?:\[[A-Z]+\]\s*)?/, "")
    .trim()
    .toLowerCase();
  for (const line of lines) {
    if (line.startsWith("### ")) {
      const cleanLine = line.slice(4)
        .replace(/^🚨\s*(?:\[[A-Z]+\]\s*)?/, "")
        .trim()
        .toLowerCase();
      if (cleanLine === target) {
        return pos + line.length + 1; // +1 for newline
      }
    }
    pos += line.length + 1;
  }
  return 0;
}

/* Strip the 🚨 [TYPE] decoration from a heading for display purposes. */
function stripCriticalPrefix(title) {
  return String(title || "")
    .replace(/^🚨\s*/, "")
    .replace(/^\[[A-Z]+\]\s*/, "")
    .trim();
}

function annotationsForBody(annotations, bodyOffset) {
  // Translate API offsets (in full markdown) to body-local. Filter out
  // annotations that fall entirely outside this section's body.
  return annotations
    .map(a => {
      if (a.start < 0 || a.end < 0) return a;
      return { ...a, _localStart: a.start - bodyOffset, _localEnd: a.end - bodyOffset };
    })
    .filter(a => {
      if (a.start < 0 || a.end < 0) return true; // keep orphans
      return a._localEnd > 0 && a._localStart < Number.MAX_SAFE_INTEGER;
    });
}

function extractMeta(md) {
  const last = md.match(/### Last verified\s*\n+([\d-]+)/i);
  return { lastVerified: last ? last[1] : new Date().toISOString().slice(0, 10) };
}

/* ──────────────────────────────────────────────────────────
   v0.4 — Bullet char-range mapper
   Walks the markdown to find every "- foo" / "* foo" line and records
   its [start, end] character range in the markdown. Used to map
   API annotations → bullets by char-range overlap.
   ────────────────────────────────────────────────────────── */

function buildBulletCharMap(markdown) {
  const bullets = [];
  let pos = 0;
  for (const line of markdown.split("\n")) {
    const m = line.match(/^(\s*[-*•]\s+)(.*)/);
    if (m && m[2].trim()) {
      const contentStart = pos + m[1].length;
      const contentEnd   = contentStart + m[2].length;
      bullets.push({ start: contentStart, end: contentEnd, content: m[2] });
    }
    pos += line.length + 1; // +1 for \n
  }
  return bullets;
}

function annotationsForBullet(bullet, annotations) {
  // Annotations may carry `_localStart` / `_localEnd` (body-local) OR
  // `start` / `end` (full-markdown). Try local first.
  return annotations.filter(a => {
    const s = a._localStart ?? a.start;
    const e = a._localEnd   ?? a.end;
    if (s < 0 || e < 0) return false;
    return s < bullet.end && e > bullet.start;
  });
}

/* If an annotation has no start/end (URL-only with no span), attach it
   to the nearest bullet by content proximity. */
function attachUrlOnlyAnnotations(bullets, annotations) {
  const positioned = annotations.filter(a => {
    const s = a._localStart ?? a.start;
    const e = a._localEnd   ?? a.end;
    return s >= 0 && e >= 0;
  });
  const orphan     = annotations.filter(a => {
    const s = a._localStart ?? a.start;
    return !(s >= 0);
  });
  if (!orphan.length || !bullets.length) return bullets.map(b => ({
    ...b, annotations: annotationsForBullet(b, positioned),
  }));
  // For each orphan, attach to the first bullet (best-effort).
  return bullets.map((b, i) => ({
    ...b,
    annotations: [
      ...annotationsForBullet(b, positioned),
      ...(i === 0 ? orphan : []),
    ],
  }));
}

/* Deduplicate annotations by URL — same URL cited multiple times for one
   bullet collapses to one verify link. */
function dedupeByUrl(list) {
  const seen = new Set();
  const out = [];
  for (const a of list) {
    if (!a.url) continue;
    if (seen.has(a.url)) continue;
    seen.add(a.url);
    out.push(a);
  }
  return out;
}

/* ──────────────────────────────────────────────────────────
   v0.4 — Renderers
   ────────────────────────────────────────────────────────── */

function renderStatus(status, stay) {
  const wrap = document.createElement("section");
  wrap.setAttribute("aria-labelledby", "report-status-title");

  const normalized = status.trim().toLowerCase();
  const key = Object.keys(STATUS_CLASS).find(k => normalized.includes(k)) || "embassy";
  const cls = STATUS_CLASS[key];
  const tone = STATUS_TONE[key];
  const glyph = STATUS_ICON[key];
  wrap.className = `report-status report-status--${tone}`;

  wrap.innerHTML = `
    <span class="status-badge ${cls}" id="report-status-title" role="status">
      <span class="icon-chip icon-chip--${tone}" aria-hidden="true"><span class="material-symbols-outlined">${glyph}</span></span>
      <span>${hl(status.trim())}</span>
    </span>
    ${stay && stay !== "N/A" ? `
      <div class="status-stay">
        <div class="status-stay-label">Allowed stay</div>
        <div class="status-stay-value">${hl(stay.trim())}</div>
      </div>
    ` : ""}
  `;
  return wrap;
}

function renderUnverifiedBanner() {
  /* Removed in v0.9 — the always-on "Web research did not return grounded
     sources" banner was dropped from the report UI. The Disclaimer already
     tells the user to verify with the embassy, so the duplicate warning
     was redundant. Kept as an empty stub for one release in case we want
     to surface it behind a different signal (e.g. serverSearchAvailable
     === false AND zero annotations). */
  return document.createDocumentFragment();
}

/* v0.5 — amber "research was partial" banner. Shown when the worker came
   up short of the 15-distinct-source minimum even after the auto-retry. */
function renderResearchWarning(message, sourcesReturned) {
  const el = document.createElement("div");
  el.className = "report-research-warning";
  el.setAttribute("role", "alert");
  el.innerHTML = `
    <span class="material-symbols-outlined" aria-hidden="true">warning</span>
    <div>
      <strong>Research was partial.</strong>
      ${escapeHtml(message)}
    </div>
  `;
  return el;
}

/* Shown when parseSections() found none of the canonical headings —
   renders the raw markdown text so the user sees the advisor's actual
   answer instead of an empty report body. */
function renderRawMarkdownFallback(markdown, sourcesCount) {
  const wrap = document.createElement("div");
  wrap.className = "report-section";
  wrap.style.borderLeft = "3px solid var(--extensions-background-warning, #FFC13C)";
  wrap.style.background = "var(--extensions-background-lightwarning, #FFF1C0)";
  const note = sourcesCount > 0
    ? `The advisor returned <strong>${sourcesCount}</strong> source${sourcesCount === 1 ? "" : "s"} but no parsed sections ` +
      `(<code style="font-family:var(--font-family-mono);">### </code> visa status, fee, processing, docs, etc.). Showing the raw response below.`
    : `The advisor's response didn't match the expected report format. Showing the raw response below.`;
  wrap.innerHTML = `
    <div class="report-section-title">
      <span class="material-symbols-outlined">warning_amber</span>
      Report format unrecognized
    </div>
    <p class="report-section-value">${note}</p>
    <pre class="report-raw-markdown">${escapeHtml((markdown || "").trim())}</pre>
  `;
  return wrap;
}

/* v0.5 — collapsible "Research log" section listing every search query the
   LLM actually ran. Open by default — user can collapse if not interested. */
function renderResearchLog(queries) {
  const sec = document.createElement("details");
  sec.className = "report-section report-section--collapsible report-research-log";
  sec.open = true;

  const items = queries.map(q =>
    `<li class="report-research-log-item">${escapeHtml(q)}</li>`
  ).join("");

  sec.innerHTML = `
    <summary class="report-section-summary">
      <h2 class="report-section-title">
        <span class="icon-chip icon-chip--neutral" aria-hidden="true">
          <span class="material-symbols-outlined">travel_explore</span>
        </span>
        Research log
        <span class="report-section-count">${queries.length} ${queries.length === 1 ? "search" : "searches"}</span>
      </h2>
    </summary>
    <ol class="report-research-log-list">${items}</ol>
  `;
  return sec;
}

/* v0.8 — "Sources (N)" section rendered as two stacked tag clusters:
     (1) Cited in this report  — green-filled pill chips, URL appears in
         critical[].source.
     (2) Surveyed but not cited — outlined pill chips, worker collected them
         but the LLM didn't cite them inline.
   Each chip shows the short site name (registrable domain), wraps naturally
   onto multiple rows, is a clickable hyperlink, and carries a `data-source-url`
   attribute that the v0.7.1 reachability probe keys off. Sorted by criticality
   within each cluster. */

function shortSite(source) {
  if (source && source.domain && source.domain.length) {
    return source.domain.replace(/^www\./, "");
  }
  try {
    const host = new URL(source.url).hostname.replace(/^www\./, "");
    const parts = host.split(".");
    if (parts.length <= 2) return host;
    const lastTwo = parts.slice(-2).join(".");
    const lastThree = parts.slice(-3).join(".");
    const twoPartTlds = ["co.uk","co.jp","com.au","co.nz","com.br","co.in","ac.uk","gov.uk"];
    if (twoPartTlds.includes(lastTwo)) return lastThree;
    return lastTwo;
  } catch {
    return (source.url || "").slice(0, 24);
  }
}

function criticalityTier(source) {
  const dom = (source.domain || "").toLowerCase();
  if (/\.(gov|gouv|go\.jp)$/.test(dom))            return 0; // authoritative gov
  if (/(wikipedia|iatatravelcentre|passportindex)/.test(dom)) return 1;
  if (/(un\.int|nato\.int|europa\.eu)/.test(dom))   return 2; // multilateral
  return 3;
}

function sortSources(arr) {
  return arr.slice().sort((a, b) => {
    const ta = criticalityTier(a);
    const tb = criticalityTier(b);
    if (ta !== tb) return ta - tb;
    const da = (a.domain || "").toLowerCase();
    const db = (b.domain || "").toLowerCase();
    if (da !== db) return da.localeCompare(db);
    return (a.url || "").localeCompare(b.url || "");
  });
}

function renderSourceChip(s, cited) {
  const safeUrl   = escapeHtmlAttr(s.url);
  const site      = escapeHtml(shortSite(s) || s.url);
  const titleAttr = escapeHtmlAttr(s.url);
  return `<a class="report-source-tag ${cited ? "is-cited" : "is-surveyed"}"
    href="${safeUrl}"
    target="_blank"
    rel="noopener noreferrer"
    title="${titleAttr}"
    data-source-url="${safeUrl}">
    <span class="reach-dot" data-reach="pending" aria-hidden="true"></span>
    <span class="tag-label">${site}</span>
  </a>`;
}

function renderSourcesCluster(sources, cited, label) {
  const sorted = sortSources(sources);
  const chipsHtml = sorted.map((s) => renderSourceChip(s, cited)).join("");
  const safeLabel = escapeHtml(label);
  return `<div class="report-sources-cluster">
    <div class="report-sources-cluster-label">${safeLabel} — ${sources.length}</div>
    <div class="report-sources-tags">${chipsHtml}</div>
  </div>`;
}

function renderSourcesSection(sources, citedUrls) {
  const cited = sources.filter((s) => citedUrls && citedUrls.has(s.url));
  const surveyed = sources.filter((s) => !citedUrls || !citedUrls.has(s.url));

  const clusters = [];
  if (cited.length) {
    clusters.push(renderSourcesCluster(cited, true, "Cited in this report"));
  }
  if (surveyed.length) {
    clusters.push(renderSourcesCluster(surveyed, false, "Surveyed but not cited"));
  }

  const sec = document.createElement("section");
  sec.className = "report-section report-sources";
  sec.innerHTML = `
    <h2 class="report-section-title">
      <span class="icon-chip icon-chip--neutral" aria-hidden="true">
        <span class="material-symbols-outlined">source</span>
      </span>
      Sources
      <span class="report-section-count">${sources.length} ${sources.length === 1 ? "source" : "sources"}</span>
    </h2>
    ${clusters.join("")}
    <p class="report-source-reach-summary" data-reach-summary>Reachability: probing 0 / ${sources.length} …</p>
  `;
  return sec;
}

/* v0.7.1 — L3 reachability probe.
   - Concurrency cap 5, per-request timeout 3s.
   - Uses fetch({method:'HEAD', mode:'no-cors'}) so opaque responses
     bypass CORS preflight — but `no-cors` also means we can never read
     the actual HTTP status. A 404/500 behind CORS still resolves the
     fetch promise (it just can't be inspected), so "ok" here only means
     "something answered the connection," not "verified 200 OK." The
     labels below are worded to reflect that rather than overstate
     confidence.
   - Updates each row's [data-reach] span and the summary line. */
async function verifySources(sectionEl, sources) {
  const rows = Array.from(sectionEl.querySelectorAll(".report-source-tag[data-source-url]"));
  const summary = sectionEl.querySelector("[data-reach-summary]");
  const counts = { ok: 0, warn: 0, err: 0, pending: rows.length };

  function tally() {
    if (summary) summary.textContent =
      `Reachability: ${counts.ok} / ${sources.length} sources responded · ` +
      `${counts.err} failed to connect · ${counts.warn} timed out`;
  }
  tally();

  const queue = sources.map((s, i) => ({ s, row: rows[i] })).filter((x) => x.row);
  const inFlight = new Set();
  const PROBE_TIMEOUT_MS = 3000;
  const MAX_IN_FLIGHT = 5;

  async function probeOne(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    try {
      await fetch(url, { method: "HEAD", mode: "no-cors", signal: ctrl.signal, cache: "no-store" });
      return "ok";          // opaque response, status unreadable — "responded", not "verified 200"
    } catch (err) {
      if (err && err.name === "AbortError") return "warn";
      return "err";         // DNS / network / CORS preflight failure
    } finally {
      clearTimeout(timer);
    }
  }

  const REACH_LABEL = { ok: "Responded (status unverifiable via CORS)", warn: "Timed out", err: "Failed to connect" };

  async function pump() {
    while (queue.length) {
      while (inFlight.size >= MAX_IN_FLIGHT) {
        await Promise.race(inFlight);
      }
      const next = queue.shift();
      if (!next) break;
      const p = probeOne(next.s.url).then((status) => {
        const dot = next.row.querySelector("[data-reach]");
        if (dot) {
          dot.dataset.reach = status;
          dot.setAttribute("aria-label", REACH_LABEL[status] || status);
          dot.title = REACH_LABEL[status] || status;
        }
        counts.pending--;
        counts[status] = (counts[status] || 0) + 1;
        tally();
        inFlight.delete(p);
      });
      inFlight.add(p);
    }
  }

  await pump();
}

function groupSourcesByDomain(sources) {
  const out = {};
  for (const s of sources) {
    const d = (s.domain || "").trim().toLowerCase() || "unknown";
    if (!out[d]) out[d] = [];
    out[d].push(s);
  }
  return out;
}

/* v0.5 — small meta-line fragment. v0.7.1 added citedSources split. */
function renderResearchMetaLine({ queries, citedSources, sources, inlineCitations }) {
  const parts = [];
  if (queries)         parts.push(`<strong>${queries}</strong> ${queries === 1 ? "search" : "searches"}`);
  if (citedSources)   parts.push(`<strong>${citedSources}</strong> cited`);
  if (sources)         parts.push(`<strong>${sources}</strong> surveyed`);
  if (inlineCitations) parts.push(`<strong>${inlineCitations}</strong> inline ${inlineCitations === 1 ? "citation" : "citations"}`);
  if (!parts.length)   return "";
  return `Research: ${parts.join(" · ")}`;
}

function renderBeforeYouBook(critical, sections, annotations) {
  const wrap = document.createElement("aside");
  wrap.className = "before-you-book";
  wrap.setAttribute("role", "region");
  wrap.setAttribute("aria-labelledby", "before-you-book-title");

  const items = critical.map((c, i) => {
    const type = c.type && CRITICAL_TYPE_META[c.type] ? c.type : "";
    const meta = type ? CRITICAL_TYPE_META[type] : null;
    const icon = meta ? meta.icon : "flag";
    const tone = meta ? meta.tone : "neutral";
    const label = escapeHtml((c.label || "").trim() || `Step ${i + 1}`);
    const value = escapeHtml((c.value || "").trim());
    const source = (c.source || "").trim();
    const lookupUrl = source && /^https?:\/\//.test(source) ? source : "";
    const verify = lookupUrl
      ? `<a class="critical-step-verify" href="${escapeAttr(lookupUrl)}" target="_blank" rel="noopener noreferrer" data-snippet="${escapeAttr(`Step ${i + 1}: ${c.label || ""}`)}">↗ Verify</a>`
      : "";
    const cls = type ? `critical-step critical-step--${type}` : "critical-step";
    return `
      <li class="${cls}" data-critical-type="${type}">
        <span class="critical-step-number" aria-hidden="true">${i + 1}</span>
        <span class="critical-step-icon icon-chip icon-chip--critical-${tone}" aria-hidden="true">
          <span class="material-symbols-outlined">${icon}</span>
        </span>
        <div class="critical-step-body">
          <div class="critical-step-label">${label}</div>
          ${value ? `<div class="critical-step-value">${value}</div>` : ""}
        </div>
        ${verify}
      </li>
    `;
  }).join("");

  wrap.innerHTML = `
    <h2 id="before-you-book-title" class="before-you-book-title">
      <span class="material-symbols-outlined" aria-hidden="true">priority_high</span>
      Before you book
    </h2>
    <ol class="before-you-book-list">${items}</ol>
  `;
  return wrap;
}

function renderDocsSection(md, rawTitle, annotations, fullMarkdown) {
  return renderBulletSection(rawTitle || "Required documents (typical)", "docs", md, annotations, { fullMarkdown });
}

function renderBulletSection(rawTitle, iconName, md, annotations, opts = {}) {
  const sec = opts.collapsible ? document.createElement("details") : document.createElement("section");
  sec.className = opts.collapsible ? "report-section report-section--collapsible" : "report-section";
  if (opts.collapsible) sec.open = true;  // open by default; user can collapse

  const headingHtml = `
    <h2 class="report-section-title">
      <span class="icon-chip icon-chip--neutral" aria-hidden="true">
        <span class="material-symbols-outlined">${iconName === "docs" ? "article" : iconName === "rule" ? "rule" : iconName === "campaign" ? "campaign" : "info"}</span>
      </span>
      ${escapeHtml(rawTitle || "")}
    </h2>
  `;

  if (opts.collapsible) {
    sec.innerHTML = `<summary class="report-section-summary">${headingHtml}</summary>`;
  } else {
    sec.innerHTML = headingHtml;
  }

  const list = document.createElement("ul");
  list.className = "report-section-value report-section-value--list report-bullets";

  // Translate annotation offsets from full-markdown coords to body-local.
  const bodyOffset = findSectionOffset(opts.fullMarkdown || "", rawTitle);
  const localAnns = annotationsForBody(annotations || [], bodyOffset);

  const allBullets = buildBulletCharMap(md);
  const items = md.split("\n")
    .map(l => l.replace(/^[-•*]\s+/, "").trim())
    .filter(Boolean);
  const mapWithAnn = attachUrlOnlyAnnotations(allBullets, localAnns);

  items.forEach((text, i) => {
    const li = document.createElement("li");
    li.className = "report-bullet";
    let body = text;
    const inlineMatch = body.match(CRITICAL_HEADING_RE);
    if (inlineMatch) {
      const t = inlineMatch[1] ? inlineMatch[1].toLowerCase() : "";
      body = body.replace(CRITICAL_HEADING_RE, "").trim();
      if (t) {
        li.classList.add("critical-fact", `critical-fact--${t}`);
        li.dataset.criticalType = t;
      } else {
        li.classList.add("critical-fact");
      }
    }
    // Highlight key tokens (Schengen, ETA, $XX USD, 15 days, etc.)
    const html = hl(body);
    if (html.includes("<mark")) {
      // Insert as innerHTML (already escaped + wrapped in <mark>). Kept as a
      // single wrapping span — the li is a flex container (for the bullet
      // dot), and unwrapping this into multiple top-level text/mark nodes
      // would turn each of them into its own flex item, breaking text flow
      // into narrow per-word columns.
      const span = document.createElement("span");
      span.innerHTML = html;
      li.appendChild(span);
    } else {
      li.appendChild(document.createTextNode(body));
    }

    // Use localStart/localEnd (already body-local) for matching.
    const anns = dedupeByUrl((mapWithAnn[i]?.annotations || []).map(a => ({
      ...a,
      start: a._localStart ?? a.start,
      end:   a._localEnd   ?? a.end,
    })));
    if (anns.length) {
      li.appendChild(renderVerifyLinks(anns));
    }
    list.appendChild(li);
  });

  sec.appendChild(list);
  return sec;
}

function renderVerifyLinks(annotations) {
  const wrap = document.createElement("span");
  wrap.className = "verify-links";
  annotations.forEach((a, idx) => {
    if (idx > 0) wrap.appendChild(document.createTextNode(" "));
    const link = document.createElement("a");
    link.className = "verify-link";
    link.href        = a.url;
    link.target      = "_blank";
    link.rel         = "noopener noreferrer";
    link.dataset.title   = a.title || "Source";
    link.dataset.snippet = a.snippet || "";
    link.dataset.verified = a.snippet ? "1" : "0";
    link.setAttribute("aria-describedby", "cite-tooltip-singleton");
    link.textContent = `↗ Verify on ${a.title || "source"}`;
    wrap.appendChild(link);
  });
  return wrap;
}

function renderMetaSection(title, name, value) {
  const sec = document.createElement("section");
  sec.className = "report-section";
  sec.innerHTML = `
    <h2 class="report-section-title">
      ${icon(name)}
      ${escapeHtml(title)}
    </h2>
    <div class="report-section-value">${hl(value.trim())}</div>
  `;
  return sec;
}

function renderCta(url) {
  const sec = document.createElement("section");
  sec.className = "report-section";
  sec.innerHTML = `
    <h2 class="report-section-title">
      ${icon("shield")}
      Official application
    </h2>
    <a class="report-section-value report-section-value--cta" href="${escapeAttr(url.trim())}" target="_blank" rel="noopener noreferrer">
      Open official site
      ${iconRaw("external")}
    </a>
  `;
  return sec;
}

function renderCaveats(text) {
  const wrap = document.createElement("div");
  wrap.className = "report-caveats";
  wrap.setAttribute("role", "note");
  wrap.innerHTML = `
    <div class="report-caveats-title">${icon("warn", "warn")} Caveats</div>
    <div class="report-caveats-body">${escapeHtml(text.trim())}</div>
  `;
  return wrap;
}

function renderDisclaimer(date) {
  const wrap = document.createElement("div");
  wrap.className = "report-disclaimer";
  wrap.innerHTML = `${iconRaw("info")} This is general information based on publicly available sources as of ${escapeHtml(date)}. Visa requirements change frequently and are determined solely by the destination country's authorities. Always verify with the destination embassy or consulate before booking travel. <strong>Not legal advice. Not a substitute for an immigration attorney.</strong>`;
  return wrap;
}

/* ---- Icon helpers ---- */
const ICONS = {
  docs:     "article",
  passport: "contact_page",
  fee:      "credit_card",
  time:     "schedule",
  shield:   "shield",
  rule:     "rule",
  campaign: "campaign",
  warn:     "warning_amber",
  info:     "info",
  external: "arrow_outward",
  refresh:  "refresh",
  help:     "help",
  send:     "send",
};
function icon(name, tone = "neutral") {
  const glyph = ICONS[name] || name;
  return `<span class="icon-chip icon-chip--${tone}" aria-hidden="true"><span class="material-symbols-outlined">${glyph}</span></span>`;
}
function iconRaw(name) {
  const glyph = ICONS[name] || name;
  return `<span class="material-symbols-outlined" aria-hidden="true">${glyph}</span>`;
}

/* ---- Critical-fact marker (strip 🚨 [TYPE] and tag the right CSS classes,
   inject a typed Material Symbol glyph at the start of each section title). */
function markCriticalFacts(rootEl) {
  // Section headings (h2.report-section-title)
  rootEl.querySelectorAll(".report-section-title").forEach((h2) => {
    const first = firstNonEmptyTextNode(h2);
    if (!first) return;
    const m = first.nodeValue.match(CRITICAL_HEADING_RE);
    if (m) {
      const type = m[1] ? m[1].toLowerCase() : "";
      first.nodeValue = first.nodeValue.replace(CRITICAL_HEADING_RE, "").trim();
      const section = h2.closest(".report-section");
      if (section) {
        section.classList.add("is-critical");
        if (type) section.classList.add(`is-critical--${type}`);
        if (type) section.dataset.criticalType = type;
        // Inject a typed Material Symbols glyph in front of the title text.
        const glyph = document.createElement("span");
        glyph.className = "material-symbols-outlined critical-title-glyph" +
                          (type ? " critical-title-glyph--" + type : " critical-title-glyph--default");
        glyph.textContent = "priority_high";
        glyph.setAttribute("aria-hidden", "true");
        // Insert at the very start of the heading (before the icon-chip).
        h2.insertBefore(glyph, h2.firstChild);
      }
    }
  });

  // List items (already handled in renderBulletSection for the typed prefix).
  // This pass catches anything we missed (e.g. plain 🚨 bullets from v0.3
  // backward-compat).
  rootEl.querySelectorAll("li").forEach((li) => {
    if (li.classList.contains("critical-fact")) return;
    const first = firstNonEmptyTextNode(li);
    if (!first || !first.nodeValue.includes("🚨")) return;
    first.nodeValue = first.nodeValue.replace(/🚨\s*/, "").trim();
    li.classList.add("critical-fact");
  });
}

function firstNonEmptyTextNode(el) {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.nodeValue && node.nodeValue.trim()) return node;
  }
  return null;
}

/* ---- Helpers ---- */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeAttr(s) { return escapeHtml(s); }

/* ──────────────────────────────────────────────────────────
   Shared tooltip singleton — shows source title + snippet on hover/focus.
   Same pattern as v0.3, but reads `data-snippet` (API-provided excerpt)
   instead of `data-quote` (LLM-provided verbatim).
   ────────────────────────────────────────────────────────── */

let _tooltipEl = null;
let _tooltipActiveCite = null;

function ensureTooltip() {
  if (_tooltipEl) return _tooltipEl;

  const el = document.createElement("div");
  el.className = "cite-tooltip";
  el.id        = "cite-tooltip-singleton";
  el.setAttribute("role", "tooltip");
  el.setAttribute("aria-hidden", "true");
  el.hidden = true;
  el.innerHTML = `
    <div class="cite-tooltip-source"></div>
    <blockquote class="cite-tooltip-quote"></blockquote>
    <div class="cite-tooltip-foot">
      <span class="cite-tooltip-flag"></span>
      <span class="cite-tooltip-hint">Click to open source</span>
    </div>
  `;
  document.body.appendChild(el);
  _tooltipEl = el;

  document.addEventListener("click", (e) => {
    if (!el.hidden && !e.target.closest(".verify-link") && !e.target.closest(".cite-link")) hideTooltip();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.hidden) {
      hideTooltip();
      const active = document.activeElement;
      if (active && active.classList && (active.classList.contains("verify-link") || active.classList.contains("cite-link"))) {
        active.blur();
      }
    }
  });
  window.addEventListener("scroll", hideTooltip, { passive: true, capture: true });
  window.addEventListener("resize", hideTooltip);

  return el;
}

function showTooltipFor(citeLink) {
  const el = ensureTooltip();
  const sourceTitle = citeLink.dataset.title   || `Source`;
  const snippet     = citeLink.dataset.snippet || "";
  const verified    = citeLink.dataset.verified === "1";

  el.querySelector(".cite-tooltip-source").textContent = sourceTitle + (verified ? "" : "  (unverified)");
  const quoteEl = el.querySelector(".cite-tooltip-quote");
  if (snippet) {
    quoteEl.textContent = `"${snippet}"`;
    quoteEl.classList.remove("cite-tooltip-quote--missing");
  } else {
    quoteEl.textContent = "Source snippet not provided by API";
    quoteEl.classList.add("cite-tooltip-quote--missing");
  }
  el.querySelector(".cite-tooltip-flag").textContent = verified ? "[verified]" : "[unverified]";
  el.querySelector(".cite-tooltip-hint").textContent = verified ? "Click to open source" : "Click to attempt";

  el.hidden = false;
  el.setAttribute("aria-hidden", "false");
  const r = citeLink.getBoundingClientRect();
  el.style.visibility = "hidden";
  el.style.left = "0px";
  el.style.top  = "0px";
  // eslint-disable-next-line no-unused-expressions
  el.offsetHeight;
  const tr = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top  = r.top - tr.height - 8;
  let place = "above";
  if (top < 8) { top = r.bottom + 8; place = "below"; }
  let left = r.left + r.width / 2 - tr.width / 2;
  if (left < 8) left = 8;
  if (left + tr.width > vw - 8) left = vw - tr.width - 8;

  el.style.left = `${left + window.scrollX}px`;
  el.style.top  = `${top  + window.scrollY}px`;
  el.dataset.place = place;
  el.style.visibility = "";

  _tooltipActiveCite = citeLink;
}

function hideTooltip() {
  if (!_tooltipEl || _tooltipEl.hidden) return;
  _tooltipEl.hidden = true;
  _tooltipEl.setAttribute("aria-hidden", "true");
  _tooltipActiveCite = null;
}

document.addEventListener("mouseover", (e) => {
  const link = e.target.closest && e.target.closest(".verify-link, .cite-link");
  if (link) showTooltipFor(link);
});
document.addEventListener("mouseout", (e) => {
  const link = e.target.closest && e.target.closest(".verify-link, .cite-link");
  if (link && _tooltipActiveCite === link) hideTooltip();
});
document.addEventListener("focusin", (e) => {
  if (e.target.classList && (e.target.classList.contains("verify-link") || e.target.classList.contains("cite-link"))) {
    showTooltipFor(e.target);
  }
});
document.addEventListener("focusout", (e) => {
  if (e.target.classList && (e.target.classList.contains("verify-link") || e.target.classList.contains("cite-link"))) hideTooltip();
});
document.addEventListener("click", (e) => {
  const link = e.target.closest && e.target.closest(".verify-link");
  if (!link) return;
  if (_tooltipActiveCite === link) { hideTooltip(); return; }
  if (window.matchMedia("(hover: none)").matches) {
    e.preventDefault();
    showTooltipFor(link);
  }
});

/* ──────────────────────────────────────────────────────────
   PUBLIC API for the report view (state machine)
   ────────────────────────────────────────────────────────── */

export function initReportView({ onEdit }) {
  const root = {
    view:          document.querySelector('[data-view="report"]'),
    from:          document.querySelector("[data-report-from]"),
    to:            document.querySelector("[data-report-to]"),
    loading:       document.querySelector("[data-report-loading]"),
    error:         document.querySelector("[data-report-error]"),
    errorTitle:    document.querySelector("[data-report-error-title]"),
    errorBody:     document.querySelector("[data-report-error-body]"),
    clarify:       document.querySelector("[data-report-clarify]"),
    clarifyQ:      document.querySelector("[data-clarify-question]"),
    clarifyForm:   document.querySelector("[data-clarify-form]"),
    body:          document.querySelector("[data-report-body]"),
    retryBtn:      document.querySelector("[data-action=retry]"),
    copyBtn:       document.querySelector("[data-action=copy]"),
    shareBtn:      document.querySelector("[data-action=share]"),
    editBtn:       document.querySelector("[data-action=edit]"),
    stepper:       document.querySelector("[data-stepper]"),
    progress:      document.querySelector("[data-action-bar-progress]"),
    progressFill:  document.querySelector("[data-action-bar-progress-fill]"),
    progressSteps: document.querySelectorAll("[data-progress-step]"),
    progressLabel: document.querySelector("[data-progress-label]"),
  };

  const PROGRESS_MESSAGES = [
    "Loading advisor knowledge base",
    "Running server-side web search (Tavily)",
    "Cross-checking travel advisories",
    "Drafting visa report",
    "Compiling your report",
  ];
  let progressTimer = null;
  let progressIdx   = 0;
  let progressStartedAt = 0;

  function setProgressMessage(text) {
    if (root.progressLabel) root.progressLabel.textContent = text;
  }

  function setProgress(name) {
    const PROGRESS_STEPS = ["prompt", "consult", "compile"];
    const idx = PROGRESS_STEPS.indexOf(name);
    if (root.progressSteps) {
      root.progressSteps.forEach((el) => {
        const elIdx = PROGRESS_STEPS.indexOf(el.dataset.progressStep);
        el.classList.toggle("is-active", elIdx === idx);
        el.classList.toggle("is-done",   elIdx >= 0 && elIdx < idx);
      });
    }
    if (root.stepper) {
      root.stepper.querySelectorAll(".step").forEach((li) => {
        const liIdx = PROGRESS_STEPS.indexOf(li.dataset.step);
        li.classList.toggle("is-active", liIdx === idx);
        li.classList.toggle("is-done",   liIdx >= 0 && liIdx < idx);
      });
    }
  }

  function showProgress(percent) {
    if (root.progress)     root.progress.hidden = false;
    if (root.progressFill) root.progressFill.style.width = `${percent}%`;
  }
  function startProgress() {
    if (root.progress)     root.progress.hidden = false;
    setProgress("prompt");
    showProgress(0);
    progressStartedAt = Date.now();
    progressIdx = 0;
    setProgressMessage(PROGRESS_MESSAGES[0]);
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = setInterval(() => {
      progressIdx = (progressIdx + 1) % PROGRESS_MESSAGES.length;
      setProgressMessage(PROGRESS_MESSAGES[progressIdx]);
      // Advance the bar smoothly up to 95%, leaving room for the final swap.
      const elapsed = Date.now() - progressStartedAt;
      const target = Math.min(95, (elapsed / 90_000) * 95);
      showProgress(target);
    }, 6000);
  }
  function hideProgress() {
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
    if (root.progress)     root.progress.hidden = true;
    if (root.progressFill) root.progressFill.style.width = "0%";
    if (root.progressSteps) {
      root.progressSteps.forEach((el) => {
        el.classList.remove("is-active", "is-done");
      });
    }
    if (root.progressLabel) setProgressMessage("");
  }

  // Wire action buttons
  root.editBtn.addEventListener("click", () => onEdit());
  root.retryBtn.addEventListener("click", () => {
    if (root._lastInput) runQuery(root._lastInput);
  });
  root.copyBtn.addEventListener("click", async () => {
    if (!root._lastMarkdown) {
      announce("No report to copy yet");
      flashBtn(root.copyBtn, "Nothing to copy");
      return;
    }
    const result = await copyReport(
      root._lastMarkdown,
      root._lastCaveats,
      root._lastAnnotations,
      root._lastCritical,
      root._lastResearch,
    );
    if (result.ok) {
      const label = result.mode === "rich"   ? "Rich-text report copied"
                  : result.mode === "plain"  ? "Plain-text report copied"
                  : /* fallback */              "Report copied";
      announce(label);
      flashBtn(root.copyBtn, result.mode === "rich" ? "Copied!" : "Copied");
    } else {
      console.error("[visa-advisor] copy failed:", result.error);
      announce("Copy failed — selecting text instead");
      flashBtn(root.copyBtn, "Copy failed");
      selectReportBody();
    }
  });
  root.shareBtn.addEventListener("click", () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      announce("Share link copied to clipboard");
      flashBtn(root.shareBtn, "Link copied!");
    });
  });
  root.clarifyForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const answer = root.clarifyForm.querySelector("#input-clarify").value.trim();
    if (!answer) return;
    if (root._lastInput) {
      const next = { ...root._lastInput, clarify: answer };
      runQuery(next);
    }
  });

  function show(viewName) {
    [root.loading, root.error, root.clarify, root.body].forEach(el => el.hidden = true);
    if (viewName === "loading")  root.loading.hidden = false;
    if (viewName === "error")    root.error.hidden   = false;
    if (viewName === "clarify")  root.clarify.hidden = false;
    if (viewName === "report")   root.body.hidden    = false;
  }

  function setRoute(fromCode, toCode, destinationCode) {
    const from = findByCode(fromCode);
    const to   = findByCode(toCode);
    root.from.textContent = from ? `${from.flag} ${from.code}` : (fromCode || "—");
    root.to.textContent   = to   ? `${to.flag} ${to.code}`     : (toCode || "—");
    if (destinationCode) {
      root.to.textContent += `  /  ${destinationCode}`;
    }
  }

  function showError(title, body) {
    root.errorTitle.textContent = title;
    root.errorBody.textContent  = body;
    show("error");
  }

  function showClarify(question) {
    root.clarifyQ.textContent = question;
    root.clarifyForm.reset();
    show("clarify");
  }

  async function runQuery(input) {
    root._lastInput = input;
    show("loading");
    startProgress();
    setTimeout(() => setProgress("consult"), 1200);
    try {
      const data = await queryAdvisor(input);
      stopProgress();   // helper defined below
      setProgress("compile");
      showProgress(100);

      if (data.type === "clarify") {
        hideProgress();
        showClarify(data.question);
        return;
      }
      root._lastMarkdown    = data.markdown;
      root._lastCaveats     = data.caveats;
      root._lastAnnotations = data.annotations || [];
      root._lastCritical    = data.critical     || [];
      root._lastResearch    = {
        searchQueries: Array.isArray(data.searchQueries) ? data.searchQueries : [],
        sources:       Array.isArray(data.sources)       ? data.sources       : [],
        sourcesReturned: Number.isFinite(data.sourcesReturned) ? data.sourcesReturned : 0,
        researchWarning: typeof data.researchWarning === "string" ? data.researchWarning : "",
      };
      // Persist to route-keyed cache so the Back-to-last-report pill
      // (and a hard refresh) can open this report without a fresh LLM call.
      writeReportCache(input, {
        markdown:    root._lastMarkdown,
        caveats:     root._lastCaveats,
        annotations: root._lastAnnotations,
        critical:    root._lastCritical,
        ...root._lastResearch,
      });
      renderReport(
        root.body,
        data.markdown,
        root._lastAnnotations,
        root._lastCritical,
        root._lastCaveats,
        root._lastResearch,
      );

      // Brief beat so the user sees "Compiling your report" land before swap.
      await new Promise(r => setTimeout(r, 220));
      show("report");
      hideProgress();
      announce("Visa report ready");
    } catch (err) {
      hideProgress();
      const isTimeout = err.code === "TIMEOUT" || err.name === "AbortError";
      const isPrompt  = err.code === "PROMPT_LOAD";
      const title = isPrompt  ? "Couldn't load advisor prompt"
                  : isTimeout ? "Request timed out — web research can take up to 90 seconds"
                              : "Couldn't reach the service";
      const body  = isPrompt  ? "The advisor's knowledge base failed to load. Refresh the page and try again."
                  : isTimeout ? "The advisor took too long to respond. Please try again."
                              : (err.message || "Check your connection and try again.");
      showError(title, body);
    }
  }

  function stopProgress() {
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
  }

  /* v0.9 — render a previously-cached report envelope without hitting
     the network. Mirrors runQuery's success path: hydrates the
     report's internal state (so Copy / Edit still work), calls
     renderReport, and shows the body. */
  function renderCached(input, envelope) {
    if (!envelope || typeof envelope.markdown !== "string") {
      throw new Error("renderCached: invalid envelope");
    }
    root._lastInput = input;
    root._lastMarkdown    = envelope.markdown;
    root._lastCaveats     = envelope.caveats || "";
    root._lastAnnotations = Array.isArray(envelope.annotations) ? envelope.annotations : [];
    root._lastCritical    = Array.isArray(envelope.critical)     ? envelope.critical     : [];
    root._lastResearch    = {
      searchQueries:    Array.isArray(envelope.searchQueries) ? envelope.searchQueries : [],
      sources:          Array.isArray(envelope.sources)       ? envelope.sources       : [],
      sourcesReturned:  Number.isFinite(envelope.sourcesReturned) ? envelope.sourcesReturned : 0,
      researchWarning:  typeof envelope.researchWarning === "string" ? envelope.researchWarning : "",
    };
    renderReport(
      root.body,
      root._lastMarkdown,
      root._lastAnnotations,
      root._lastCritical,
      root._lastCaveats,
      root._lastResearch,
    );
    show("report");
    announce(`Showing cached report (${reportCacheAgeText(envelope)})`);
  }

  return {
    show,
    setRoute,
    runQuery,
    renderCached,
    el: root.view,
  };
}

/* ──────────────────────────────────────────────────────────
   Tiny utilities
   ────────────────────────────────────────────────────────── */
function flashBtn(btn, text) {
  // Debounce so rapid double-clicks don't queue overlapping flashes.
  if (btn.dataset.flashing === "1") return;
  btn.dataset.flashing = "1";
  const orig = btn.innerHTML;
  btn.textContent = text;
  btn.disabled = true;
  setTimeout(() => {
    btn.innerHTML = orig;
    btn.disabled = false;
    delete btn.dataset.flashing;
  }, 1400);
}

/* Fallback when every clipboard API path fails: highlight the report
   body so the user can ⌘/Ctrl-C to copy it manually. */
function selectReportBody() {
  const body = document.querySelector("[data-report-body]");
  if (!body) return;
  const range = document.createRange();
  range.selectNodeContents(body);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function announce(text) {
  const el = document.querySelector("[data-announcer]");
  if (!el) return;
  el.textContent = "";
  setTimeout(() => { el.textContent = text; }, 30);
}

/* ──────────────────────────────────────────────────────────
   Rich-text Copy — HTML + plain-text via ClipboardItem.
   For v0.4 the report has typed critical markers and per-bullet
   verify links; we serialise both into the clipboard HTML and the
   plain-text fallback.
   ────────────────────────────────────────────────────────── */

const CLIP = {
  font:     "font-family:'Inter','Helvetica Neue',Arial,sans-serif",
  fontHead: "font-family:'Inter Tight','Inter','Helvetica Neue',Arial,sans-serif",
  c_text:   "#141414",
  c_sub:    "#6A6B6E",
  c_border: "#E4E5E6",
  c_card:   "#FFFFFF",
  c_soft:   "#F4F3D8",
  c_neutral:"#DCDBC7",
  c_green:  "#C1F11D",
  c_greenDk:"#9DD90D",
  c_warnBg: "#FFF1C0",
  c_warnBd: "#FFC13C",
  c_warnTxt:"#8C5C00",
  c_discBg: "#F5F5F6",
  c_accent: "#4087E1",
  c_white:  "#FFFFFF",
  c_black:  "#141414",
  c_money:  "#FFDFDE",
  c_moneyT: "#8C2A24",
  c_dead:   "#FFF1C0",
  c_deadT:  "#8C5C00",
  c_doc:    "#E2F4FF",
  c_docT:   "#274D85",
};

/* Rich-text copy icons — Material Symbols glyphs (color-tracked by type).
   Each value is the full <span> markup so the pasted email/notes show a
   clean glyph instead of an emoji that renders inconsistently across
   clients (Outlook, Apple Mail, Slack, Notion, etc.). */
const CLIP_ICON = {
  money:    `<span class="material-symbols-outlined" style="font-family:'Material Symbols Outlined';font-size:18px;color:#8C2A24;vertical-align:-3px;line-height:1;">attach_money</span>`,
  deadline: `<span class="material-symbols-outlined" style="font-family:'Material Symbols Outlined';font-size:18px;color:#8C5C00;vertical-align:-3px;line-height:1;">schedule</span>`,
  entry:    `<span class="material-symbols-outlined" style="font-family:'Material Symbols Outlined';font-size:18px;color:#8C2A24;vertical-align:-3px;line-height:1;">block</span>`,
  doc:      `<span class="material-symbols-outlined" style="font-family:'Material Symbols Outlined';font-size:18px;color:#274D85;vertical-align:-3px;line-height:1;">description</span>`,
  stale:    `<span class="material-symbols-outlined" style="font-family:'Material Symbols Outlined';font-size:18px;color:#55575A;vertical-align:-3px;line-height:1;">history_toggle_off</span>`,
};

/* Reusable Material Symbols span helper for rich-text copies (caveats / disclaimer / etc.) */
function ms(glyph, color) {
  const c = color ? `color:${escapeHtmlSafe(color)};` : "";
  return `<span class="material-symbols-outlined" style="font-family:'Material Symbols Outlined';font-size:18px;${c}vertical-align:-3px;line-height:1;">${glyph}</span>`;
}

function escapeHtmlAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escapeHtmlSafe(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildReportHtml(md, caveats, annotations, critical, research) {
  const s       = parseSections(md);
  const titles  = s.__titles || {};
  const meta    = extractMeta(md);
  const ann     = Array.isArray(annotations) ? annotations : [];
  const crit    = Array.isArray(critical)    ? critical   : [];
  const searchQs = Array.isArray(research?.searchQueries) ? research.searchQueries : [];
  const sources  = Array.isArray(research?.sources)       ? research.sources       : [];

  // Status hero (compact for email).
  const normSt  = (s.visaStatus || "").trim().toLowerCase();
  const stKey   = Object.keys(STATUS_CLASS).find(k => normSt.includes(k)) || "embassy";
  const tone    = STATUS_TONE[stKey];
  const chipBg  = ({ visa_free: CLIP.c_green, eta: "#E4FF88", evisa: "#E2F4FF", voa: "#E4FFAF", embassy: "#FFF1C0", restricted: "#FFDFDE" })[tone] || "#FFF1C0";
  const chipFg  = ({ visa_free: CLIP.c_black, eta: CLIP.c_black, evisa: "#2C5F7C", voa: "#3F6207", embassy: CLIP.c_warnTxt, restricted: "#8C2A24" })[tone] || CLIP.c_black;
  const stay    = s.allowedStay && s.allowedStay.trim() !== "N/A" ? s.allowedStay.trim() : "";
  const statusHtml =
    `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;` +
    `padding:20px 24px;background:${CLIP.c_soft};border:1px solid ${CLIP.c_neutral};border-radius:20px;">` +
    `<span style="display:inline-flex;align-items:center;gap:10px;height:48px;padding:0 20px;border-radius:9999px;` +
    `background:${escapeHtmlSafe(chipBg)};color:${escapeHtmlSafe(chipFg)};` +
    `${CLIP.fontHead};font-weight:700;font-size:18px;letter-spacing:-0.02em;">${escapeHtmlSafe((s.visaStatus || "").trim())}</span>` +
    (stay ? (
      `<span style="text-align:right;">` +
      `<span style="display:block;font-size:11px;color:${CLIP.c_sub};text-transform:uppercase;letter-spacing:0.05em;">Allowed stay</span>` +
      `<span style="display:block;font-size:16px;font-weight:600;color:${CLIP.c_text};margin-top:2px;">${escapeHtmlSafe(stay)}</span></span>`
    ) : "") +
    `</div>`;

  const sections = [];

  // (Zero-annotation "Web research did not return grounded sources" banner
  //  was removed in v0.9 — the Disclaimer already says verify with the
  //  embassy. No need to duplicate the warning on every report.)

  // Before you book checklist.
  if (crit.length) {
    const rows = crit.map((c, i) => {
      const type = c.type && CLIP_ICON[c.type] ? c.type : "";
      const glyph = type ? CLIP_ICON[type] : ms("flag", "#6B4900");
      const bg = type === "money" ? CLIP.c_money
              : type === "deadline" ? CLIP.c_dead
              : type === "doc" ? CLIP.c_doc
              : "#F3F4F6";
      const fg = type === "money" ? CLIP.c_moneyT
              : type === "deadline" ? CLIP.c_deadT
              : type === "doc" ? CLIP.c_docT
              : "#6B7280";
      const lookupUrl = c.source && /^https?:\/\//.test(c.source) ? c.source : "";
      const link = lookupUrl
        ? ` <a href="${escapeHtmlAttr(lookupUrl)}" style="color:${CLIP.c_accent};text-decoration:underline;font-size:13px;">↗ Verify</a>`
        : "";
      return (
        `<li style="display:flex;align-items:flex-start;gap:12px;padding:10px 0;` +
        `border-top:1px solid ${CLIP.c_border};background:${bg};padding:10px 14px;border-radius:8px;margin-top:6px;">` +
        `<span style="display:inline-flex;align-items:center;justify-content:center;` +
        `width:28px;height:28px;border-radius:9999px;background:${CLIP.c_white};` +
        `color:${fg};font-weight:700;flex-shrink:0;">${i + 1}</span>` +
        `<span style="font-size:16px;line-height:1;color:${fg};flex-shrink:0;margin-top:4px;">${glyph}</span>` +
        `<div style="flex:1;">` +
        `<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;` +
        `color:${CLIP.c_sub};font-weight:600;">${escapeHtmlSafe(c.label || "")}</div>` +
        `<div style="font-size:15px;font-weight:600;color:${CLIP.c_text};margin-top:2px;">${escapeHtmlSafe(c.value || "")}</div>` +
        `</div>${link}</li>`
      );
    }).join("");
    sections.push(
      `<div style="margin-top:16px;padding:20px 24px;background:${CLIP.c_warnBg};` +
      `border:1px solid ${CLIP.c_warnBd};border-radius:16px;color:${CLIP.c_warnTxt};">` +
      `<div style="font-weight:700;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;` +
      `margin-bottom:10px;display:flex;align-items:center;gap:8px;">` +
      `${ms("priority_high", "#6B4900")}<span>BEFORE YOU BOOK</span></div>` +
      `<ol style="list-style:none;padding:0;margin:0;">${rows}</ol>` +
      `</div>`
    );
  }

  // Required documents (with verify links).
  if (s.requiredDocs) {
    const bodyOffset = findSectionOffset(md, titles.requiredDocs || "Required documents (typical)");
    const localAnns = annotationsForBody(ann, bodyOffset);
    const bullets = buildBulletCharMap(s.requiredDocs);
    const mapWithAnn = attachUrlOnlyAnnotations(bullets, localAnns);
    const items = s.requiredDocs.split("\n")
      .map(l => l.replace(/^[-•*]\s+/, "").trim())
      .filter(Boolean)
      .map((t, i) => {
        const anns = dedupeByUrl((mapWithAnn[i]?.annotations || []).map(a => ({
          ...a,
          start: a._localStart ?? a.start,
          end:   a._localEnd   ?? a.end,
        })));
        const links = anns.map(a =>
          ` <a href="${escapeHtmlAttr(a.url)}" style="color:${CLIP.c_accent};text-decoration:underline;font-size:13px;">↗ ${escapeHtmlSafe(a.title || "Verify")}</a>`
        ).join("");
        return `<li style="display:flex;align-items:flex-start;gap:8px;margin-top:8px;font-size:15px;line-height:1.45;">
          <span style="flex-shrink:0;display:inline-block;width:6px;height:6px;border-radius:9999px;background:${CLIP.c_green};margin-top:8px;"></span>
          <span>${escapeHtmlSafe(t)}${links}</span>
        </li>`;
      }).join("");
    sections.push(
      `<div style="margin-top:16px;padding:20px 24px;background:${CLIP.c_card};` +
      `border:1px solid ${CLIP.c_border};border-radius:16px;">` +
      `<h3 style="margin:0 0 12px;font-size:13px;font-weight:600;color:${CLIP.c_sub};` +
      `text-transform:uppercase;letter-spacing:0.04em;">${escapeHtmlSafe(titles.requiredDocs ? stripCriticalPrefix(titles.requiredDocs) : "Required documents (typical)")}</h3>` +
      `<ul style="list-style:none;padding:0;margin:0;">${items}</ul>` +
      `</div>`
    );
  }

  // Passport / Fee / Processing (3-col table for email safety)
  const grid = [];
  if (s.passportValidity) grid.push({ title: "Passport validity", body: s.passportValidity });
  if (s.fee)              grid.push({ title: "Fee",                body: s.fee });
  if (s.processingTime)   grid.push({ title: "Processing time",   body: s.processingTime });
  if (grid.length) {
    const cells = grid.map((g, i) => {
      const pad = i === 0 ? "" : "padding-left:8px;";
      return (
        `<td style="width:33.33%;vertical-align:top;${pad}">` +
        `<div style="padding:20px 24px;background:${CLIP.c_card};border:1px solid ${CLIP.c_border};border-radius:16px;">` +
        `<h3 style="margin:0 0 8px;font-size:13px;font-weight:600;color:${CLIP.c_sub};text-transform:uppercase;letter-spacing:0.04em;">${escapeHtmlSafe(g.title)}</h3>` +
        `<div style="font-size:15px;line-height:1.45;color:${CLIP.c_text};">${escapeHtmlSafe(g.body.trim())}</div>` +
        `</div></td>`
      );
    }).join("");
    sections.push(
      `<table role="presentation" style="width:100%;border-collapse:collapse;margin-top:16px;border:0;">` +
      `<tr><td style="padding:0;">` +
      `<table role="presentation" style="width:100%;border-collapse:collapse;"><tr>${cells}</tr></table>` +
      `</td></tr></table>`
    );
  }

  // Official CTA
  if (s.officialUrl && /^https?:\/\//.test(s.officialUrl.trim())) {
    sections.push(
      `<div style="margin-top:16px;padding:20px 24px;background:${CLIP.c_card};` +
      `border:1px solid ${CLIP.c_border};border-radius:16px;">` +
      `<h3 style="margin:0 0 12px;font-size:13px;font-weight:600;color:${CLIP.c_sub};` +
      `text-transform:uppercase;letter-spacing:0.04em;">Official application</h3>` +
      `<a href="${escapeHtmlAttr(s.officialUrl.trim())}" style="display:flex;align-items:center;justify-content:center;` +
      `gap:8px;min-height:48px;padding:0 24px;background:${CLIP.c_green};color:${CLIP.c_black};` +
      `border:2px solid ${CLIP.c_green};border-radius:12px;font-weight:600;font-size:15px;text-decoration:none;">` +
      `Open official site ↗</a></div>`
    );
  }

  // Caveats
  if (caveats && caveats.trim()) {
    sections.push(
      `<div style="margin-top:16px;padding:16px 20px;background:${CLIP.c_warnBg};` +
      `border:1px solid ${CLIP.c_warnBd};border-radius:16px;color:${CLIP.c_warnTxt};">` +
      `<div style="font-weight:700;font-size:15px;margin-bottom:8px;display:flex;align-items:center;gap:8px;">` +
      `${ms("warning_amber", CLIP.c_warnTxt)}<span>Caveats</span></div>` +
      `<div style="font-size:14px;line-height:1.5;white-space:pre-wrap;">${escapeHtmlSafe(caveats.trim())}</div>` +
      `</div>`
    );
  }

  // Research log — search queries the LLM ran (v0.5)
  if (searchQs.length) {
    const items = searchQs.map(q =>
      `<li style="margin-top:4px;font-size:13px;color:${CLIP.c_sub};line-height:1.5;">${escapeHtmlSafe(q)}</li>`
    ).join("");
    sections.push(
      `<div style="margin-top:16px;padding:20px 24px;background:${CLIP.c_card};` +
      `border:1px solid ${CLIP.c_border};border-radius:16px;">` +
      `<h3 style="margin:0 0 12px;font-size:13px;font-weight:600;color:${CLIP.c_sub};` +
      `text-transform:uppercase;letter-spacing:0.04em;">Research log · ${searchQs.length} ${searchQs.length === 1 ? "search" : "searches"}</h3>` +
      `<ol style="list-style:decimal inside;padding:0;margin:0;">${items}</ol>` +
      `</div>`
    );
  }

  // Sources (N) — deduped URLs grouped by domain (v0.5). Coexists with the
  // per-bullet verify links above; this is the canonical "all sources" list.
  if (sources.length) {
    const grouped = {};
    for (const src of sources) {
      const d = (src.domain || "unknown").toLowerCase();
      if (!grouped[d]) grouped[d] = [];
      grouped[d].push(src);
    }
    const groupKeys = Object.keys(grouped).sort();
    const groupsHtml = groupKeys.map(domain => {
      const items = grouped[domain].map(s => {
        const safeUrl = escapeHtmlAttr(s.url);
        const safeTitle = escapeHtmlSafe(s.title || s.url);
        return (
          `<div style="margin-top:6px;font-size:14px;line-height:1.45;">` +
          `<a href="${safeUrl}" style="color:${CLIP.c_accent};text-decoration:underline;">${safeTitle}</a>` +
          `<div style="color:${CLIP.c_sub};font-size:12px;margin-top:1px;">${safeUrl}</div>` +
          `</div>`
        );
      }).join("");
      return (
        `<div style="margin-top:12px;">` +
        `<div style="font-weight:600;font-size:12px;color:${CLIP.c_sub};` +
        `text-transform:uppercase;letter-spacing:0.04em;">${escapeHtmlSafe(domain)}</div>` +
        `${items}` +
        `</div>`
      );
    }).join("");
    sections.push(
      `<div style="margin-top:16px;padding:20px 24px;background:${CLIP.c_card};` +
      `border:1px solid ${CLIP.c_border};border-radius:16px;">` +
      `<h3 style="margin:0 0 12px;font-size:13px;font-weight:600;color:${CLIP.c_sub};` +
      `text-transform:uppercase;letter-spacing:0.04em;">Sources · ${sources.length} ${sources.length === 1 ? "source" : "sources"}</h3>` +
      `<div>${groupsHtml}</div>` +
      `</div>`
    );
  }

  // Meta + Disclaimer (v0.5 — research stats appended to the existing line)
  const date = meta.lastVerified || new Date().toISOString().slice(0, 10);
  const statParts = [];
  if (searchQs.length)   statParts.push(`${searchQs.length} ${searchQs.length === 1 ? "search" : "searches"}`);
  if (sources.length)    statParts.push(`${sources.length} ${sources.length === 1 ? "source" : "sources"}`);
  if (ann.length)        statParts.push(`${ann.length} inline ${ann.length === 1 ? "citation" : "citations"}`);
  const statsSuffix = statParts.length
    ? ` &nbsp;·&nbsp; Research: ${statParts.join(" · ")}`
    : "";
  const metaHtml = `<p style="margin-top:16px;font-size:12px;color:${CLIP.c_sub};text-align:center;">Last verified: ${escapeHtmlSafe(date)}${statsSuffix}</p>`;
  const discHtml =
    `<div style="margin-top:12px;padding:12px 16px;background:${CLIP.c_discBg};border-radius:12px;` +
    `font-size:12px;line-height:1.5;color:${CLIP.c_sub};display:flex;align-items:flex-start;gap:6px;">` +
    `${ms("info", CLIP.c_sub)}<span>This is general information based on publicly available sources as of ${escapeHtmlSafe(date)}. ` +
    `Visa requirements change frequently and are determined solely by the destination country's authorities. ` +
    `Always verify with the destination embassy or consulate before booking travel. ` +
    `<strong>Not legal advice. Not a substitute for an immigration attorney.</strong></span>` +
    `</div>`;

  return (
    `<div style="max-width:680px;margin:0 auto;${CLIP.font};color:${CLIP.c_text};line-height:1.5;">` +
    statusHtml + sections.join("") + metaHtml + discHtml +
    `</div>`
  );
}

function buildReportText(md, caveats, annotations, critical, research) {
  const s      = parseSections(md);
  const titles = s.__titles || {};
  const meta = extractMeta(md);
  const ann  = Array.isArray(annotations) ? annotations : [];
  const crit = Array.isArray(critical)    ? critical   : [];
  const searchQs = Array.isArray(research?.searchQueries) ? research.searchQueries : [];
  const sources  = Array.isArray(research?.sources)       ? research.sources       : [];
  const date = meta.lastVerified || new Date().toISOString().slice(0, 10);
  const out  = [];

  // (No zero-annotation banner in the plain-text copy either — the
  //  Disclaimer section below already includes the "always verify"
  //  reminder.)
  if (crit.length) {
    const rows = crit.map((c, i) =>
      `${i + 1}. [${(c.type || "step").toUpperCase()}] ${c.label}: ${c.value}${c.source ? ` — ${c.source}` : ""}`
    );
    out.push("BEFORE YOU BOOK\n" + rows.join("\n"));
  }

  const push = (label, value) => {
    const v = (value || "").trim();
    if (v) out.push(label + "\n" + v);
  };
  push("Visa status",        s.visaStatus);
  push("Allowed stay",       s.allowedStay);
  push("Passport validity",  s.passportValidity);
  push("Fee",                s.fee);
  push("Processing time",    s.processingTime);

  if (s.requiredDocs) {
    const bodyOffset = findSectionOffset(md, titles.requiredDocs || "Required documents (typical)");
    const localAnns = annotationsForBody(ann, bodyOffset);
    const bullets = buildBulletCharMap(s.requiredDocs);
    const mapWithAnn = attachUrlOnlyAnnotations(bullets, localAnns);
    const items = s.requiredDocs.split("\n")
      .map(l => l.replace(/^[-•*]\s+/, "").trim())
      .filter(Boolean)
      .map((t, i) => {
        const anns = dedupeByUrl((mapWithAnn[i]?.annotations || []).map(a => ({
          ...a,
          start: a._localStart ?? a.start,
          end:   a._localEnd   ?? a.end,
        })));
        const links = anns.map(a => `  ↗ ${a.title || a.url} (${a.url})`).join("\n");
        return `- ${t}${links ? "\n" + links : ""}`;
      });
    if (items.length) out.push("Required documents\n" + items.join("\n"));
  }
  push("Official application", s.officialUrl);
  push("Exception rules",       s.exceptions);
  push("Travel advisories",     s.advisories);

  if (searchQs.length) {
    const rows = searchQs.map((q, i) => `  ${i + 1}. ${q}`);
    out.push(`Research log (${searchQs.length} ${searchQs.length === 1 ? "search" : "searches"})\n` + rows.join("\n"));
  }
  if (sources.length) {
    const grouped = {};
    for (const src of sources) {
      const d = (src.domain || "unknown").toLowerCase();
      if (!grouped[d]) grouped[d] = [];
      grouped[d].push(src);
    }
    const groupKeys = Object.keys(grouped).sort();
    const sections = groupKeys.map(domain => {
      const rows = grouped[domain].map(s => `  - ${s.title || s.url}\n    ${s.url}`);
      return `${domain}\n${rows.join("\n")}`;
    });
    out.push(`Sources (${sources.length} ${sources.length === 1 ? "source" : "sources"})\n` + sections.join("\n"));
  } else if (ann.length) {
    // Back-compat fallback when worker didn't send sources[].
    const rows = ann.map(a => `- ${a.title || a.url}\n  ${a.url}${a.snippet ? `\n  "${a.snippet}"` : ""}`);
    out.push("Sources (from web research)\n" + rows.join("\n"));
  }
  if (caveats && caveats.trim()) out.push("Caveats\n" + caveats.trim());

  // Meta line with research stats appended (v0.5)
  const statParts = [];
  if (searchQs.length) statParts.push(`${searchQs.length} ${searchQs.length === 1 ? "search" : "searches"}`);
  if (sources.length)  statParts.push(`${sources.length} ${sources.length === 1 ? "source" : "sources"}`);
  if (ann.length)      statParts.push(`${ann.length} inline ${ann.length === 1 ? "citation" : "citations"}`);
  const statsSuffix = statParts.length ? `  ·  Research: ${statParts.join(" · ")}` : "";
  out.push(`Last verified: ${date}${statsSuffix}`);

  out.push("---");
  out.push(`This is general information based on publicly available sources as of ${date}. Not legal advice. Not a substitute for an immigration attorney.`);

  return out.join("\n\n");
}

/* Returns { ok, mode, error? } so callers can render the right flash.
   Tries (1) rich HTML, (2) plain text via the async clipboard API,
   (3) the legacy execCommand fallback for file:// origins and
   older Safari contexts where navigator.clipboard isn't writable. */
async function copyReport(md, caveats, annotations, critical, research) {
  const html = buildReportHtml(md, caveats, annotations, critical, research);
  const text = buildReportText(md, caveats, annotations, critical, research);

  // Path 1 — rich HTML via async Clipboard API.
  if (
    typeof ClipboardItem !== "undefined" &&
    navigator.clipboard?.write &&
    window.isSecureContext
  ) {
    try {
      const item = new ClipboardItem({
        "text/html":  new Blob([html],  { type: "text/html"  }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      return { ok: true, mode: "rich" };
    } catch (err) {
      console.warn("[visa-advisor] rich clipboard.write failed; falling back:", err);
    }
  }

  // Path 2 — plain text only via the async API.
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true, mode: "plain" };
    } catch (err) {
      console.warn("[visa-advisor] plain clipboard.writeText failed; falling back:", err);
    }
  }

  // Path 3 — execCommand fallback (file://, old Safari, denied permissions).
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.width = "1px";
    ta.style.height = "1px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand && document.execCommand("copy");
    document.body.removeChild(ta);
    if (!ok) throw new Error("execCommand returned false");
    return { ok: true, mode: "fallback" };
  } catch (err) {
    return { ok: false, mode: "none", error: err && err.message || String(err) };
  }
}
