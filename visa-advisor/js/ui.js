/* ============================================================
   UI — form, validation, modal, report rendering
   ============================================================ */

import { SANCTIONED, findByCode } from "./countries.js";
import { queryAdvisor } from "./api.js";

/* ──────────────────────────────────────────────────────────
   DISCLAIMER MODAL
   ────────────────────────────────────────────────────────── */

const DISCLAIMER_VERSION = "v1"; // bump to re-prompt after content change

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
   FORM — validation, submission, sanctioned-destination check
   ────────────────────────────────────────────────────────── */

export function initForm({ onSubmit }) {
  const form         = document.querySelector("[data-form]");
  const submitBtn    = form.querySelector("[data-submit]");
  const nationalityEl= form.querySelector("#input-nationality");
  const arrivalEl    = form.querySelector("#input-arrival");
  const destinationEl= form.querySelector("#input-destination");
  const commentsEl   = form.querySelector("#input-comments");
  const sanctionedUI = form.querySelector("[data-notice=sanctioned]");
  const pillEl       = document.querySelector("[data-view-pill]");
  const pillRouteEl  = document.querySelector("[data-pill-route]");

  // Hydrate the "Back to last report" pill from localStorage.
  // Hydrate form fields too if a previous nationality is saved.
  let cachedInput = null;
  try {
    const raw = localStorage.getItem("visa-advisor.last-input");
    if (raw) cachedInput = JSON.parse(raw);
  } catch { /* ignore parse errors */ }
  if (cachedInput && cachedInput.nationality) {
    nationalityEl.value = cachedInput.nationality;
  }
  if (cachedInput && pillEl && pillRouteEl) {
    const route = [cachedInput.nationality, cachedInput.destination || cachedInput.arrival]
      .filter(Boolean).join(" → ");
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

  // Field-level error helpers
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
    const arr = readField(arrivalEl);
    const dst = readField(destinationEl);
    let ok = true;

    if (!nat) { setError("nationality", "Enter your nationality"); ok = false; }
    if (!arr) { setError("arrival",     "Enter an arrival country"); ok = false; }
    if (!dst) { setError("destination", "Enter a destination city"); ok = false; }
    if (nat && arr && nat.toLowerCase() === arr.toLowerCase()) {
      setError("arrival", "Arrival can't match your nationality");
      ok = false;
    }

    // Sanctioned jurisdiction (per spec §3.2) — check arrival text against ISO codes
    const arrUpper = arr.toUpperCase();
    const sanctioned = SANCTIONED.has(arrUpper) ||
      (arr.length === 2 && SANCTIONED.has(arrUpper));
    sanctionedUI.hidden = !sanctioned;
    if (sanctioned) ok = false;

    submitBtn.disabled = !ok;
    return ok;
  }

  // Errors are surfaced only on submit attempt (and not while typing).
  // We still need to keep the submit button's enabled state in sync as the
  // user types — so a lightweight listener just recomputes `disabled`
  // without showing error messages. Full error UI runs only on submit.
  // We listen for both `input` (real typing) and `change` (programmatic
  // value sets that don't fire `input`, e.g. some assistive tech and the
  // browser's password-manager autofill).
  function refreshSubmitState() {
    const ok =
      !!readField(nationalityEl) &&
      !!readField(arrivalEl) &&
      !!readField(destinationEl);
    submitBtn.disabled = !ok;
  }
  [nationalityEl, arrivalEl, destinationEl].forEach((el) => {
    el.addEventListener("input",  refreshSubmitState);
    el.addEventListener("change", refreshSubmitState);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validate()) return;

    const input = {
      nationality: readField(nationalityEl),
      arrival:     readField(arrivalEl),
      destination: readField(destinationEl),
      date:        new Date().toISOString().slice(0, 10),
      purpose:     "business",
      comments:    readField(commentsEl),
    };

    // Remember the full last-input so the "Back to last report" pill
    // (and the implicit Edit→Resubmit path) survive a tab refresh.
    try {
      localStorage.setItem("visa-advisor.last-input", JSON.stringify(input));
    } catch { /* quota or privacy mode — ignore */ }

    onSubmit(input);
  });

  // initial pass — set the submit button state without surfacing errors.
  // Errors are only shown after the user attempts to submit.
  clearErrors();
  submitBtn.disabled = !readField(nationalityEl) || !readField(arrivalEl) || !readField(destinationEl);

  return {
    getFormData() {
      return {
        nationality: readField(nationalityEl),
        arrival:     readField(arrivalEl),
        destination: readField(destinationEl),
        date:        new Date().toISOString().slice(0, 10),
        purpose:     "business",
        comments:    readField(commentsEl),
      };
    },
    setFormData(data) {
      if (data.nationality) nationalityEl.value = data.nationality;
      if (data.arrival)     arrivalEl.value     = data.arrival;
      if (data.destination) destinationEl.value = data.destination;
      if (data.comments)    commentsEl.value   = data.comments;
      refreshSubmitState();
    },
  };
}

/* ──────────────────────────────────────────────────────────
   REPORT — markdown-to-structured-sections renderer
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

/* Material Symbols (webfont) — single source of truth for the rich icon set. */
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

/**
 * Parse the LLM markdown report (per visa-advisor-prompt.md §2)
 * into structured sections, then render into the report-body
 * container.
 */
export function renderReport(body, markdown) {
  body.innerHTML = "";

  const sections = parseSections(markdown);
  const meta = extractMeta(markdown);

  // Status hero
  if (sections.visaStatus) {
    body.appendChild(renderStatus(sections.visaStatus, sections.allowedStay));
  }

  // Required documents
  if (sections.requiredDocs) {
    body.appendChild(renderDocsSection(sections.requiredDocs));
  }

  // Passport validity, Fee, Processing time — small grid
  const grid = document.createElement("div");
  grid.className = "report-grid";
  if (sections.passportValidity) grid.appendChild(renderMetaSection("Passport validity", "passport", sections.passportValidity));
  if (sections.fee)              grid.appendChild(renderMetaSection("Fee", "fee", sections.fee));
  if (sections.processingTime)   grid.appendChild(renderMetaSection("Processing time", "time", sections.processingTime));
  if (grid.children.length) body.appendChild(grid);

  // Official URL CTA
  if (sections.officialUrl && /^https?:\/\//.test(sections.officialUrl.trim())) {
    body.appendChild(renderCta(sections.officialUrl));
  } else if (sections.officialUrl) {
    body.appendChild(renderMetaSection("Official application", "shield", sections.officialUrl));
  }

  // Exception rules, Travel advisories (collapsible)
  if (sections.exceptions && sections.exceptions !== "None identified") {
    body.appendChild(renderCollapsible("Exception rules", "rule", sections.exceptions));
  }
  if (sections.advisories && sections.advisories !== "None relevant") {
    body.appendChild(renderCollapsible("Travel advisories", "campaign", sections.advisories));
  }

  // Sources
  if (sections.sources) {
    body.appendChild(renderSources(sections.sources));
  }

  // Last verified
  if (meta.lastVerified) {
    const meta_el = document.createElement("p");
    meta_el.className = "report-meta";
    meta_el.textContent = `Last verified: ${meta.lastVerified}`;
    body.appendChild(meta_el);
  }

  // Disclaimer (always last, exact text per prompt §8f)
  body.appendChild(renderDisclaimer(meta.lastVerified));
}

/* ---- Section parser ---- */
function parseSections(md) {
  const out = {};
  const blocks = md.split(/^###\s+/m).slice(1);
  blocks.forEach((block) => {
    const newline = block.indexOf("\n");
    const title = block.slice(0, newline).trim();
    const body  = block.slice(newline + 1).trim();
    out[slugify(title)] = body;
  });
  return out;
}

const SECTION_KEYS = {
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

function slugify(t) {
  const firstWord = t.toLowerCase().replace(/[^a-z]+/g, " ").trim().split(" ")[0];
  return SECTION_KEYS[firstWord] || firstWord;
}

function extractMeta(md) {
  const last = md.match(/### Last verified\s*\n+([\d-]+)/i);
  return { lastVerified: last ? last[1] : new Date().toISOString().slice(0, 10) };
}

/* ---- Renderers ---- */
function renderStatus(status, stay) {
  const wrap = document.createElement("section");
  wrap.className = "report-status";
  wrap.setAttribute("aria-labelledby", "report-status-title");

  const normalized = status.trim().toLowerCase();
  const key = Object.keys(STATUS_CLASS).find(k => normalized.includes(k)) || "embassy";
  const cls = STATUS_CLASS[key];
  const tone = STATUS_TONE[key];
  const glyph = STATUS_ICON[key];

  wrap.innerHTML = `
    <span class="status-badge ${cls}" id="report-status-title" role="status">
      <span class="icon-chip icon-chip--${tone}" aria-hidden="true"><span class="material-symbols-outlined">${glyph}</span></span>
      <span>${escapeHtml(status.trim())}</span>
    </span>
    ${stay && stay !== "N/A" ? `
      <div class="status-stay">
        <div class="status-stay-label">Allowed stay</div>
        <div class="status-stay-value">${escapeHtml(stay.trim())}</div>
      </div>
    ` : ""}
  `;
  return wrap;
}

function renderDocsSection(md) {
  const items = md.split("\n")
    .map(l => l.replace(/^[-•*]\s+/, "").trim())
    .filter(Boolean);
  const sec = document.createElement("section");
  sec.className = "report-section";
  sec.innerHTML = `
    <h2 class="report-section-title">
      ${icon("docs")}
      Required documents
    </h2>
    <ul class="report-section-value report-section-value--list">
      ${items.map(t => `<li>${escapeHtml(t)}</li>`).join("")}
    </ul>
  `;
  return sec;
}

function renderMetaSection(title, name, value) {
  const sec = document.createElement("section");
  sec.className = "report-section";
  sec.innerHTML = `
    <h2 class="report-section-title">
      ${icon(name)}
      ${escapeHtml(title)}
    </h2>
    <div class="report-section-value">${escapeHtml(value.trim())}</div>
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

function renderCollapsible(title, name, value) {
  const sec = document.createElement("details");
  sec.className = "report-section report-section--collapsible";
  sec.innerHTML = `
    <summary class="report-section-summary">
      <h2 class="report-section-title" style="margin-bottom:0">
        ${icon(name)}
        ${escapeHtml(title)}
      </h2>
    </summary>
    <div class="report-section-value">${escapeHtml(value.trim())}</div>
  `;
  return sec;
}

function renderSources(md) {
  const sec = document.createElement("section");
  sec.className = "report-section";
  const links = [];
  md.split("\n").forEach((line) => {
    const m = line.match(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/);
    if (m) links.push({ label: m[1], url: m[2] });
  });
  sec.innerHTML = `
    <h2 class="report-section-title">
      ${icon("external")}
      Sources
    </h2>
    <div class="report-section-value report-section-value--sources">
      ${links.map(l => `<a href="${escapeAttr(l.url)}" target="_blank" rel="noopener noreferrer">${iconRaw("external")}${escapeHtml(l.label)}</a>`).join("")}
    </div>
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
   PUBLIC API for the report view (state machine)
   ────────────────────────────────────────────────────────── */

export function initReportView({ onEdit }) {
  const root = {
    view:        document.querySelector('[data-view="report"]'),
    from:        document.querySelector("[data-report-from]"),
    to:          document.querySelector("[data-report-to]"),
    loading:     document.querySelector("[data-report-loading]"),
    error:       document.querySelector("[data-report-error]"),
    errorTitle:  document.querySelector("[data-report-error-title]"),
    errorBody:   document.querySelector("[data-report-error-body]"),
    clarify:     document.querySelector("[data-report-clarify]"),
    clarifyQ:    document.querySelector("[data-clarify-question]"),
    clarifyForm: document.querySelector("[data-clarify-form]"),
    body:        document.querySelector("[data-report-body]"),
    retryBtn:    document.querySelector("[data-action=retry]"),
    copyBtn:     document.querySelector("[data-action=copy]"),
    shareBtn:    document.querySelector("[data-action=share]"),
    editBtn:     document.querySelector("[data-action=edit]"),
    stepper:     document.querySelector("[data-stepper]"),
    progress:    document.querySelector("[data-action-bar-progress]"),
    progressFill:document.querySelector("[data-action-bar-progress-fill]"),
    progressSteps: document.querySelectorAll("[data-progress-step]"),
  };

  /* Inline progress strip lives in the sticky action bar. The in-DOM
     stepper stays as an aria-live region for screen readers but is
     visually hidden. */
  const PROGRESS_STEPS = ["prompt", "consult", "compile"];
  function setProgress(name) {
    const idx = PROGRESS_STEPS.indexOf(name);
    if (root.progressSteps) {
      root.progressSteps.forEach((el) => {
        const elIdx = PROGRESS_STEPS.indexOf(el.dataset.progressStep);
        el.classList.toggle("is-active", elIdx === idx);
        el.classList.toggle("is-done",   elIdx >= 0 && elIdx < idx);
      });
    }
    if (root.stepper) {
      const idx2 = PROGRESS_STEPS.indexOf(name);
      root.stepper.querySelectorAll(".step").forEach((li) => {
        const liIdx = PROGRESS_STEPS.indexOf(li.dataset.step);
        li.classList.toggle("is-active", liIdx === idx2);
        li.classList.toggle("is-done",   liIdx >= 0 && liIdx < idx2);
      });
    }
  }

  function showProgress(percent) {
    if (root.progress)     root.progress.hidden = false;
    if (root.progressFill) root.progressFill.style.width = `${percent}%`;
  }
  function hideProgress() {
    if (root.progress)     root.progress.hidden = true;
    if (root.progressFill) root.progressFill.style.width = "0%";
    if (root.progressSteps) {
      root.progressSteps.forEach((el) => {
        el.classList.remove("is-active", "is-done");
      });
    }
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
    try {
      const mode = await copyReport(root._lastMarkdown, root._lastCaveats);
      announce(mode === "rich" ? "Rich-text report copied" : "Plain-text report copied");
      flashBtn(root.copyBtn, mode === "rich" ? "Copied!" : "Copied as text");
    } catch (err) {
      announce("Copy failed");
      flashBtn(root.copyBtn, "Copy failed");
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
      root.to.textContent += `  →  ${destinationCode}`;
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
    setProgress("prompt");
    showProgress(0);
    // Brief beat so the user sees the first step land before swap.
    const advanceTick = setTimeout(() => {
      setProgress("consult");
      showProgress(50);
    }, 120);
    try {
      const data = await queryAdvisor(input);
      clearTimeout(advanceTick);
      setProgress("compile");
      showProgress(100);

      if (data.type === "clarify") {
        hideProgress();
        showClarify(data.question);
        return;
      }
      // Cache for Copy
      root._lastMarkdown = data.markdown;
      root._lastCaveats  = data.caveats;
      // Render markdown
      renderReport(root.body, data.markdown);
      // Append caveats (if provided) above the disclaimer
      if (data.caveats) {
        const dis = root.body.querySelector(".report-disclaimer");
        if (dis) root.body.insertBefore(renderCaveats(data.caveats), dis);
      }
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
                  : isTimeout ? "Request timed out"
                              : "Couldn't reach the service";
      const body  = isPrompt  ? "The advisor's knowledge base failed to load. Refresh the page and try again."
                  : isTimeout ? "The advisor took too long to respond. Please try again."
                              : (err.message || "Check your connection and try again.");
      showError(title, body);
    }
  }

  return {
    show,
    setRoute,
    runQuery,
    el: root.view,
  };
}

/* ──────────────────────────────────────────────────────────
   Tiny utilities
   ────────────────────────────────────────────────────────── */
function flashBtn(btn, text) {
  const orig = btn.innerHTML;
  btn.textContent = text;
  btn.disabled = true;
  setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 1400);
}

function announce(text) {
  const el = document.querySelector("[data-announcer]");
  if (!el) return;
  el.textContent = "";
  setTimeout(() => { el.textContent = text; }, 30);
}

/* ──────────────────────────────────────────────────────────
   Rich-text Copy — HTML + plain-text via ClipboardItem
   Pastes as styled report into Teams / Outlook / Gmail / Slack (rich),
   or as readable sections into Notion / text editors / terminals (plain).
   ────────────────────────────────────────────────────────── */

const CLIP = {
  font: "font-family:'Inter','Helvetica Neue',Arial,sans-serif",
  fontHead: "font-family:'Inter Tight','Inter','Helvetica Neue',Arial,sans-serif",
  c_text:    "#141414",
  c_sub:     "#6A6B6E",
  c_border:  "#E4E5E6",
  c_card:    "#FFFFFF",
  c_soft:    "#F4F3D8",
  c_neutral: "#DCDBC7",
  c_green:   "#C1F11D",
  c_greenDk: "#9DD90D",
  c_lightGr: "#E4FF88",
  c_warnBg:  "#FFF1C0",
  c_warnBd:  "#FFC13C",
  c_warnTxt: "#8C5C00",
  c_discBg:  "#F5F5F6",
  c_accent:  "#4087E1",
  c_white:   "#FFFFFF",
  c_black:   "#141414",
};

const ICON_GLYPH = {
  docs:     "📄", passport: "🪪", fee:      "💳",
  time:     "🕐", shield:   "🛡", rule:     "📋",
  campaign: "📢", warn:     "⚠️", info:     "ℹ️",
  external: "↗", visaFree:  "✓",
};

function escapeHtmlAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escapeHtmlSafe(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function clipWrap(inner) {
  return (
    `<div style="max-width:680px;margin:0 auto;${CLIP.font};color:${CLIP.c_text};line-height:1.5;">` +
    inner +
    `</div>`
  );
}
function clipChip(glyph, tone) {
  const bg = {
    "visa-free": CLIP.c_green,
    "eta":       CLIP.c_lightGr,
    "evisa":     "#E2F4FF", "evisaText": "#2C5F7C",
    "voa":       "#E4FFAF", "voaText":   "#3F6207",
    "embassy":   "#FFF1C0", "embassyText": CLIP.c_warnTxt,
    "restricted":"#FFDFDE", "restrictedText": "#8C2A24",
    "warn":      CLIP.c_warnBg, "warnText": CLIP.c_warnTxt,
    "neutral":   CLIP.c_soft,
    "accent":    "transparent",
  }[tone] || CLIP.c_soft;
  const txt = ({
    "evisa":     "#2C5F7C",
    "voa":       "#3F6207",
    "embassy":   CLIP.c_warnTxt,
    "restricted":"#8C2A24",
    "warn":      CLIP.c_warnTxt,
    "accent":    CLIP.c_accent,
  })[tone] || CLIP.c_text;
  return (
    `<span style="display:inline-flex;align-items:center;justify-content:center;` +
    `width:28px;height:28px;border-radius:8px;background:${escapeHtmlSafe(bg)};color:${escapeHtmlSafe(txt)};` +
    `font-size:18px;line-height:1;flex-shrink:0;margin-right:8px;vertical-align:-4px;">` +
    escapeHtmlSafe(glyph) +
    `</span>`
  );
}

function clipSection(title, name, bodyHtml) {
  return (
    `<div style="margin-top:16px;padding:20px 24px;background:${CLIP.c_card};` +
    `border:1px solid ${CLIP.c_border};border-radius:16px;">` +
    `<h3 style="margin:0 0 12px;font-size:13px;font-weight:600;color:${CLIP.c_sub};` +
    `text-transform:uppercase;letter-spacing:0.04em;${CLIP.font};">` +
    clipChip(ICON_GLYPH[name] || "•", "neutral") +
    escapeHtmlSafe(title) +
    `</h3>` +
    bodyHtml +
    `</div>`
  );
}

function buildReportHtml(md, caveats) {
  const s       = parseSections(md);
  const meta    = extractMeta(md);
  const normSt  = (s.visaStatus || "").trim().toLowerCase();
  const stKey   = Object.keys(STATUS_CLASS).find(k => normSt.includes(k)) || "embassy";
  const statusClass = STATUS_CLASS[stKey];
  const tone    = STATUS_TONE[stKey];
  const glyph   = STATUS_ICON[stKey];

  // Status hero
  const chipBg = ({
    "visa-free": CLIP.c_green,
    "eta":       CLIP.c_lightGr,
    "evisa":     "#E2F4FF",
    "voa":       "#E4FFAF",
    "embassy":   "#FFF1C0",
    "restricted":"#FFDFDE",
  })[tone] || "#FFF1C0";
  const chipFg = ({
    "visa-free": CLIP.c_black,
    "eta":       CLIP.c_black,
    "evisa":     "#2C5F7C",
    "voa":       "#3F6207",
    "embassy":   CLIP.c_warnTxt,
    "restricted":"#8C2A24",
  })[tone] || CLIP.c_black;
  const stay = s.allowedStay && s.allowedStay.trim() !== "N/A" ? s.allowedStay.trim() : "";
  const statusHtml =
    `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;` +
    `padding:20px 24px;background:${CLIP.c_soft};border:1px solid ${CLIP.c_neutral};border-radius:20px;">` +
    `<span style="display:inline-flex;align-items:center;gap:10px;height:48px;padding:0 20px;border-radius:9999px;` +
    `background:${escapeHtmlSafe(chipBg)};color:${escapeHtmlSafe(chipFg)};` +
    `${CLIP.fontHead};font-weight:700;font-size:18px;letter-spacing:-0.02em;">` +
    `<span style="display:inline-flex;align-items:center;justify-content:center;` +
    `width:24px;height:24px;border-radius:6px;background:${escapeHtmlSafe(chipBg)};` +
    `color:${escapeHtmlSafe(chipFg)};font-size:14px;">${escapeHtmlSafe(ICON_GLYPH.visaFree)}</span>` +
    escapeHtmlSafe((s.visaStatus || "").trim()) +
    `</span>` +
    (stay ? (
      `<span style="text-align:right;">` +
      `<span style="display:block;font-size:11px;color:${CLIP.c_sub};text-transform:uppercase;letter-spacing:0.05em;">Allowed stay</span>` +
      `<span style="display:block;font-size:16px;font-weight:600;color:${CLIP.c_text};margin-top:2px;">` +
      escapeHtmlSafe(stay) +
      `</span></span>`
    ) : "") +
    `</div>`;

  const sections = [];

  // Required documents
  if (s.requiredDocs) {
    const items = s.requiredDocs.split("\n")
      .map(l => l.replace(/^[-•*]\s+/, "").trim())
      .filter(Boolean)
      .map(t =>
        `<li style="display:flex;align-items:flex-start;gap:8px;margin-top:8px;font-size:15px;line-height:1.45;">` +
        `<span style="flex-shrink:0;display:inline-block;width:6px;height:6px;border-radius:9999px;background:${CLIP.c_green};margin-top:8px;"></span>` +
        escapeHtmlSafe(t) +
        `</li>`
      ).join("");
    sections.push(clipSection(
      "Required documents", "docs",
      `<ul style="list-style:none;padding:0;margin:0;">${items}</ul>`,
    ));
  }

  // Passport / Fee / Processing (3-col table for email safety)
  const grid = [];
  if (s.passportValidity) grid.push({ title: "Passport validity", name: "passport", body: s.passportValidity });
  if (s.fee)              grid.push({ title: "Fee",                name: "fee",       body: s.fee });
  if (s.processingTime)   grid.push({ title: "Processing time",   name: "time",      body: s.processingTime });
  if (grid.length) {
    const cells = grid.map((g, i) => {
      const pad = i === 0 ? "" : "padding-left:8px;";
      return (
        `<td style="width:33.33%;vertical-align:top;${pad}">` +
        clipSection(g.title, g.name, `<div style="font-size:15px;line-height:1.45;color:${CLIP.c_text};">${escapeHtmlSafe(g.body.trim())}</div>`) +
        `</td>`
      );
    }).join("");
    sections.push(
      `<table role="presentation" style="width:100%;border-collapse:collapse;margin-top:16px;border:0;">` +
      `<tr><td style="padding:0;">` +
      `<table role="presentation" style="width:100%;border-collapse:collapse;"><tr>${cells}</tr></table>` +
      `</td></tr></table>`
    );
  }

  // Official application CTA
  if (s.officialUrl && /^https?:\/\//.test(s.officialUrl.trim())) {
    sections.push(clipSection(
      "Official application", "shield",
      `<a href="${escapeHtmlAttr(s.officialUrl.trim())}" style="display:flex;align-items:center;justify-content:center;` +
      `gap:8px;min-height:48px;padding:0 24px;background:${CLIP.c_green};color:${CLIP.c_black};` +
      `border:2px solid ${CLIP.c_green};border-radius:12px;font-weight:600;font-size:15px;text-decoration:none;">` +
      `Open official site <span style="font-size:14px;">${escapeHtmlSafe(ICON_GLYPH.external)}</span>` +
      `</a>`,
    ));
  } else if (s.officialUrl) {
    sections.push(clipSection(
      "Official application", "shield",
      `<div style="font-size:15px;line-height:1.45;color:${CLIP.c_text};">${escapeHtmlSafe(s.officialUrl.trim())}</div>`,
    ));
  }

  // Caveats
  if (caveats) {
    sections.push(
      `<div style="margin-top:16px;padding:16px 20px;background:${CLIP.c_warnBg};` +
      `border:1px solid ${CLIP.c_warnBd};border-radius:16px;color:${CLIP.c_warnTxt};">` +
      `<div style="font-weight:700;font-size:15px;margin-bottom:8px;display:flex;align-items:center;">` +
      clipChip(ICON_GLYPH.warn, "warn") + `<span>Caveats</span>` +
      `</div>` +
      `<div style="font-size:14px;line-height:1.5;white-space:pre-wrap;">${escapeHtmlSafe(caveats.trim())}</div>` +
      `</div>`
    );
  }

  // Sources
  if (s.sources) {
    const links = [];
    s.sources.split("\n").forEach((line) => {
      const m = line.match(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/);
      if (m) links.push({ label: m[1], url: m[2] });
    });
    if (links.length) {
      const linksHtml = links.map(l =>
        `<a href="${escapeHtmlAttr(l.url)}" style="display:inline-flex;align-items:center;gap:6px;` +
        `color:${CLIP.c_accent};font-size:14px;text-decoration:underline;margin-right:12px;margin-top:4px;">` +
        `<span style="font-size:14px;">${escapeHtmlSafe(ICON_GLYPH.external)}</span>` +
        `<span>${escapeHtmlSafe(l.label)}</span>` +
        `</a>`
      ).join("");
      sections.push(clipSection(
        "Sources", "external",
        `<div style="display:block;">${linksHtml}</div>`,
      ));
    }
  }

  // Meta + Disclaimer
  const date = meta.lastVerified || new Date().toISOString().slice(0, 10);
  const metaHtml = `<p style="margin-top:16px;font-size:12px;color:${CLIP.c_sub};text-align:center;">Last verified: ${escapeHtmlSafe(date)}</p>`;
  const discHtml =
    `<div style="margin-top:12px;padding:12px 16px;background:${CLIP.c_discBg};border-radius:12px;` +
    `font-size:12px;line-height:1.5;color:${CLIP.c_sub};">` +
    `<span style="display:inline-block;margin-right:4px;color:${CLIP.c_sub};font-size:14px;vertical-align:-2px;">${escapeHtmlSafe(ICON_GLYPH.info)}</span>` +
    `This is general information based on publicly available sources as of ${escapeHtmlSafe(date)}. ` +
    `Visa requirements change frequently and are determined solely by the destination country's authorities. ` +
    `Always verify with the destination embassy or consulate before booking travel. ` +
    `<strong>Not legal advice. Not a substitute for an immigration attorney.</strong>` +
    `</div>`;

  return clipWrap(statusHtml + sections.join("") + metaHtml + discHtml);
}

function buildReportText(md, caveats) {
  const s    = parseSections(md);
  const meta = extractMeta(md);
  const date = meta.lastVerified || new Date().toISOString().slice(0, 10);
  const out  = [];

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
    const items = s.requiredDocs.split("\n")
      .map(l => l.replace(/^[-•*]\s+/, "").trim())
      .filter(Boolean);
    if (items.length) out.push("Required documents\n- " + items.join("\n- "));
  }
  push("Official application", s.officialUrl);
  push("Exception rules",       s.exceptions);
  push("Travel advisories",     s.advisories);
  if (s.sources) {
    const links = [];
    s.sources.split("\n").forEach((line) => {
      const m = line.match(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/);
      if (m) links.push({ label: m[1], url: m[2] });
    });
    if (links.length) {
      out.push("Sources\n" + links.map(l => `- ${l.label} (${l.url})`).join("\n"));
    }
  }
  if (caveats && caveats.trim()) out.push("Caveats\n" + caveats.trim());
  out.push(`Last verified: ${date}`);
  out.push("---");
  out.push(`This is general information based on publicly available sources as of ${date}. Not legal advice. Not a substitute for an immigration attorney.`);

  return out.join("\n\n");
}

async function copyReport(md, caveats) {
  const html = buildReportHtml(md, caveats);
  const text = buildReportText(md, caveats);
  // Modern: both blobs → rich text in mail/chat, plain text elsewhere.
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html":  new Blob([html], { type: "text/html"  }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return "rich";
    } catch {
      // Fall through to plain-only.
    }
  }
  await navigator.clipboard.writeText(text);
  return "plain";
}
