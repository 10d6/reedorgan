# Reed organ: notes for working in this repository

The owner reviews and merges pull requests and does not otherwise work in the
repo. Every change arrives as a PR from a branch; never push to `main`.

## Layout

- `index.html`: the entire instrument (markup, CSS and the Web Audio script in
  one file). Keep it a single self-contained file with no build step. The only
  external resource allowed is Google Fonts.
- `scripts/check.mjs`: dependency-free checks that run in CI on every PR and
  before every Pages deploy. Run `node scripts/check.mjs` before opening a PR.
- `.github/workflows/check.yml`: runs the check on PRs and on `main`.
- `.github/workflows/pages.yml`: publishes `index.html` to GitHub Pages on every
  push to `main`.

## Conventions

- Colours live as tokens in the `:root` block at the top of the `<style>`. The
  design is deliberately single-theme (dark walnut cabinet).
- User settings persist through the `store` helper (localStorage wrapped in
  try/catch). New sliders should save and restore their value the same way.
- Audio graph: rank buses → swell lowpass → wind gain → tremolo → body EQ →
  cabinet convolver (dry/wet) → room convolver (dry/wet) → compressor → output.
  Wind pressure (0–1, gauge reads `pressure × 3.6″`) drives level, brightness
  and pitch in the `frame()` loop.
- Keep the "Things to listen for" notes and the README in step with features.
- In a PR description, say what changed in terms of what the player hears or
  does, and list anything to try after merging.
