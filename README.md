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
| Steady wind | Raise the **Helper pump** slider. If you play more than it supplies, the wind slowly runs out |
| MIDI keyboard | Click **Connect MIDI keyboard**. Works in Chrome, Edge, Opera and Firefox. Responds to notes, the sustain pedal (CC64) and all-notes-off |

## What's in it

- **Five ranks of free reeds**: Bourdon 16′, Diapason 8′, Melodia 8′, Celeste 8′
  (tuned 7 cents sharp for a slow beat) and Principal 4′.
- **Vox Humana** fan tremolo with adjustable speed, and **Forte**, which opens the
  swell for a louder, brighter sound that uses more wind.
- **Treadle envelopes**: each foot has its own attack, decay, sustain and release
  for the airflow, from 5 ms up to 30 s.
- **Wind behaviour**: loudness rises up to about 2″ on the gauge and then levels
  off. Low wind sounds darker and flatter; high wind sounds brighter and slightly
  sharp, and the relief valve vents when the reservoir is full.
- **Cabinet** and **Room** reverb, and a **Treadle noise** level that can be
  turned off.

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
