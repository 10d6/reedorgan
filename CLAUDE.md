# Reed organ: working in this repository

A playable parlor reed organ that runs in the browser, published with GitHub Pages
from `main`. The owner reviews and merges pull requests and does not otherwise
work in the repo.

## Read first

- `docs/decisions.md` lists the owner's preferences and why the sound works the way it does. Read it before changing anything audible.
- `docs/architecture.md` covers the files, how the modules fit together, signal flow, control loop, state, and where each feature lives.
- `README.md` is the player-facing description. Keep it in step with features.

## Rules

- Every change arrives as a PR from a branch made from the latest `main`. Never push to `main`. Before starting, check whether earlier PRs have merged.
- Keep the instrument static and build-free: plain files and native ES modules (D1, D11). The only external resource allowed is Google Fonts.
- Modules do no work when they load, only definitions. Work goes in the module's `setup…()` function, called from `js/main.js` (D11). Pure maths goes in `js/core/` with explicit inputs and gets a unit test.
- Before opening a PR, run `node scripts/check.mjs`, `npm run test:unit` and `npx playwright test`. Pages deploys every merge without re-checking, so never open a PR with a failing check or test.
- The tests are black-box (see `tests/README.md`). Keep the ids, aria-labels and readouts they rely on stable, or update the tests in the same PR. If a deliberate sound change fails a test, update the test and its `docs/decisions.md` entry together.
- Defaults keep the current sound unless the owner asked for a change.
- For anything audible, measure the rendered audio and put the numbers in the PR (D9).
- Add a `docs/decisions.md` entry for every design choice. Update `docs/architecture.md` when structure or names change.

## Conventions

- Colours are tokens in the `:root` block of `css/organ.css`. The design is deliberately single-theme (dark walnut cabinet).
- New sliders go in `setupControls()` in `js/controls.js` as `ctl.name = bindSlider(id, key, default, format, onChange, map)`. The input id ends in `Amt` and its `<output>` ends in `Out`. A slider is part of patches automatically (D33); a new setting that isn't a slider must register with `patchField()` from `js/patches.js` in its module's setup, or it won't be saved. Only your setup and the page layout (Volume, learned MIDI controls, open drawers, info) save themselves through `store`.
- Input calls `press(m)` / `release(m)`, never `noteOn` / `noteOff` directly.
- Keep the "Things to listen for" notes in step with features.
- PR descriptions say what the player hears or does differently, include measurements, and end with "Try after merging". Write them for a reader who won't look at the code.

## Tooling notes for Claude sessions

- GitHub GraphQL is blocked from these sessions, so `gh pr create` fails. Open PRs with the REST API: `gh api -X POST repos/paperclipsoftware/reedorgan/pulls --input pr.json` (JSON with `title`, `head`, `base`, `body`). Check CI with `gh api repos/paperclipsoftware/reedorgan/commits/<branch>/check-runs`.
- The Pages settings API is blocked too. Pages changes need the owner.
- Chromium for Playwright is preinstalled: run tests with `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx playwright test` after `npm ci`, with no browser download needed. `@playwright/test` is pinned to 1.56.0 to match that browser; change both together.
- `github.io` isn't reachable from the session, so test against the local files (`npm run serve`, or let Playwright start the server).
