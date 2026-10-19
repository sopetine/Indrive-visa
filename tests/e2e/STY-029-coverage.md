# STY-029 compatibility coverage map

## Baseline and scope

The comparison base is `14647254cfffd6347c3fc4a65f8326ce25b67143` (also current `HEAD`). The checkout already contained redesign work in `visa-advisor/`, `FOUNDATION-HANDOFF.md`, and a large Playwright expansion before this story's change. The STY-029 addition is limited to `tests/e2e/visa-advisor.spec.mjs` and this coverage record. `worker/`, `package.json`, and `playwright.config.mjs` remain unchanged from the baseline.

## Principal views and behavior coverage

| View / behavior | Existing automated coverage |
| --- | --- |
| Form, field validation, labels and submission payload | `advisor form validation is accessible and clears as required fields are edited`; `required route, private comments, distinct trip context, and research warning work end to end` |
| Research loading and stream progress | `streamed research lists unique result hosts and final source favicons without overflow`; `research progress stays indeterminate until the report is ready` |
| Error retry and clarification | `research error retry and clarification remain operable across themes and widths` |
| Completed report and sources | `completed report cards, sources, and disclosures stay readable and keyboard visible` |
| Checklist, progress, persistence and reset | `preparation actions toggle accessibly and leave cited evidence unchanged across themes and widths`; preparation progress restoration, reset, report identity, and storage failure tests |
| Checklist printing | `checklist print is conditional, focused, one-shot, and preserves progress`; print-privacy and print-fallback tests |
| Comments and privacy | end-to-end submission test checks comments and URL privacy; checklist print test checks private comment omission |
| Theme and accessibility | `mast branding, keyboard theme control, and responsive widths`; `shared focus indicators follow theme tokens and reduced motion suppresses effects`; `semantic theme tokens support explicit light, explicit dark, and system fallback` |

## Gaps found and filled

Existing screenshot matrices covered research progress, completed report, report error, and preparation checklist at 1440px/390px in light and dark themes. The form had responsive geometry assertions but no screenshot matrix. The 390x680 form viewport checked general visibility/overflow but not the compact-height rules or the submit control's reachable layout. `form visual baseline is captured at required sizes and compact heights` now captures all four form screenshots and asserts the compact 24px hero padding, 20px form padding, 12px field gap, visible field/submit controls, and scroll reachability.

The existing token assertions cover selected status/warning foreground/background pairs, but not every rendered text pair. Landmark coverage checks for `main`; label association and keyboard progression are checked in the form test; focused controls are checked in theme, report, checklist, print, and modal tests. A complete automated page-wide contrast or landmark audit remains outside this verification-scope story; this change does not claim one.

## Test command chain

Root `npm test` runs `npm run test:worker && npm run test:e2e`.
