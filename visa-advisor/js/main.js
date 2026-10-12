/* ============================================================
   MAIN — bootstrap, hash router, view orchestration
   ============================================================ */

import { initModal } from "./ui.js?v=20261011-2";
import { initForm } from "./ui.js?v=20261011-2";
import { initReportView, readReportCache } from "./ui.js?v=20261011-2";

function localISODate() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function start() {
  let formApi, reportApi;
  try {
    initModal();
    formApi = initForm({
      onSubmit: (input) => {
        try {
          sessionStorage.setItem("visa-advisor.last-input", JSON.stringify(input));
        } catch {}
        navigate("/report", serialize(input));
      },
    });
    reportApi = initReportView({
      onEdit: () => navigate("/", ""),
    });
  } catch (err) {
    console.error("[visa-advisor] init failed:", err);
    const ann = document.querySelector("[data-announcer]");
    if (ann) ann.textContent = "Advisor failed to initialize. Open DevTools for details.";
    return;
  }

  window.addEventListener("hashchange", handleRoute);
  handleRoute();

  function handleRoute() {
    const hash = window.location.hash.slice(1) || "/";
    const [path, qs] = hash.split("?");
    // ROUTES is built here (not at module top level) because showForm/showReport
    // are declared inside start() and aren't in scope until start() runs.
    const routes = {
      "":        showForm,
      "/":       showForm,
      "/report": showReport,
    };
    const handler = routes[path] || showForm;
    handler(qs ? Object.fromEntries(new URLSearchParams(qs)) : {});
  }

  function showForm(prefill = {}) {
    reportApi.el.hidden = true;
    document.querySelector('[data-view="form"]').hidden = false;
    let saved = {};
    try {
      saved = JSON.parse(sessionStorage.getItem("visa-advisor.last-input")
        || localStorage.getItem("visa-advisor.last-input") || "{}");
    } catch {}
    const values = {
      nationality: prefill.nat || saved.nationality,
      from:        prefill.from || prefill.arr || saved.from || saved.arrival,
      destination: prefill.dst || saved.destination,
      comments:    prefill.comments || saved.comments,
      tripIntent:  prefill.intent || saved.tripIntent || "entry",
    };
    if (Object.values(values).some(Boolean)) formApi.setFormData(values);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function showReport(params = {}) {
    document.querySelector('[data-view="form"]').hidden = true;
    reportApi.el.hidden = false;
    // Hide any previously-rendered report state immediately so stale
    // content never lingers while this route decides what to show next.
    reportApi.show("loading");

    // Migration shim: legacy URLs use ?arr= (old "arrival" field), legacy
    // localStorage payloads use { arrival }. Map both to `from`.
    const from = params.from || params.arr || "";

    const input = {
      nationality: params.nat,
      from:        from,
      destination: params.dst,
      date:        localISODate(),
      purpose:     "business",
      tripIntent:  params.intent === "airport-transit" ? "airport-transit" : "entry",
    };
    let savedInput = {};
    try {
      savedInput = JSON.parse(sessionStorage.getItem("visa-advisor.last-input")
        || localStorage.getItem("visa-advisor.last-input") || "{}");
    } catch {}
    const sameSavedRoute = [
      [input.nationality, savedInput.nationality],
      [input.from, savedInput.from || savedInput.arrival],
      [input.destination, savedInput.destination],
    ].every(([current, saved]) =>
      String(current || "").trim().toLowerCase() === String(saved || "").trim().toLowerCase()
    );
    if (params.comments) input.comments = params.comments;
    else if (sameSavedRoute && savedInput.comments) input.comments = savedInput.comments;
    if (sameSavedRoute && savedInput.date) input.date = savedInput.date;
    if (sameSavedRoute && savedInput.purpose) input.purpose = savedInput.purpose;

    if (input.nationality && input.from && input.destination) {
      reportApi.setRoute(input.nationality, input.from, input.destination);
      // v0.9 — try the route-keyed report cache first. If fresh, render
      // it instantly; only fall through to the network when the cache
      // miss (or expired).
      const cached = readReportCache(input);
      if (cached) {
        try {
          reportApi.hideProgress();
          reportApi.renderCached(input, cached);
          return;
        } catch (err) {
          console.warn("[visa-advisor] cached render failed; refetching:", err);
        }
      }
      reportApi.runQuery(input);
    } else if (!input.nationality && !input.from && !input.destination) {
      let cached = null;
      try {
        cached = sessionStorage.getItem("visa-advisor.last-input")
              || localStorage.getItem("visa-advisor.last-input");
      } catch { /* continue to the form when browser storage is disabled */ }
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          // Migration shim for legacy cached shape { arrival } → { from }.
          if (parsed && !parsed.from && parsed.arrival) parsed.from = parsed.arrival;
          reportApi.setRoute(parsed.nationality, parsed.from, parsed.destination);
          // Same cache-first behaviour as above (the pill reuses this path).
          const cachedReport = readReportCache(parsed);
          if (cachedReport) {
            try {
              reportApi.hideProgress();
              reportApi.renderCached(parsed, cachedReport);
              return;
            } catch (err) {
              console.warn("[visa-advisor] cached render failed; refetching:", err);
            }
          }
          reportApi.runQuery(parsed);
        } catch (err) {
          console.warn("[visa-advisor] saved input is invalid; showing the form:", err);
          navigate("/", "");
        }
      } else {
        navigate("/", "");
      }
    } else {
      navigate("/", "");
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function navigate(path, qs) {
    const url = `#${path}${qs ? "?" + qs : ""}`;
    if (window.location.hash !== url) {
      window.location.hash = url;
    } else {
      handleRoute(); // same-hash programmatic nav
    }
  }

  function serialize(input) {
    const p = new URLSearchParams();
    if (input.nationality) p.set("nat", input.nationality);
    if (input.from)        p.set("from", input.from);
    if (input.destination) p.set("dst", input.destination);
    if (input.tripIntent === "airport-transit") p.set("intent", input.tripIntent);
    return p.toString();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
