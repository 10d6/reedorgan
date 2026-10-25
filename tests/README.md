# Tests

The tests play the organ in a real Chromium browser and measure the sound it
produces. They run on every pull request (the **test** job in
`.github/workflows/check.yml`) and take about a minute and a half.

```sh
npm ci                                   # once
npx playwright install chromium          # once (not needed in Claude sessions; see CLAUDE.md)
npx playwright test                      # everything in the browser
npx playwright test tests/sound.spec.js  # one file
npx playwright test -g "Vox"             # by name
npm run test:unit                        # unit tests for js/core (no browser, under a second)
```

The config starts `scripts/serve.mjs` on port 8123 automatically.

## What's covered

| File | Checks |
| --- | --- |
| `page.spec.js` | Loads with no script errors; every slider shows a value; no sideways scrolling at 1280, 700 and 390 px; keyboard size; the top bar's order (name, gauge, volume and MIDI); Rank voicing under the stops and closed; the status line under the gauge doesn't move it; the Vox Humana drawer opens when the stop is drawn and stays open when it's retired; the MIDI prompt; the D25 defaults; info buttons hide and show their own section's text and are remembered. |
| `autoplay.spec.js` | Pedal autoplay defaults (on, 4/4, 1 bar, 100 bpm, R L rest) and helper 2%; it waits for the first note, then strokes right, left a beat apart and loops each bar; it holds the wind up for one note and lets it fall when turned off; editing cells, meter and measures, and all of it saved. |
| `stops.spec.js` | Default stops; one reed per drawn stop; divided stops at both split points; undividing; couplers pulling keys and following held chords; reference-counted notes. |
| `input.spec.js` | Mouse drag across keys; computer-key mapping; the wind running out and treadles refilling it; MIDI notes, sustain, expression (CC11/CC4) and all-notes-off; Space pumping; the All notes off button and Escape; Shift and Command can't leave keys stuck; Keyboard compass; Easy wind caps a full-organ chord's air at three reeds and is remembered; Direct wind's slider alone sets the gauge (treadles, autoplay and a big chord don't move it), 0″ is silent, MIDI CC2 moves it, and it's remembered; the volume knob (CC7) drives Direct wind when it's on and Volume when it's off, and Learn binds another control. |
| `expression.spec.js` | Expression (D28, D29), with pitch measured from the speakers: off by default; a scoop starts most of a semitone down, only rises, and lands within 0.5 ¢ with both curves; Top voice skips a note under a held key and Every note doesn't; a chord's lower note gives up its scoop; leaps up scoops a fourth but not a step; harder MIDI notes scoop deeper; coupled octaves scoop with the key; the pitch wheel spans ±Bend range; the mod wheel sets Scoop; Accents scoop fully past the Crossover and not below it; Late snap holds low and lands exactly; vibrato is off by default, waits for its delay, grows to its width at its rate and stays centred; its delay counts from the scoop's landing; Top voice hands the vibrato to each new top note; a learned controller at Never holds it off and pushed up brings it in on a held note, and Clear unbinds it; coupled octaves stay one clear pitch; Natural variation makes timing and width wander; Voice colour moves the treble but not the bass; settings are remembered. |
| `modseq.spec.js` | The modulation sequencer (D30), with the wind read from the gauge every frame: off by default, leaving Direct wind alone; turning it on turns Direct wind on; the default pattern swells the wind up and back each bar from the Direct wind setting, loops while held, and eases back when let go; notes build on each other, hold between notes and stop at 3.6″; First note carries on through a second key while Each note restarts; placing, replacing, stretching by keys and by dragging, shortening, Backspace, Clear, 1 and 2 bars, and the pattern surviving a reload; editing keys stay out of the organ while letter keys still play; nothing moves while Direct wind is off; choosing the fan draws the Vox Humana (only while the sequencer is on) and the swell needs nothing, with the Amount readout in each target's units; the fan's flicker follows the pattern and returns to its slider's speed; the swell opens about 6 dB louder without moving its slider and closes again; the fan doesn't follow the pattern with the Vox Humana retired. |
| `settings.spec.js` | Settings survive a reload; linked and unlinked treadle envelopes; factory voicing reset; fitting new reeds; readout formats. |
| `unit/core.test.mjs` | The pure maths in `js/core`: Celeste beats at a constant rate; reed errors are uncorrelated between neighbouring keys and octaves (the old sawtooth fails this); wind response; Unison pull locks close unisons and leaves the Celeste alone; pitch goes flat as the wind rises; the loudness knee; Easy wind's drain cap; brightness compensation; volume, limiter make-up and soft clip; the Cabinet bass slider's corner; the new Melodia and Bourdon recipes keep their old loudness; speech time slower for low reeds and low wind, with an S-shaped onset; the fan wave's shape; treadle envelope stages; the Expression scoop curves land exactly with no kink and last at least the reed's speech time, which notes scoop in each mode, and the pitch wheel spans exactly its range; Late snap holds below longest and arrives at its fastest; Accents' crossover; the vibrato delay, its controller mapping and start time; the fade-in curve and slower start; the wander curve is smooth, bounded and loops; the sequencer's curves and rows, notes building on each other and holding between notes, the limits, placing, stretching and shortening notes, loading and shrinking patterns, and its 16th-note timing; the targets' ranges, conversions and Amount readout. |
| `sound.spec.js` | Measured audio: silence and sound; rank Level −6 dB at 50%; Brightness changes tone but not volume; knee swell about 5 dB louder and brighter; Volume 50% is −12 dB; the limiter keeps full organ at 150% below full scale; Cabinet bass rolls off the Bourdon's deepest fundamentals; Sub octave adds bass below 160 Hz; full wind reads flat; low reeds speak more slowly than high ones; notes start dark and brighten, and Tone bloom Off doesn't; Unison pull holds Diapason and Melodia in step and Off lets them beat; the Vox Humana fan leaves bass and loudness steady and flickers the treble, stereo sweep moves only the treble, whole-sound wobble still works, and the fan coasts to a stop. |

The sound tests check the properties recorded in `docs/decisions.md`. If a test
fails after a deliberate change to the sound, update the test *and* the decision
entry together, and say so in the PR.

## How they work

`tests/organ.js` adds instrumentation before the page loads:

- **Speakers tap.** Every `AudioContext.destination` is replaced by a pass-through node that also feeds a left and right analyser. Whatever the organ sends to the speakers is measured, without reaching into its code.
- **Fake MIDI keyboard.** `navigator.requestMIDIAccess` returns one input the tests play with `window.__midi(status, data1, data2)`.
- **Pitch.** `window.__pitch(lo, hi)` estimates the fundamental of the left ear's last 1024 samples by autocorrelation, with a clarity score; `pitchTrace(page, ms, midiMessages)` plays MIDI and records it every ~6 ms, for scoop and pitch-wheel tests.
- **Wind gauge.** `gaugeTrace(page, ms, midiMessages)` plays MIDI and reads the gauge needle's angle every animation frame, in inches, for the modulation sequencer's tests.
- **Sampling.** `window.__sample(ms)` records per-band power (below 400 Hz, above 2 kHz, everything, below 160 Hz) for each ear every 8 ms. `measure()` turns that into how far each band moves in dB (5th to 95th percentile) and how far it swings between left and right.

Measurements use a held A3 on the Diapason alone, with steady wind (helper pump at 100%, Pedal autoplay off), and with breath noise, treadle noise, cabinet and room turned off.

## The contract with the page

The tests are black-box, so they rely only on what a player can see and use. Keep these stable, or update the tests in the same PR:

- **Element ids:** sliders end in `Amt` with an `<output>` ending in `Out`. Other ids used: `keys`, `stops`, `split`, `compass`, `panicBtn`, `easyWind`, `directOn`, `directLearn`, `directCC`, `autoOn`, `meter`, `measures`, `autoGrid` (its `.beat` buttons carry `data-v` = `L`, `R`, `-` or `~`, `aria-label` "Measure m, beat b: …", and the class `now` under the playhead), `flowR`, `toneModel`, `voxShape`, `exprPanel`, `scoopMode`, `scoopCurve`, `vibMode`, `vibLearn`, `vibCC`, `vibForget`, `seqPanel`, `seqOn`, `seqTarget`, `seqTrigger`, `seqBars`, `seqClear`, `seqGrid` (its `.seq-cell` buttons carry `data-row` and `data-step`; each `.seq-note` has an `aria-label` such as "Sweep up, S-curve, 8 sixteenths from bar 1, beat 1, 16th 1" and `.seq-handle.start`/`.end` to drag), `needle` (the gauge, read by `gaugeTrace`), `voicing`, `voicingReset`, `newReeds`, `midiBtn`, `midiStatus`, `link`, the treadle envelope sliders `aL`/`aR` with `aoL`/`aoR`, `flowL`, and the readouts `rWind`, `rPitch`, `rReeds`, `rUse`, `status`.
- **Keys:** `#keys .key` elements with `data-midi`; a pressed key has the class `down`; the split notch is `.white.split`.
- **Drawers:** `#voicing`, `#voxPanel`, `#exprPanel` and `#seqPanel` are `<details>`; their `summary` opens them. Controls inside a closed drawer can be set with `setSlider` but not clicked or selected.
- **MIDI prompt:** `#midiBtn` has the class `attention` until an input is listening.
- **Info buttons:** `.info-btn` with `data-key` matching its section's `data-info` (e.g. `wind`, `voicing`), `aria-pressed`, and the accessible name `About <heading>`.
- **Stops:** buttons with `aria-pressed` and accessible names such as `Diapason 8′`, `Bass Melodia 8′`, `Vox Humana tremolo` and `Sub octave coupler`. Group captions are `.group-label`.
- **Computer keys:** `Z`–`M` from C3, `Q`–`U` from C4, `I` = C5, matched by physical key; arrows and Space pump; Escape is all notes off.
- **Storage:** settings in `localStorage` under `reed-<key>`; the reed set under `reed-reedSeed`.
