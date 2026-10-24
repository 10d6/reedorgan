# Reed organ: working in this repository

A playable parlor reed organ that runs in the browser, published with GitHub Pages
from `main`. The owner reviews and merges pull requests and does not otherwise
work in the repo.

## Read first

- `docs/decisions.md` lists the owner's preferences and why the sound works the way it does. Read it before changing anything audible.
- `docs/architecture.md` covers the files, signal flow, control loop, state, and where each feature lives.
- `README.md` is the player-facing description. Keep it in step with features.

## Rules

- Every change arrives as a PR from a branch made from the latest `main`. Never push to `main`. Before starting, check whether earlier PRs have merged.
- Keep the instrument static and build-free (decision D1). The only external resource allowed is Google Fonts.
- Run `node scripts/check.mjs` before opening a PR. Pages deploys every merge without re-checking, so never open a PR with a failing check.
- Defaults keep the current sound unless the owner asked for a change.
- For anything audible, measure the rendered audio and put the numbers in the PR (D9).
- Add a `docs/decisions.md` entry for every design choice. Update `docs/architecture.md` when structure or names change.

## Conventions

- Colours are tokens in the `:root` block. The design is deliberately single-theme (dark walnut cabinet).
- New sliders use `bindSlider(id, storeKey, default, format, onChange, map)`. The input id ends in `Amt` and its `<output>` ends in `Out`. Settings persist through `store`.
- Input calls `press(m)` / `release(m)`, never `noteOn` / `noteOff` directly.
- Keep the "Things to listen for" notes in step with features.
- PR descriptions say what the player hears or does differently, include measurements, and end with "Try after merging". Write them for a reader who won't look at the code.

## Tooling notes for Claude sessions

- GitHub GraphQL is blocked from these sessions, so `gh pr create` fails. Open PRs with the REST API: `gh api -X POST repos/paperclipsoftware/reedorgan/pulls --input pr.json` (JSON with `title`, `head`, `base`, `body`). Check CI with `gh api repos/paperclipsoftware/reedorgan/commits/<branch>/check-runs`.
- The Pages settings API is blocked too. Pages changes need the owner.
- Chromium for Playwright is preinstalled at `/opt/pw-browsers`. Launch with `--autoplay-policy=no-user-gesture-required` so Web Audio runs headless.
- `github.io` isn't reachable from the session, so test against the local files.
