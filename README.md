# Visa Advisor

The static advisor UI uses the VisaAdvisor lime V brand, responsive form, report, and footer layouts, and explicit light and dark themes. Headings use Archivo and body/UI text uses Inter, loaded from Google Fonts.

This repository has one source branch: `main`.

## What lives here

- `visa-advisor/` — the website shown at [sopetine.github.io/Indrive-visa](https://sopetine.github.io/Indrive-visa/).
- `worker/` — the private-key proxy and research service used by the website.
- `scripts/deploy.sh` — deploys the Worker to Cloudflare after Cloudflare access is configured.

The Worker uses OpenCode Go's OpenAI-compatible chat completions endpoint (`https://opencode.ai/zen/go/v1/chat/completions`) with model ID `deepseek-v4.1-flash`. Configure `LLM_API_KEY` as a Cloudflare Worker secret; Tavily research continues to use `TAVILY_API_KEY`.

## Publishing

Changes to `visa-advisor/` on `main` publish automatically to GitHub Pages through [the Pages workflow](.github/workflows/deploy-pages.yml). Before upload, the workflow rewrites local CSS and JavaScript URLs in the site artifact to use the publishing commit SHA. Source files retain their manually maintained query strings for local development. There is no separate website publishing branch.

The same workflow also deploys the Worker to Cloudflare (`wrangler deploy`) on every push to `main`, after the tests pass. Only the `LLM_API_KEY` secret is set by hand (`npx wrangler secret put LLM_API_KEY` in `worker/`). `scripts/deploy.sh` remains for manual deploys.

Coding agents: start with [AGENTS.md](AGENTS.md).
