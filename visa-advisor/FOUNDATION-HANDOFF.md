# Nominations 2026 foundation handoff

Verification record for TSK-092, checked against Git base `14647254cfffd6347c3fc4a65f8326ce25b67143`.

## Theme contract and shared tokens

Set `theme-light` or `theme-dark` on `<html>` or `<body>`. An explicit class overrides system preference; with neither class, `prefers-color-scheme: dark` selects dark and light is the default. The existing page starts with `body.theme-light`. A shell theme control should toggle these classes and leave no class for system-following behavior.

Shared semantic tokens for shell and report surfaces are `--color-lime`, `--color-ink`, `--color-bg`, `--color-muted`, `--color-line`, `--color-field`, `--color-card`, `--color-card-secondary`, `--color-hover`, `--color-progress-done`, `--color-progress-done-text`, `--color-focus`, `--color-focus-border`, `--color-focus-glow`, and `--color-error`. Existing component aliases remain available during migration.

## Contrast

Ratios below use the WCAG relative-luminance formula on the declared sRGB token values. Normal text was checked against 4.5:1, large text and essential indicators against 3:1.

| Theme and token pair | Ratio | Threshold |
| --- | ---: | ---: |
| Light ink / page background | 18.08:1 | 4.5:1 |
| Light muted / page background | 4.70:1 | 4.5:1 |
| Light card secondary / card | 5.51:1 | 4.5:1 |
| Light lime / ink primary control | 13.92:1 | 3:1 |
| Light progress text / done surface | 5.65:1 | 4.5:1 |
| Light focus / page background | 18.08:1 | 3:1 |
| Light error / error surface | 5.44:1 | 4.5:1 |
| Dark ink / page background | 16.61:1 | 4.5:1 |
| Dark card secondary / card | 9.04:1 | 4.5:1 |
| Dark lime / page background | 13.76:1 | 3:1 |
| Dark progress text / done surface | 9.22:1 | 4.5:1 |
| Dark focus / page background | 13.76:1 | 3:1 |
| Dark error / error surface | 5.65:1 | 4.5:1 |

No measured pair failed. Focus styling is a 2px theme-aware outline with a 4px offset; the browser check confirmed its visible outline in each explicit theme.

## Typography, motion, and scope

The shared stacks are Agrandir, Suisse, Arial, system-ui, sans-serif for headings and Suisse, Arial, system-ui, sans-serif for body. No licensed font files are present in the repository and no Agrandir or Suisse download was added. The generated report-copy template uses the same declared stacks. Material Symbols remains the pre-existing icon font dependency.

Playwright emulation confirmed `.view` and progress animations compute to `none`, and button transition durations are zero under `prefers-reduced-motion: reduce`. The changed-file review against the base contains no paths under `worker/`; no Worker contract edits were made. This record does not include the separate full responsive screenshot deliverable.

## Required completion gate

`npm test` is the root implementation/final verification gate and was run for this handoff; the Worker and Playwright suites passed (22 Worker tests, 26 Playwright tests). Future foundation edits must rerun this command.
