# Reed organ: notes for working in this repository

The owner reviews and merges pull requests and does not otherwise work in the
repo. Every change arrives as a PR from a branch; never push to `main`.

## Layout

- `index.html`: the entire instrument (markup, CSS and the Web Audio script in
  one file). Keep it a single self-contained file with no build step. The only
  external resource allowed is Google Fonts.
- `scripts/check.mjs`: dependency-free checks that run in CI on every PR.
  Run `node scripts/check.mjs` before opening a PR.
- `.github/workflows/check.yml`: runs the check on PRs and on `main`.
- Publishing: GitHub Pages deploys from the root of `main` (branch source,
  not Actions), so every merge goes live within a minute or two. `.nojekyll`
  turns off Jekyll processing. Since nothing re-checks the page at deploy
  time, the PR check is the only gate: never open a PR with a failing check.

## Conventions

- Colours live as tokens in the `:root` block at the top of the `<style>`. The
  design is deliberately single-theme (dark walnut cabinet).
- User settings persist through the `store` helper (localStorage wrapped in
  try/catch). New sliders should save and restore their value the same way.
- Audio graph: rank buses (one set per half: `buses.bass[i]`, `buses.treble[i]`;
  a note routes by `halfOf(m)`) → swell lowpass → tilt high-shelf → wind gain →
  tremolo gain → fan stereo panner → body EQ →
  cabinet convolver (dry/wet) → room convolver (dry/wet) → compressor → output.
  Breath noise joins at the tremolo. Wind pressure (0–1, gauge reads
  `pressure × 3.6″`) drives level and pitch in the `frame()` loop. Tone follows
  a smoothed copy (`tonePress`, response time `toneRespS`). In the `tilt` model
  the lowpass sits still (only the knee swell moves it) and the high-shelf gain
  follows the wind; in the `sweep` model the lowpass cutoff follows the wind
  and the shelf is flat. `sweep` at depth 100% with a 20 ms response reproduces
  the original sound.
- Vox Humana: `lfo` drives `lfoAmp` (tremolo gain), `lfoFilt` (lid filter
  detune) and, via `lfoPan` (a cosine oscillator started at the same moment so
  the two stay phase-locked), `lfoPanAmt` → `fanPan.pan`. `applyVox()` sets all
  depths and the fan speed, spinning up on draw and coasting down on retire.
  The Spinning fan shape is one turn of a two-blade fan, so `lfoFreq()` is half
  the displayed speed for that shape.
- Stop state is `stops.bass[id]` / `stops.treble[id]` plus `stops.vox`,
  `stops.sub` and `stops.sup` (octave couplers). When stops are not divided,
  both halves are kept identical.
- Input (pointer, computer keys, MIDI) calls `press(m)` / `release(m)`, never
  `noteOn` / `noteOff` directly; `press` adds coupled octaves and `recouple()`
  updates held keys when a coupler changes. Voices are reference-counted, so a
  note held both directly and through a coupler sounds once.
- Rank voicing lives in `voicing[i].level|tune|bright`. Use `rankLevel(i)` for a
  rank's bus gain (it includes the brightness loudness compensation),
  `rankCents(i, f, m)` for its pitch offset, and `rankWave(i)` for its waveform.
  `retune(i)` and `revoice(i)` update notes that are already sounding.
- New sliders: use `bindSlider(id, storeKey, default, format, onChange, map)`.
  The input id ends in `Amt` and its `<output>` uses the same name ending in `Out`.
- Keep the "Things to listen for" notes and the README in step with features.
- In a PR description, say what changed in terms of what the player hears or
  does, and list anything to try after merging.
