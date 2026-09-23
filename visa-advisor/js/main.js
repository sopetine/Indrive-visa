/* ============================================================
   MAIN — bootstrap, hash router, view orchestration
   ============================================================ */

import { initModal } from "./ui.js";
import { initForm } from "./ui.js";
import { initReportView } from "./ui.js";

function start() {
  let formApi, reportApi;
  try {
    initModal();
    formApi = initForm({
      onSubmit: (input) => {
        sessionStorage.setItem("visa-advisor.last-input", JSON.stringify(input));
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
    if (prefill.nat)  formApi.setFormData({ nationality: prefill.nat, arrival: prefill.arr, destination: prefill.dst, comments: prefill.comments });
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function showReport(params = {}) {
    document.querySelector('[data-view="form"]').hidden = true;
    reportApi.el.hidden = false;

    const input = {
      nationality: params.nat,
      arrival:     params.arr,
      destination: params.dst,
      date:        new Date().toISOString().slice(0, 10),
      purpose:     "business",
    };
    if (params.comments) input.comments = params.comments;

    if (input.nationality && input.arrival) {
      reportApi.setRoute(input.nationality, input.arrival, input.destination);
      reportApi.runQuery(input);
    } else {
      const cached = sessionStorage.getItem("visa-advisor.last-input");
      if (cached) {
        const parsed = JSON.parse(cached);
        reportApi.setRoute(parsed.nationality, parsed.arrival, parsed.destination);
        reportApi.runQuery(parsed);
      } else {
        navigate("/", "");
      }
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
    if (input.arrival)     p.set("arr", input.arrival);
    if (input.destination) p.set("dst", input.destination);
    if (input.comments)    p.set("comments", input.comments);
    return p.toString();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
