# Mock Frontend Hardening — Desktop Safari Acceptance

Related design: [Mock Frontend Hardening Design](../specs/2026-07-26-mock-frontend-hardening-design.md)

## Stage status

**Not complete — required manual rows have not been executed.**

Stage 5 can be marked complete only after every required row below has an outcome other than `Not run` and every reproducible regression has a focused deterministic fixture or unit test.

## Test environment

| Field                  | Recorded value                     |
| ---------------------- | ---------------------------------- |
| Test date              | Not recorded                       |
| Tester                 | Not recorded                       |
| Safari version         | Not recorded                       |
| macOS version          | Not recorded                       |
| Branch                 | `feature/mock-frontend-hardening`  |
| Commit                 | Record the exact tested commit SHA |
| Extension build source | `extension/dist/content.js`        |

## Result vocabulary

- `Pass` — expected behavior was observed with no material regression.
- `Documented limitation` — behavior is outside the approved Stage 5 scope and is recorded below.
- `Regression` — a reproducible defect was found; add its local fixture/test reference.
- `Not run` — no manual evidence has been recorded yet.

## Required run matrix

The proposed public URLs were reachable when this record was created on 2026-07-27. Public content changes over time, so each URL is evidence for one run, not an automated contract. If a URL is unavailable during execution, replace it with a concrete page in the same category and record the page actually tested.

| ID  | Category                             | Concrete URL                                                   | Date / Safari                       | Detect / reject                                  | Loading / success                                     | Compact / expanded / sheet scroll                | Replace / dismiss / back | Page scroll / resize | Page controls                  | Console / network                                             | Outcome    | Limitation or regression reference                                     |
| --- | ------------------------------------ | -------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------ | ------------------------ | -------------------- | ------------------------------ | ------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------- |
| L1  | Local hostile and dynamic fixture    | `http://127.0.0.1:5173/hardening.html`                         | Not run                             | Not run                                          | Not run                                               | Not run                                          | Not run                  | Not run              | Not run                        | Not run                                                       | Not run    | —                                                                      |
| L2  | Local restrictive-CSP fixture        | `http://127.0.0.1:5173/hardening-csp.html`                     | 2026-07-27 / Safari version pending | Pass: ordinary word; controls remain page-native | Regression: mock result renders without sheet styling | Regression: compact/expanded styling unavailable | Not run                  | Not run              | Pass from supplied screenshots | Safari refuses sheet-owned inline stylesheet; Network not run | Regression | External stylesheet fix in MR #5; exact environment and retest pending |
| P1  | Long-form article                    | `https://www.gutenberg.org/files/1342/1342-h/1342-h.htm`       | Not run                             | Not run                                          | Not run                                               | Not run                                          | Not run                  | Not run              | Not run                        | Not run                                                       | Not run    | —                                                                      |
| P2  | Technical documentation              | `https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal` | Not run                             | Not run                                          | Not run                                               | Not run                                          | Not run                  | Not run              | Not run                        | Not run                                                       | Not run    | —                                                                      |
| P3  | News page                            | `https://apnews.com/`                                          | Not run                             | Not run                                          | Not run                                               | Not run                                          | Not run                  | Not run              | Not run                        | Not run                                                       | Not run    | —                                                                      |
| P4  | Dynamically rendered SPA             | `https://react.dev/learn`                                      | Not run                             | Not run                                          | Not run                                               | Not run                                          | Not run                  | Not run              | Not run                        | Not run                                                       | Not run    | —                                                                      |
| P5  | Sticky or fixed-overlay page         | `https://www.theatlantic.com/magazine/`                        | Not run                             | Not run                                          | Not run                                               | Not run                                          | Not run                  | Not run              | Not run                        | Not run                                                       | Not run    | —                                                                      |
| P6  | Complex typography and inline markup | `https://en.wikipedia.org/wiki/Translation`                    | Not run                             | Not run                                          | Not run                                               | Not run                                          | Not run                  | Not run              | Not run                        | Not run                                                       | Not run    | —                                                                      |

## Setup

1. From `extension`, run `npm run build` and load the resulting Safari Web Extension build through the current desktop development workflow.
2. Run `npm run fixture` and keep the Vite server active for rows L1 and L2.
3. In Safari, allow the development extension access to the tested site.
4. Open Web Inspector before each row. Clear Console and Network observations before starting.
5. Use a narrow responsive viewport as the primary layout, then repeat resize checks at a desktop width.
6. Record the exact date, Safari/macOS versions, tested commit, result cells, and notes before leaving each page.

## Per-row protocol

Apply every applicable check to each required row. Summarize the observations in that row's matrix cells rather than writing only `Pass`.

### Detection and rejection

- [ ] An ordinary English word opens the loading sheet.
- [ ] Clicking `turn` in “Turn the light off” on L1 returns the fixed mock expression `turn off`.
- [ ] Words across nested `span`, `strong`, `em`, and `mark` formatting remain eligible where applicable.
- [ ] Punctuation and whitespace do not start a translation.
- [ ] Links, buttons, inputs, editable content, code-like controls, and other excluded interactive targets keep their page behavior and do not start a translation.
- [ ] Text clicked inside the L1 iframe does not open or replace a sheet in the top document.
- [ ] Content inserted with **Replace reading block** on L1 works without reloading or restarting the extension.

### Loading, success, and sheet layout

- [ ] Loading appears immediately and changes to the deterministic success after the configured mock delay.
- [ ] Success shows expression, part of speech, Russian translation, and contextual explanation.
- [ ] The compact sheet is readable, bottom-aligned, and does not block ordinary scrolling above it.
- [ ] Expand and collapse work repeatedly; the expanded sentence highlights only the clicked source word.
- [ ] Long content wraps and the sheet content scrolls internally without horizontal overflow.
- [ ] Close has a usable touch-sized target and focus remains understandable with keyboard navigation.
- [ ] Hostile page typography, button, heading, paragraph, `mark`, and `!important` rules on L1 do not restyle shadow content.
- [ ] On L2, confirm the Shadow Root contains the packaged `translation-sheet.css` `<link>`, the sheet is fully styled under `style-src 'none'`, and no sheet-owned CSP violation appears.

### Replacement, dismissal, and lifecycle

- [ ] Rapid eligible clicks replace the prior request; no stale result overwrites the newest result.
- [ ] An ineligible external page click dismisses the sheet without consuming the page click.
- [ ] Close and Escape dismiss; Escape is not consumed by the extension.
- [ ] **Remove extension host** on L1 removes the visible sheet; the next eligible click remounts one sheet with no duplicate response to Escape.
- [ ] Navigate away with a normal page link, return with Safari Back, and confirm a later eligible click still works after bfcache restoration.
- [ ] No more than one TapTranslate sheet host is visible after replacement, recovery, or back navigation.

### Page compatibility and resource observations

- [ ] Page scrolling continues while the compact sheet is open.
- [ ] Resizing between narrow and desktop widths keeps the sheet usable and does not trigger visible repeated work.
- [ ] Sticky/fixed site UI and the L1 high-z-index overlay do not cover the TapTranslate sheet.
- [ ] Ordinary page links navigate, buttons fire, inputs edit, and L1's page-event counter increments normally.
- [ ] No new TapTranslate error appears in Safari Console.
- [ ] No translation, page text, or provider payload is written to Console.
- [ ] No translation HTTP request appears in Network; the mock provider remains entirely local.

## CSP retest gate

Safari blocked the original inline Shadow DOM stylesheet on L2. A focused design update selected a packaged web-accessible stylesheet while preserving the Shadow DOM boundary.

Before closing the regression:

1. record the Safari and macOS versions and the exact tested commit;
2. confirm the packaged stylesheet loads through the Safari extension URL under `style-src 'none'`;
3. confirm no extension-owned CSP violation remains and rerun the full L2 protocol.

## Known scope boundaries

These are expected limitations, not reasons to expand Stage 5 while executing the matrix:

- translation inside iframe documents is unsupported (`all_frames: false`);
- SPA route observation and automatic dismissal on client-side navigation are unsupported;
- an open sheet is not bound to the continued presence of its original source node;
- touch gesture policy, iOS simulator/device behavior, native packaging, and Xcode integration belong to the next stage;
- public pages are manual discovery inputs and are never automated test dependencies.

## Findings and regression references

| Finding                                                                 | Page / reproduction                 | Resolution or accepted limitation                                        | Test / fixture / follow-up                                                 |
| ----------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Safari blocks the inline Shadow DOM stylesheet under `style-src 'none'` | L2; screenshots supplied 2026-07-27 | Packaged external stylesheet via WebExtension URL; manual retest pending | `2026-07-27-safari-csp-stylesheet-design.md`; focused sheet/manifest tests |

## Completion sign-off

- [ ] All eight required rows have an outcome other than `Not run`.
- [ ] Every reproducible defect has a minimal local reproduction.
- [ ] `npm run check` passes on the exact tested commit.
- [ ] Production bundle contains no fixture controls.
- [ ] Remaining limitations are recorded above.
- [ ] Stage 5 is marked complete in the project roadmap/status only after this sign-off is complete.
