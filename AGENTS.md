# Visa Advisor — guide for coding agents

Read this before planning or changing anything. It replaces rediscovering the project.

## What is here

- `visa-advisor/` — the static website (GitHub Pages). No build step.
  - `index.html` — the single page.
  - `js/ui.js` (rendering, theme control), `js/api.js` (Worker client, streaming), `js/main.js`, `js/countries.js`.
  - `css/tokens.css` (design tokens, light and dark), `base.css`, `buttons.css`, `advisor.css` (screens), `accessibility.css`, `reset.css`.
  - `visa-advisor-prompt.md` — the research prompt; its SHA-256 is pinned in `js/api.js` and checked by the Worker.
- `worker/` — Cloudflare Worker (`src/index.js`): LLM proxy (OpenCode Go, chat completions) plus Tavily search. Secret: `LLM_API_KEY`.
- `tests/e2e/` — Playwright end-to-end tests (mocked Worker). `tests/visual/` — pixel baselines. `worker/test/` — Worker unit tests (`node:test`).
- `scripts/` — `test-production.mjs` (live smoke), `find-free-port.mjs`, `deploy.sh` (manual Worker deploy).

## Commands

| Purpose | Command |
|---|---|
| Install | `npm ci` (once per checkout; reuse `node_modules`) |
| Everything CI runs | `npm test` (Worker unit tests + Playwright e2e) |
| Same, quiet (use this) | `npm run test:quiet` — prints only failures |
| One e2e test | `node ./node_modules/@playwright/test/cli.js test -g "<name>" --reporter=line` |
| Visual baselines | `npm run test:visual` (local only; update with `-- --update-snapshots` when a visual change is intended, and say so) |
| Live smoke | `npm run test:production` |

Push to `main` deploys both the website (Pages) and the Worker (`wrangler deploy`) through `.github/workflows/deploy-pages.yml`.

## Design system

- Tokens live in `css/tokens.css`. Change a token's value there; do not add aliases or one-off colours in component CSS.
- Light and dark themes: explicit `body.theme-light` / `body.theme-dark`, otherwise the system setting. Every change must hold in all three.
- Text on lime (`--color-lime`, `--main-green`, `--light-green`) is always `--color-ink-on-lime` in every theme.
- Before changing a token or a shared class, search every consumer (`rg -n "<token>" visa-advisor/css`) and check each one in both themes.
- `tests/e2e/contrast-audit.spec.mjs` checks every visible text element in all themes and lists all failures at once. Keep it green.

## Rules

- Accessibility: WCAG AA contrast, visible focus, keyboard operation, labels, reduced motion.
- Never read or commit `.env`, keys or tokens. Never log secrets.
- Never commit working notes, handoffs or coverage memos. Put notes in your evidence directory, not in the repository.
- Update `README.md` when behavior, setup or deployment changes.

## Smallest complete change

Adapted from [Ponytail](https://github.com/DietrichGebert/ponytail) (MIT, see below).

Read the task and the code it touches. List every place your change must reach: callers, consumers, tests, fixtures, config. That is scope. Extra features are not.

Take the first option that fully works:

1. Does it need to exist? Skip features and options nobody asked for.
2. Already in this codebase (a token, class, helper, pattern)? Use it the way the surrounding code does.
3. A platform feature (HTML, CSS, browser API)? Use it.
4. An installed dependency? Use it. Never add a dependency for a few lines.
5. Otherwise, the minimum code that works.

- Be lazy about the solution, never about the change: finish every part it needs, including the tests it breaks.
- No abstraction, wrapper, alias, option or "for later" code nobody asked for. Deletion beats addition. Keep the structure the codebase already has.
- Bug fix: find every caller or consumer of what you touch, then fix the root cause once.
- New logic with a branch, a loop or a parser, and any UI behavior change, leaves one small test.
- Never cut validation at trust boundaries, error handling that prevents data loss, security or accessibility.
- End your report with one line: what you skipped or did not check, and any risk.

<sub>Ponytail ruleset: MIT License, Copyright (c) 2026 DietrichGebert. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction, subject to including this copyright and permission notice. The software is provided "as is", without warranty of any kind.</sub>
