# Architecture

How the organ is put together: where things live, how sound flows, and what state
exists. For *why* things are built this way, see [decisions.md](decisions.md).

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The markup: cabinet, stop rail, gauge, controls, keyboard, treadle area, Adjustments, notes. Loads `css/organ.css` and `js/main.js`. |
| `css/organ.css` | All styles. Colour tokens are in the `:root` block at the top. |
| `js/main.js` | Entry point: calls each module's setup in order (see below). |
| `js/state.js` | Shared state: `S` (pressure, swell, tone and the saved choices), `stops`, `voices`, `store` (localStorage), `halfOf`. |
| `js/controls.js` | Every slider and setting: `bindSlider`, the `ctl` object the sound reads, `mix`, the rank-voicing drawer. |
| `js/audio.js` | The Web Audio graph, voices (`noteOn`/`noteOff`), and everything that pushes settings into the sound (`applyStops`, `applyVox`, `applyWind`, `retune`, …). |
| `js/keys.js` | On-screen keyboard, octave couplers (`press`/`release`/`recouple`), computer keys, MIDI. |
| `js/stops.js` | Stop rail and the divided-stops selector. |
| `js/treadles.js` | The two treadles: ADSR state (`ped`), pedals, envelope pictures, `gateOn`/`gateOff`. |
| `js/autoplay.js` | Pedal autoplay: the pattern editor, its saved pattern, and `stepAutoplay()`, which the control loop calls each frame to press and lift the treadles through `gateOn`/`gateOff`. |
| `js/wind-loop.js` | The per-frame control loop (`frame`), the gauge and readouts. |
| `js/core/*.js` | Pure maths, with no page or audio access: `ranks.js` (ranks, harmonic recipes, brightness compensation, Celeste), `reeds.js` (per-reed scatter, wind response and Unison pull), `wind.js` (loudness, brightness and pitch against pressure, treadle envelopes), `speech.js` (how a reed speaks: onset time and shape, tone bloom, the tone shelf's position), `fan.js` (the spinning-fan wave), `output.js` (volume, cabinet bass corner, limiter make-up, soft clip), `autoplay.js` (meters, pattern editing and reshaping, which treadle is down at a given time). |
| `tests/*.spec.js` | Playwright tests that play the organ and measure its sound. See `tests/README.md`. |
| `tests/unit/` | Unit tests for `js/core` (`npm run test:unit`, no browser). |
| `scripts/check.mjs` | Static checks: page shape, referenced files, module syntax, imports resolve to real exports, element ids, allowed external hosts. |
| `scripts/serve.mjs` | A dependency-free static server for local play and tests (`npm run serve`). |
| `.github/workflows/check.yml` | Runs the checks, unit tests and browser tests on every PR and on `main`. |
| `package.json` | Development tooling only (Playwright). The site itself needs no install or build. |
| `docs/` | This file and the decision log. |

GitHub Pages serves the root of `main` directly; there is no build step. The
browser loads the modules natively, which needs HTTP: to play locally, run
`npm run serve` and open http://localhost:8080/ (opening the file directly
won't work).

## How the modules fit together

```mermaid
flowchart TB
  main["main.js<br/>(calls the setups in order)"] --> controls["controls.js"] & stops["stops.js"] & keys["keys.js"] & treadles["treadles.js"] & loop["wind-loop.js"]
  controls <--> audio["audio.js"]
  keys <--> audio
  stops --> keys & audio
  treadles --> audio
  keys --> treadles
  loop --> audio & treadles & controls
  subgraph base["Shared by every module"]
    state["state.js<br/>S, stops, voices, store"] --> core["core/*.js<br/>pure maths"]
  end
```

Some modules import each other in a loop (`audio` and `controls`, `audio` and
`keys`). That's safe because **modules do no work when they load**: they only
define constants and functions. All work happens in the setup functions, which
`main.js` calls in this order once every module has loaded:

1. `setupControls()`: binds sliders and selects, builds the voicing drawer, fills `ctl` and `mix`.
2. `setupStops()`: draws the stop rail.
3. `setupKeys()`: builds the keyboard and attaches pointer, computer-key and MIDI input.
4. `setupTreadles()`: builds the pedals and envelope controls.
5. `setupAutoplay()`: builds the pedal autoplay editor from the saved pattern.
6. `startWindLoop()`: draws the gauge and starts `frame()`.

Keep it that way. If a module needs something at load time, it may only use
`js/core` and `state.js`, which don't import anything else. The audio graph is
built later, on the first key, slider or pedal touch (`initAudio`), because
browsers only allow sound after the player interacts.

## Signal flow

```mermaid
flowchart LR
  subgraph Voice["Per key (voice)"]
    O1["5 oscillators<br/>one per rank"] --> SH["tone shelf per reed<br/>at 1.5 × its pitch"] --> E1["envelope gains<br/>g × on"]
    TD["tiltDb<br/>(wind tone, dB)"] --> SH
    WP["windPitch<br/>(cents)"] --> WR["per-reed gain<br/>v.winds[i]"] --> O1
  end
  E1 --> B["rank buses<br/>buses.bass[i] / buses.treble[i]"]
  B --> SW["swell lowpass<br/>(lid / sweep)"] --> BC["bassCut highpass<br/>(Cabinet bass)"] --> WG["wind gain"] --> TR["trem gain"]
  N["breath noise"] --> TR
  TR --> FIN
  subgraph FAN["Fan stage (Vox Humana)"]
    FIN["fanIn"] --> LP["fanLow lowpass<br/>(Blade size)"] --> SUM["fanOut"]
    FIN --> HB["upper band<br/>(in − low)"]
    LP -- "× −1" --> HB
    HB --> SH["shadow gain"] --> HP["hiPan"] --> SUM
    HB --> RF["refl delay"] --> RG["reflGain"] --> SH
  end
  SUM --> EQ["body EQ<br/>230 Hz, 1.1 kHz, 6 kHz shelf"] --> CAB["cabinet convolver<br/>dry / wet"] --> ROOM["room convolver<br/>dry / wet"] --> CMP["compressor"] --> OUT["master (Volume) → limiter → soft clip → speakers"]
```

Modulators (all audio-rate `AudioParam` connections):

- `lfo` (Vox Humana blade wave: sine, or a two-blade Fourier wave) → `lfoShadow` → `shadow.gain`; → `lfoAmp` → `trem.gain` (Whole-sound wobble); → `lfoFilt` → `swell.detune` (Lid wobble).
- `lfoPan` (cosine, started at the same instant as `lfo` so they stay phase-locked) → `lfoRefl` → `refl.delayTime`; → `lfoPanAmt` → `hiPan.pan`.
- `windPitch` (a `ConstantSource`, in cents) → each reed's own gain → that oscillator's `detune`.
- `tiltDb` (a `ConstantSource`, in dB) → every reed's tone shelf `gain`, added to the shelf's own onset automation (Tone bloom).

## Control loop

`frame()` runs on `requestAnimationFrame` and is the only place time-varying
physics is simulated:

1. Pedal autoplay (`stepAutoplay`): works out which treadle the pattern holds down now (`pedalsAt`) and calls `gateOn`/`gateOff` on changes. It does nothing until the audio context exists (the player's first touch). Then step both treadle ADSR envelopes (`stepEnvelope`).
2. Reservoir: `pressure += (inflow − drain) · dt / reservoirSize`. Inflow comes from the treadles (alternating feet fill better) and the helper pump. Drain (`windDrain`) grows with sounding reeds and the knee swell; with Easy wind it counts at most three reeds (D23). Pressure is clamped to 0–1, and the relief valve vents at 1.
3. Smooth the knee swell (`swellPos`) and the tone pressure (`tonePress`, Response time).
4. `applyWind()` pushes targets into the audio graph: wind gain (`windLevel`, with a knee at 2″), lid filter and `tiltDb` (depending on the tone model; each reed's own shelf applies the tilt, D17), `windPitch` offset (`windCents`: flat as the wind rises, D12), breath noise level.
5. Update the gauge, treadle visuals and readouts (readouts at 10 Hz).

Pressure is 0–1; the gauge shows `pressure × 3.6″`. The reference pressure `P_REF = 0.55` (about 2″) is where reeds are "in tune" and where tone and pitch offsets are zero.

## A voice

`noteOn(m)` creates one voice per key: five oscillators, one per rank, even if
the stop is off. Stops only change bus gains, so a stop drawn mid-chord comes in
immediately. Each oscillator gets:

- frequency `f × rank.mult`, using the rank's own `PeriodicWave` (`rankWave(i)`);
- `detune` from `keyTuning(f, m, half)`: each rank's `rankCents(i, f, m)` (Celeste beat or rank det, plus voicing tune, plus `reedError`), with drawn non-Celeste ranks inside the Unison pull range locked to their average (`lockReeds`, D14); the note starts Speech glide cents sharp and settles (D13);
- its own wind-response gain from `windPitch` (`reedWindResponse`, averaged across a locked group);
- a start time offset by part of its own cycle, so it starts at its own phase (locked reeds nearly together, D14);
- a high-shelf tone filter at 1.5 × its own frequency (`TILT_RATIO`). Its gain starts Tone bloom dB down and opens as the reed speaks, `BLOOM_LAG` × slower than the amplitude; `tiltDb` adds the wind's tilt (D17);
- two envelope gains, `g` (which also carries the release) and `on`, each rising with the same time constant, so the onset is (1 − e^(−t/τ))²: S-shaped, slower for lower reeds and lower wind (`speechTime`, `onsetTau` in `core/speech.js`, D16);
- routing to `buses[halfOf(m)][i]`.

`retune()` recomputes `keyTuning` for every sounding voice and updates all ranks' detune and wind gains; it runs on tuning, Celeste, scatter, Unison pull, Drift variation and new-reed changes, and from `applyStops()`, because drawing a stop can lock or unlock reeds. `rewind` is the same function.

Voices are reference-counted (`refs`). Input never calls `noteOn` directly: it
calls `press(m)` / `release(m)`, which add coupled octaves. `recouple()` updates
held keys when a coupler is drawn or retired.

## State and persistence

- **Stops** (`stops.bass[id]`, `stops.treble[id]`, `stops.vox`, `stops.sub`, `stops.sup`) are not saved; the organ always opens with Diapason and Melodia drawn.
- **Settings** are saved in `localStorage` under `reed-<key>` through `store.get` / `store.set`. Most use `bindSlider(id, key, default, format, onChange, map)` in `controls.js`: the input id ends in `Amt`, its `<output>` in `Out`, and `map` turns the slider position into the value the sound uses. Add the result to `ctl` so other modules can read `ctl.name.value`.
- **Saved choices** that aren't sliders (`S.splitMode`, `S.compass`, `S.easyWind`, `S.toneModel`, `S.voxShape`, `S.reedSeed`) are read once in `state.js`.
- **Reed set**: `S.reedSeed` feeds `reedRand(seed, i, m, salt)`, a hash used for each reed's tuning error and wind response.

## Where features live

| Feature | Files | Key names |
| --- | --- | --- |
| Ranks and waveforms | `core/ranks.js`, `audio.js` | `RANKS`, `WAVE_SPECS`, `waveRecipe`, `rankWave`, `loudnessComp`, `updateComp` |
| Rank voicing drawer | `controls.js`, `audio.js` | `ctl.voicing`, `rankLevel`, `rankCents`, `retune`, `revoice` |
| Individual reeds | `core/reeds.js`, `audio.js`, `controls.js` | `reedRand`, `reedTri`, `reedError`, `reedWindResponse`, `rewind`, `S.reedSeed` |
| Unison pull and start phase | `core/reeds.js`, `audio.js`, `controls.js` | `lockReeds`, `keyTuning`, `retune`, `ctl.pull` |
| Celeste | `core/ranks.js` | `celesteCents`, `ctl.beat` |
| Divided stops | `core/ranks.js`, `stops.js`, `state.js` | `SPLITS`, `S.splitMode`, `halfOf`, `renderStops` |
| Couplers | `keys.js` | `press`, `release`, `recouple`, `couplesFor` |
| Wind and treadles | `wind-loop.js`, `treadles.js`, `core/wind.js` | `frame`, `ped`, `stepEnvelope`, `gateOn`, `gateOff`, `windLevel`, `windBright`, `windCents`, `KNEE` |
| Wind tone | `audio.js`, `controls.js`, `core/speech.js` | `applyWind`, `S.toneModel`, `TONE_MODELS`, `tiltDb`, `TILT_RATIO`, `swell`, `S.tonePress` |
| Speech and Tone bloom | `core/speech.js`, `audio.js`, `controls.js` | `speechTime`, `windSpeech`, `onsetTau`, `BLOOM_LAG`, `ctl.speech`, `ctl.bloom` |
| Vox Humana | `audio.js`, `core/fan.js`, `controls.js` | `applyVox`, `setFanShape`, `fanWaveCoefficients`, `lfoFreq`, `fanLow`, `shadow`, `refl`, `hiPan` |
| Case and room | `audio.js` | `cabinetIR`, `impulse`, `applyMix`, `mix` |
| Easy wind | `core/wind.js`, `wind-loop.js`, `treadles.js`, `state.js` | `windDrain`, `EASY_REEDS`, `S.easyWind`, `#easyWind` |
| Pedal autoplay | `autoplay.js`, `core/autoplay.js`, `controls.js`, `wind-loop.js` | `stepAutoplay`, `setupAutoplay`, `retime`, `pedalsAt`, `noteAt`, `reshape`, `METERS`, `ctl.tempo`, store key `autoplay` |
| MIDI | `keys.js` | `connectMidi`, `onMidi` (notes, CC64 sustain, CC11/CC4 swell, CC120/123) |
| All notes off | `keys.js`, `audio.js` | `allNotesOff`, `silenceAll`, `#panicBtn`, Escape; computer keys tracked by `KeyboardEvent.code` (`CODEMAP`, `keyId`) |
| Compass | `keys.js`, `state.js` | `COMPASS`, `inCompass`, `couplesFor`, `S.compass` |
| Volume, limiter, cabinet bass | `audio.js`, `core/output.js`, `controls.js` | `applyOutput`, `master`, `MASTER`, `limiterMakeupDb`, `softClipCurve`, `bassCut`, `ctl.volume`, `ctl.bassCut` |
| Knee swell range | `audio.js` | `SWELL_CLOSED`, `SWELL_OPEN` |
