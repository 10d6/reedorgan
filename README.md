# Parlor Reed Organ

A playable, foot-pumped reed organ that runs in a web browser. The wind supply is
simulated: the treadles fill a reservoir, playing drains it, and the pressure
changes the organ's loudness, brightness, pitch and how quickly notes speak.

**Play it:** https://paperclipsoftware.github.io/reedorgan/

## Playing

| What | How |
| --- | --- |
| Play notes | Click or touch the keys, or use the computer keyboard: `Z`–`M` for the low octave, `Q`–`U` and up for the middle |
| Pump | **Pedal autoplay** pumps for you from the first note (on by default). Or hold the Left and Right treadles, or hold `←` `→` (alternating fills fastest). `Space` pumps the next foot |
| Steady wind | Tick **Easy wind** (in Treadles) so chords and extra stops use no more air than three notes. Or speed up or busy the autoplay rhythm, or raise **Helper pump** under Adjustments (2% by default). If you play more than the wind supplies, it slowly runs out |
| Swell | Move the **Knee swell** slider, or use a MIDI expression pedal (CC11 or CC4) |
| Volume | The **Volume** slider. Above 100% a limiter keeps loud chords clean |
| Direct wind | Tick **Direct wind** (top right) and its slider sets the air in the reservoir by itself; treadles, autoplay and playing no longer change it. Your MIDI keyboard's volume knob (CC7) or a breath controller (CC2) moves it; **Learn** binds any other knob. With Direct wind off, the volume knob sets Volume |
| Stuck note | **All notes off** (top right), or `Esc` |
| Explanations | Tap the small **i** beside any heading to show or hide what its controls do |
| MIDI keyboard | Click **Connect MIDI** (top right; it glows orange until a keyboard is listening). Works in Chrome, Edge, Opera and Firefox. Responds to notes, the pitch wheel, the mod wheel (CC1, sets Scoop), the sustain pedal (CC64), expression (CC11/CC4), volume (CC7), breath (CC2) and all-notes-off |

## What's in it

- **Five ranks of free reeds**: Bourdon 16′, Diapason 8′, Melodia 8′, Celeste 8′
  and Principal 4′. Even the mellow Melodia and the deep Bourdon keep a reed's
  buzz in their 2nd and 3rd harmonics. The Celeste is tuned to beat at the same
  rate on every note.
- **Reeds that speak**: each note's onset swells in S-shaped, the way a reed's
  swing grows. Low reeds take longer to get going than high ones (about 160 ms
  at the bottom, 20 ms at the top), and low wind slows them all. Each note
  starts nearly a pure tone and its buzz fills in as it speaks (*Tone bloom*).
- **Divided stops**: optionally split every rank into bass and treble halves, at
  E | F below middle C (the traditional American split) or at middle C.
- **Octave couplers**: Sub Octave and Super Octave pull down the keys an octave
  below or above, so each coupled note sounds with the stops drawn in its own
  half. Drawing one while holding a chord brings the octave in straight away.
- **Vox Humana** fan. As on a real reed organ, the fan stirs the sound just
  outside the reeds, so it only affects the upper harmonics: *Blade shadow*
  (flicker as blades pass), *Shimmer* (phasing from reflections off the moving
  blades) and *Stereo sweep*, all above a frequency set by *Blade size*. The
  fundamentals, and so the overall loudness, stay steady. Its controls fold
  away under the stops and open when you draw the stop. *Smooth* or *Spinning
  fan* shape; the fan spins up when the stop is drawn and coasts down when it's
  retired. The earlier whole-sound tremolo is still there as *Whole-sound
  wobble* and *Lid wobble*, off by default.
- A continuous **knee swell** that opens the lid gradually for a louder
  (about 6 dB), brighter sound that uses more wind.
- **Cabinet bass**: the case can't radiate the deepest notes, so the bass is
  reedy rather than booming. Turn it down or Off for a deeper bass.
- **Keyboard compass**: Full range (every MIDI note, A0 to C8) or a real reed
  organ's 61 keys, F to F, where couplers fall silent past the ends.
- **Pedal autoplay**: works the treadles in a looping rhythm you set: 1 to 4
  measures in 2/4, 3/4, 4/4, 5/4 or 6/8, a tempo from 30 to 200 bpm, and each
  beat a Left or Right stroke, a rest, or a tie that holds the stroke longer.
  The default is one bar of 4/4 at 100 bpm: right, left, half-note rest. That
  carries a melody or a three-note chord; fuller playing needs a busier rhythm.
- **Easy wind**: the bellows charge for no more than three notes on one stop,
  so full chords and stop changes don't need harder pumping. The sound is the
  same; off by default.
- **Treadle envelopes**: each foot has its own attack, decay, sustain and release
  for the airflow, from 5 ms up to 30 s.
- **Wind behaviour**: loudness rises up to about 2″ on the gauge and then levels
  off. Low wind sounds darker and creeps sharp; high wind sounds brighter and
  sinks slightly flat, as free reeds do, and the relief valve vents when the
  reservoir is full.
- **Adjustments**: reservoir size, pitch drift with pressure, reed speech
  speed, speech glide (notes start a touch sharp and settle), Celeste beat
  rate, Cabinet and Room reverb, breath noise level and treadle noise level.
- **Individual reeds**: every reed (each rank on each key) has its own small,
  random tuning error (*Reed scatter*) and its own response to the wind (*Drift
  variation*, larger for low reeds). Beats between keys differ and shift as the
  wind moves, so no pattern settles in. *Fit a new set of reeds* draws a fresh
  set.
- **Unison pull**: reeds on the same key that sound in unison or octaves, and
  are tuned within a few cents of each other, pull into step and sound as one
  instead of beating slowly, as reeds sharing one wind chest tend to. The
  Celeste never locks. Each reed also starts at its own point in its swing.
- **Wind tone**: how the wind colours the sound. *Natural tilt* (the default)
  shifts the balance of upper harmonics against the fundamental, as a real reed
  does, measured from each reed's own pitch so it works the same on every note; *Filter sweep* is the original moving lowpass. Depth, resonance (Q) and
  response time are adjustable.
- **Expression** (off by default): playing gestures from singing, horns and
  blues harmonica rather than from the reed organ itself. *Scoop* starts a note
  up to a whole tone below and slides up into it, landing exactly in tune at
  the end of *Scoop time*; every reed on the key, and its coupled octaves,
  bends together. By default only the top voice scoops, so a melody bends over
  a steady chord; or only on leaps up, every note, or by MIDI velocity. *Ease
  in* or *S-curve* shapes. The MIDI pitch wheel bends everything by up to
  *Bend range*, and the mod wheel sets Scoop.
- **Rank voicing**: a drawer under Adjustments with level, fine tuning (±20
  cents) and brightness for each rank, plus a button to restore the factory
  voicing. Brightness reshapes the rank's harmonics and is level-matched, so it
  changes the tone rather than the volume.

Settings are remembered in your browser.

## How the repository works

The instrument is plain HTML, CSS and JavaScript modules, with no build step
and no dependencies. To play it locally, run `npm run serve` (or `node
scripts/serve.mjs`) and open http://localhost:8080/. Browsers won't load the
modules from a file opened directly.

- Every pull request runs `node scripts/check.mjs` (the page and modules are
  consistent: files exist, code parses, imports match exports, element ids exist,
  nothing loads from outside Google Fonts), unit tests for the sound maths
  (`npm run test:unit`), and browser tests that play the organ and measure its
  sound (`npm ci && npx playwright test`).
- Merging to `main` publishes the page automatically. GitHub Pages serves the
  repository root of `main` directly (Settings → Pages → Deploy from a branch);
  `.nojekyll` tells it to serve the files as they are.
- `docs/architecture.md` explains how the instrument is built, and
  `docs/decisions.md` records why it sounds the way it does.
