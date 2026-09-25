# Visa Advisor

This repository has one source branch: `main`.

## What lives here

- `visa-advisor/` — the website shown at [sopetine.github.io/Indrive-visa](https://sopetine.github.io/Indrive-visa/).
- `worker/` — the private-key proxy and research service used by the website.
- `scripts/deploy.sh` — deploys the Worker to Cloudflare after Cloudflare access is configured.

## Publishing

Changes to `visa-advisor/` on `main` publish automatically to GitHub Pages through [the Pages workflow](.github/workflows/deploy-pages.yml). There is no separate website publishing branch.

The Worker is hosted separately by Cloudflare. Website publishing does not deploy Worker changes.
