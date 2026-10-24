# Decisions

Why the organ works the way it does. Read this before changing the sound or the
project setup. Each entry says what was chosen, why, and what would count as a
reason to revisit it. Newest last. Add an entry with every PR that makes a
design choice.

## Owner's preferences

These come from the owner's own feedback and apply to every change:

- **Natural over exaggerated.** The goal is how a real parlor reed organ sounds and feels. When an effect "seems off", look for how the real mechanism works before tuning numbers.
- **Slow, regular beating is unpleasant.** Beats below about 1 Hz that repeat on every note feel queasy to the owner. Accidental detuning must stay tiny and uncorrelated (see D7).
- **Equal temperament is fine.** Don't change the temperament without being asked.
- **Defaults keep the current sound.** New controls start at a setting that sounds like before, unless the change is a fix the owner asked for. Then the PR says so, and says how to get the old sound back.
- **The owner only reviews and merges PRs.** PR descriptions are the main communication: what the player hears, measurements, and what to try.

## D1. Static files, no build, Pages from the branch

**Chosen:** the instrument ships as static files served by GitHub Pages straight from the root of `main` ("Deploy from a branch"), with `.nojekyll`. There's no build step and nothing to install.
**Why:** the owner set Pages to branch deploy. An Actions-based deploy would need a settings change on their side and one more thing to fail. The first Actions workflow failed and was removed in PR #2.
**Revisit if:** the project needs a bundler or generated assets.

## D2. Loudness levels off above 2″

**Chosen:** `windLevel(p)` rises as `p^1.2` up to `KNEE` (2″ on the gauge), then a tanh soft-knee allows only about +1.4 dB more. Brightness above the knee rises at half rate.
**Why:** the owner found the top of the reservoir too loud. On a real organ, the reservoir spring and relief valve cap the pressure, and harder blowing mostly adds buzz rather than volume.

## D3. Celeste beats at a constant rate

**Chosen:** the Celeste's offset is computed per note so it beats at `beatS` beats per second on every key (`celesteCents`), rather than at a fixed number of cents.
**Why:** a fixed cent offset beats slowly in the bass and fast in the treble. Real celestes are regulated toward an even beat.

## D4. Brightness is level-matched

**Chosen:** `rankWave` changes the harmonic rolloff, and `loudComp` rescales the rank's bus gain so its RMS stays constant.
**Why:** `createPeriodicWave` normalizes every wave to the same peak, so a brighter (spikier) wave came out up to 10 dB quieter. After the fix, ±100 brightness stays within 3 dB. The small remaining dip at +100 is the lid filter trimming added top end. (PR #4)

## D5. Couplers pull down keys

**Chosen:** Sub and Super Octave couplers work through `press`/`release`. A coupled note sounds with the stops of its own half (with divided stops), shows as a pressed key, and uses wind like any reed. Toggling a coupler updates held chords (`recouple`).
**Why:** that's what the mechanical coupler does, and it makes divided stops and couplers interact correctly. (PR #4)

## D6. Wind changes the tone by tilting, not sweeping

**Chosen:** default tone model `tilt`. The lid lowpass stays still (only the knee swell moves it), and a high shelf at 1.2 kHz, whose gain follows a smoothed wind pressure (Response, default 250 ms), tilts the harmonics. The original moving lowpass is kept as `sweep`. Depth 100% with a 20 ms response reproduces it.
**Why:** the owner heard a "wah". The sweep moved a lowpass edge from 3.4 kHz down to 450 Hz, below most notes' second harmonic. A real free reed's spectrum only tilts with pressure. Measured on a draining held A4: the sweep lost 42% of its spectral centroid, mostly below 1.5″, while the tilt at 60% loses about half that, spread evenly. Ripple from steady pumping was only about 1% in every model, so big pressure swings were the cause. (PR #5)

## D7. Each reed has its own tuning error and wind response

**Chosen:** every reed (rank × key) gets an uncorrelated, triangular-distributed tuning error (`reedScatter`, default ±1 cent) and its own sensitivity to the wind's pitch drift (`reedWindResp`, larger for low reeds; Drift variation default 40%). All values come from a hash of rank, key and a saved seed. There are no fixed per-rank detunes.
**Why:** the owner felt ill from slow, regular beats. The cause was (a) Melodia tuned −2 cents against Diapason on every key, giving steady 1.4–11 s beats with the default stops, and (b) a "random" per-key offset from a linear congruential step, which was really a sawtooth. Neighbouring keys were 74% correlated, and nearly every octave was out by about 1.5 cents. Now offsets are uncorrelated, beat periods vary from key to key (some keys have none), and they keep shifting with the wind. Real reeds are tuned at one pressure and each departs from it differently.
**Guidance:** what matters is the beat *rate*, not cents. Accidental detuning should give either effectively no beat, or be deliberate and in the shimmer range (about 2–8 Hz). Making notes "closer" only makes beats slower. (PR #7)

## D8. The Vox Humana is a fan in the sound path

**Chosen:** the fan stage splits the signal at Blade size (default 1.5 kHz) into a low band, which passes untouched, and a complementary upper band (input minus low band, so the two sum exactly). Only the upper band gets the blade shadow (gain dips), shimmer (a reflection with a moving 0.1–0.4 ms delay) and stereo sweep. The earlier whole-signal tremolo is kept as Whole-sound wobble and Lid wobble, off by default and stored under new keys.
**Why:** the owner found the old tremolo too extreme, pulsing everything. On American reed organs the Vox Humana is a fan "made to revolve rapidly by wind pressure" that "disturbs the air near the reeds" ([1911 Britannica](https://en.wikisource.org/wiki/1911_Encyclop%C3%A6dia_Britannica/Harmonium)), unlike valve tremolos that pulse the wind supply ([US 160,605](https://patents.google.com/patent/US160605)). It's driven by its own wind wheel ([US 121,609](https://patents.google.com/patent/US121609A/en)). A few-centimetre blade only shadows or reflects wavelengths about its size, so roughly 1 kHz and up. That last step is physics reasoning, not from the sources.
**Measured** (held A3): bass pulse went from 3.8 dB to 0.1 dB, overall loudness pulse from 3.8 dB to 0.2 dB, and treble flicker from 5.4 dB to 5.9 dB. Stereo sweep at 100% swings the treble 24 dB while the bass stays centred. (PR #8)

## D9. Measure the sound, don't just listen in your head

**Chosen:** sound changes are checked by measuring the rendered audio in headless Chromium: band levels, spectral centroid, envelope depth, stereo balance. Results go in the PR.
**Why:** the measurements caught real problems that reading the code didn't, such as the 10 dB brightness/volume coupling (D4) and the wah's real cause (D6).

## D10. Black-box tests in a real browser

**Chosen:** Playwright tests (`tests/`) that use the organ only through its controls, readouts and speaker output, run in CI on every PR. Sound properties from this log are asserted with tolerances. For example, the Vox Humana bass pulse must be under 0.6 dB with treble flicker of 3–9 dB, Level 50% must equal −6 dB, and Brightness ±100 must stay within 3.5 dB of volume.
**Why:** the measurement scripts used to live only in a session's scratch space and were lost when it ended. Black-box tests also survive refactors: the same tests check that restructuring the code changes nothing. Each test was confirmed to catch a deliberately planted bug, and the timing-sensitive tests passed 3 out of 3 repeated runs.
**Revisit if:** CI time grows past a few minutes, or a sound test proves flaky. Widen the tolerance or measure longer before deleting it.

## D11. Native ES modules, pure maths in `js/core`

**Chosen:** the single 1,300-line `index.html` was split into `css/organ.css` and twelve modules under `js/`, loaded by the browser as native ES modules, still with no build step (D1). Pure maths lives in `js/core/` with explicit inputs (seed, spread, brightness…) and no page or audio access, and has unit tests (`tests/unit`). Modules do no work at load time; `main.js` calls each module's setup in a fixed order.
**Why:** each session had to read and exact-match-edit one huge file, and the maths couldn't be tested without pulling functions out of the HTML. A bundler would have needed either committed build output or Actions-based Pages, against D1. The cost is that the page needs HTTP to run locally (`npm run serve`); the owner agreed to that.
**Verified:** all 34 browser tests passed unchanged before and after the split. A side-by-side measurement of the old and new page gave the same Vox Humana, stereo and brightness figures within measurement noise (≤0.2 dB). The unit tests reject the old sawtooth reed generator (D7). `scripts/check.mjs` checks that every import names a real export and every element lookup exists, and it caught each of three planted mistakes.
**Rule:** because `audio.js` and `controls.js` (and `audio.js` and `keys.js`) import each other, nothing may run at module load except definitions that use only `js/core` and `state.js`.
