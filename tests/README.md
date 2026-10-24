# Tests

The tests play the organ in a real Chromium browser and measure the sound it
produces. They run on every pull request (the **test** job in
`.github/workflows/check.yml`) and take about a minute and a half.

```sh
npm ci                                   # once
npx playwright install chromium          # once (not needed in Claude sessions; see CLAUDE.md)
npx playwright test                      # everything
npx playwright test tests/sound.spec.js  # one file
npx playwright test -g "Vox"             # by name
```

The config starts `scripts/serve.mjs` on port 8123 automatically.

## What's covered

| File | Checks |
| --- | --- |
| `page.spec.js` | Loads with no script errors; every slider shows a value; no sideways scrolling at 1280, 700 and 390 px; keyboard size. |
| `stops.spec.js` | Default stops; one reed per drawn stop; divided stops at both split points; undividing; couplers pulling keys and following held chords; reference-counted notes. |
| `input.spec.js` | Mouse drag across keys; computer-key mapping; the wind running out and treadles refilling it; MIDI notes, sustain, expression (CC11/CC4) and all-notes-off; Space pumping. |
| `settings.spec.js` | Settings survive a reload; linked and unlinked treadle envelopes; factory voicing reset; fitting new reeds; readout formats. |
| `sound.spec.js` | Measured audio: silence and sound; rank Level −6 dB at 50%; Brightness changes tone but not volume; knee swell louder and brighter; Sub octave adds bass; the Vox Humana fan leaves bass and loudness steady and flickers the treble, stereo sweep moves only the treble, whole-sound wobble still works, and the fan coasts to a stop. |

The sound tests check the properties recorded in `docs/decisions.md`. If a test
fails after a deliberate change to the sound, update the test *and* the decision
entry together, and say so in the PR.

## How they work

`tests/organ.js` adds instrumentation before the page loads:

- **Speakers tap.** Every `AudioContext.destination` is replaced by a pass-through node that also feeds a left and right analyser. Whatever the organ sends to the speakers is measured, without reaching into its code.
- **Fake MIDI keyboard.** `navigator.requestMIDIAccess` returns one input the tests play with `window.__midi(status, data1, data2)`.
- **Sampling.** `window.__sample(ms)` records per-band power (below 400 Hz, above 2 kHz, everything) for each ear every 8 ms. `measure()` turns that into how far each band moves in dB (5th to 95th percentile) and how far it swings between left and right.

Measurements use a held A3 on the Diapason alone, with steady wind (helper pump at 100%), and with breath noise, treadle noise, cabinet and room turned off.

## The contract with the page

The tests are black-box, so they rely only on what a player can see and use. Keep these stable, or update the tests in the same PR:

- **Element ids:** sliders end in `Amt` with an `<output>` ending in `Out`. Other ids used: `keys`, `stops`, `split`, `toneModel`, `voxShape`, `voicing`, `voicingReset`, `newReeds`, `midiBtn`, `midiStatus`, `link`, the treadle envelope sliders `aL`/`aR` with `aoL`/`aoR`, `flowL`, and the readouts `rWind`, `rReeds`, `status`.
- **Keys:** `#keys .key` elements with `data-midi`; a pressed key has the class `down`; the split notch is `.white.split`.
- **Stops:** buttons with `aria-pressed` and accessible names such as `Diapason 8′`, `Bass Melodia 8′`, `Vox Humana tremolo` and `Sub octave coupler`. Group captions are `.group-label`.
- **Computer keys:** `Z`–`M` from C3, `Q`–`U` from C4, `I` = C5; arrows and Space pump.
- **Storage:** settings in `localStorage` under `reed-<key>`; the reed set under `reed-reedSeed`.
