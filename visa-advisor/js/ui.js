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

  // Pre-fill nationality from storage (free-form text only)
  const lastNat = localStorage.getItem("visa-advisor.last-nationality");
  if (lastNat) nationalityEl.value = lastNat;

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

  // Re-validate on input
  [nationalityEl, arrivalEl, destinationEl].forEach((el) => {
    el.addEventListener("input", validate);
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

    // Remember nationality for next visit
    localStorage.setItem("visa-advisor.last-nationality", input.nationality);

    onSubmit(input);
  });

  // initial pass
  validate();

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
      validate();
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

const STATUS_ICON = {
  "visa-free": "✓",
  "eta required": "✈",
  "evisa required": "📄",
  "visa on arrival": "🛂",
  "embassy / consulate visa required": "🏛",
  "admission restricted / banned": "⛔",
};

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
  if (sections.passportValidity) grid.appendChild(renderMetaSection("Passport validity", "🪪", sections.passportValidity));
  if (sections.fee)              grid.appendChild(renderMetaSection("Fee", "💳", sections.fee));
  if (sections.processingTime)   grid.appendChild(renderMetaSection("Processing time", "⏱", sections.processingTime));
  if (grid.children.length) body.appendChild(grid);

  // Official URL CTA
  if (sections.officialUrl && /^https?:\/\//.test(sections.officialUrl.trim())) {
    body.appendChild(renderCta(sections.officialUrl));
  } else if (sections.officialUrl) {
    body.appendChild(renderMetaSection("Official application", "🏛", sections.officialUrl));
  }

  // Exception rules, Travel advisories (collapsible)
  if (sections.exceptions && sections.exceptions !== "None identified") {
    body.appendChild(renderCollapsible("Exception rules", "📋", sections.exceptions));
  }
  if (sections.advisories && sections.advisories !== "None relevant") {
    body.appendChild(renderCollapsible("Travel advisories", "⚠", sections.advisories));
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
  const cls = STATUS_CLASS[Object.keys(STATUS_CLASS).find(k => normalized.includes(k)) || "embassy"] || STATUS_CLASS["embassy"];
  const icon = STATUS_ICON[Object.keys(STATUS_ICON).find(k => normalized.includes(k)) || "embassy"] || "";

  wrap.innerHTML = `
    <span class="status-badge ${cls}" id="report-status-title" role="status">
      <span aria-hidden="true">${icon}</span>
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
      <span class="report-section-title-icon" aria-hidden="true">📑</span>
      Required documents
    </h2>
    <ul class="report-section-value report-section-value--list">
      ${items.map(t => `<li>${escapeHtml(t)}</li>`).join("")}
    </ul>
  `;
  return sec;
}

function renderMetaSection(title, icon, value) {
  const sec = document.createElement("section");
  sec.className = "report-section";
  sec.innerHTML = `
    <h2 class="report-section-title">
      <span class="report-section-title-icon" aria-hidden="true">${icon}</span>
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
      <span class="report-section-title-icon" aria-hidden="true">🏛</span>
      Official application
    </h2>
    <a class="report-section-value report-section-value--cta" href="${escapeAttr(url.trim())}" target="_blank" rel="noopener noreferrer">
      Open official site
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </a>
  `;
  return sec;
}

function renderCollapsible(title, icon, value) {
  const sec = document.createElement("details");
  sec.className = "report-section report-section--collapsible";
  sec.innerHTML = `
    <summary class="report-section-summary">
      <h2 class="report-section-title" style="margin-bottom:0">
        <span class="report-section-title-icon" aria-hidden="true">${icon}</span>
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
  // Match markdown links
  const links = [];
  md.split("\n").forEach((line) => {
    const m = line.match(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/);
    if (m) links.push({ label: m[1], url: m[2] });
  });
  sec.innerHTML = `
    <h2 class="report-section-title">
      <span class="report-section-title-icon" aria-hidden="true">🔗</span>
      Sources
    </h2>
    <div class="report-section-value report-section-value--sources">
      ${links.map(l => `<a href="${escapeAttr(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label)}</a>`).join("")}
    </div>
  `;
  return sec;
}

function renderCaveats(text) {
  const wrap = document.createElement("div");
  wrap.className = "report-caveats";
  wrap.setAttribute("role", "note");
  wrap.innerHTML = `
    <div class="report-caveats-title">⚠️ Caveats</div>
    <div class="report-caveats-body">${escapeHtml(text.trim())}</div>
  `;
  return wrap;
}

function renderDisclaimer(date) {
  const wrap = document.createElement("div");
  wrap.className = "report-disclaimer";
  wrap.innerHTML = `ℹ️ This is general information based on publicly available sources as of ${escapeHtml(date)}. Visa requirements change frequently and are determined solely by the destination country's authorities. Always verify with the destination embassy or consulate before booking travel. <strong>Not legal advice. Not a substitute for an immigration attorney.</strong>`;
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
  };

  // Wire action buttons
  root.editBtn.addEventListener("click", () => onEdit());
  root.retryBtn.addEventListener("click", () => {
    if (root._lastInput) runQuery(root._lastInput);
  });
  root.copyBtn.addEventListener("click", () => {
    const text = root.body.innerText;
    navigator.clipboard.writeText(text).then(() => {
      announce("Report copied to clipboard");
      flashBtn(root.copyBtn, "Copied!");
    });
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
    try {
      const data = await queryAdvisor(input);
      if (data.type === "clarify") {
        showClarify(data.question);
        return;
      }
      // Render markdown
      renderReport(root.body, data.markdown);
      // Append caveats (if provided) above the disclaimer
      if (data.caveats) {
        const dis = root.body.querySelector(".report-disclaimer");
        if (dis) root.body.insertBefore(renderCaveats(data.caveats), dis);
      }
      show("report");
      announce("Visa report ready");
    } catch (err) {
      const isTimeout = err.code === "TIMEOUT" || err.name === "AbortError";
      showError(
        isTimeout ? "Request timed out" : "Couldn't reach the service",
        isTimeout
          ? "The advisor took too long to respond. Please try again."
          : "Check your connection and try again."
      );
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
