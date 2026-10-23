# Parlor Reed Organ

A playable, foot-pumped reed organ that runs in a web browser. The wind supply is
simulated: the treadles fill a reservoir, playing drains it, and the pressure
changes the organ's loudness, brightness, pitch and how quickly notes speak.

**Play it:** https://paperclipsoftware.github.io/reedorgan/

## Playing

| What | How |
| --- | --- |
| Play notes | Click or touch the keys, or use the computer keyboard: `Z`–`M` for the low octave, `Q`–`U` and up for the middle |
| Pump | Hold the Left and Right treadles, or hold `←` `→` (alternating fills fastest). `Space` pumps the next foot |
| Steady wind | Raise **Helper pump** under Adjustments. If you play more than it supplies, the wind slowly runs out |
| Swell | Move the **Knee swell** slider, or use a MIDI expression pedal (CC11 or CC4) |
| MIDI keyboard | Click **Connect MIDI keyboard**. Works in Chrome, Edge, Opera and Firefox. Responds to notes, the sustain pedal (CC64), expression (CC11/CC4) and all-notes-off |

## What's in it

- **Five ranks of free reeds**: Bourdon 16′, Diapason 8′, Melodia 8′, Celeste 8′
  and Principal 4′. The Celeste is tuned to beat at the same rate on every note.
- **Divided stops**: optionally split every rank into bass and treble halves, at
  E | F below middle C (the traditional American split) or at middle C.
- **Octave couplers**: Sub Octave and Super Octave pull down the keys an octave
  below or above, so each coupled note sounds with the stops drawn in its own
  half. Drawing one while holding a chord brings the octave in straight away.
- **Vox Humana** fan tremolo. Speed, volume wobble, tone wobble and stereo sweep
  are adjustable, with a *Smooth* or *Spinning fan* shape (brief dips as two
  slightly mismatched blades pass). The fan spins up when the stop is drawn and
  coasts down when it's retired.
- A continuous **knee swell** that opens the lid gradually for a louder,
  brighter sound that uses more wind.
- **Treadle envelopes**: each foot has its own attack, decay, sustain and release
  for the airflow, from 5 ms up to 30 s.
- **Wind behaviour**: loudness rises up to about 2″ on the gauge and then levels
  off. Low wind sounds darker and flatter; high wind sounds brighter and slightly
  sharp, and the relief valve vents when the reservoir is full.
- **Adjustments**: reservoir size, pitch drift with pressure, reed speech
  speed, pitch scoop, Celeste beat rate, Cabinet and Room reverb, breath noise
  level and treadle noise level.
- **Wind tone**: how the wind colours the sound. *Natural tilt* (the default)
  shifts the balance of upper harmonics against the fundamental, as a real reed
  does; *Filter sweep* is the original moving lowpass. Depth, resonance (Q) and
  response time are adjustable.
- **Rank voicing**: a drawer under Adjustments with level, fine tuning (±20
  cents) and brightness for each rank, plus a button to restore the factory
  voicing. Brightness reshapes the rank's harmonics and is level-matched, so it
  changes the tone rather than the volume.

Settings are remembered in your browser.

## How the repository works

The whole instrument is one file, `index.html`, with no build step and no
dependencies. Open it in a browser to run it locally.

- Every pull request runs `node scripts/check.mjs`, which confirms the page is a
  complete document, the script parses, element ids match, and nothing loads from
  outside Google Fonts.
- Merging to `main` publishes the page automatically. GitHub Pages serves the
  repository root of `main` directly (Settings → Pages → Deploy from a branch);
  `.nojekyll` tells it to serve the files as they are.
