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
**Since D17:** the tilt is applied by a shelf on each reed at 1.5 × its own pitch rather than one shelf at 1.2 kHz, so it shifts every note's harmonics against its own fundamental.

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

## D12. Free reeds go flat as the wind rises

**Chosen:** the wind's pitch offset is `windCents(p, sens) = (P_REF − p) × sens`: flat above about 2″, sharp below. Pitch drift keeps its default (10 ¢ across the gauge) and each reed's own response (D7) still scales it.
**Why:** the original sign (sharp with more wind) is how flue pipes behave, not free reeds. A free reed blown harder swings wider and spends longer out of its slot, which lowers its frequency; at low wind it sits nearer its natural frequency. Measurements on accordion reeds under suction found the pitch falls almost linearly with blowing pressure, about −2.5 Hz/kPa on a C4 reed (about −16 ¢/kPa), twice that with a nearly closed pallet ([Forum Acusticum 2026](https://dael.euracoustics.org/confs/fa2026/data/articles/000418.pdf)). The gauge spans about 0.9 kPa, so the existing magnitude was already about right; only the direction was wrong.
**Measured** (Melodia A4, scatter off, Pitch drift 25 ¢, wind draining): 2.9″ −5.8 ¢, 2.3″ −2.7 ¢, 1.8″ +0.8 ¢, 1.3″ +4.4 ¢. Before: the same numbers with the opposite sign.
**Revisit if:** the owner prefers the old feel. Setting Pitch drift to 0 removes the drift entirely.

## D13. Notes start slightly sharp and settle (Speech glide)

**Chosen:** each note now starts `scoop` cents *sharp* and settles to pitch with the same time constant as before (40 ms × Speech speed). The slider is relabelled Speech glide and its default drops from 16 ¢ to 5 ¢. The id (`scoopAmt`) and storage key (`scoop`) are unchanged, so a player who had moved the slider keeps their amount, now glided from above.
**Why:** a reed speaks near its natural frequency while its swing is small, and sinks a little as the swing grows to full size (the same effect as D12). A scoop from below is a voice or brass gesture. The glide is small on a real reed, hence the lower default.
**Measured** (Melodia A4, in 25 ms steps from the first sound): 2.9 → 1.6 → 0.9 → 0.5 → 0.2 ¢ at the default. At 16 ¢ it is the mirror image of the old scoop (+9.8 ¢ start, before −9.9 ¢).

## D14. Unison pull, and reeds start at their own phase

**Chosen:** on each key, the drawn non-Celeste ranks (unisons and octaves) whose settled tunings lie within Unison pull (default 3 ¢) of each other lock: they share their average tuning and wind response, so they stay in step as the wind moves (`lockReeds` in `core/reeds.js`). The Celeste never locks. A group needs two drawn reeds; drawing or retiring a stop re-evaluates sounding notes. Each oscillator also starts at its own phase: locked reeds within ±0.1 cycle of each other, free reeds anywhere in their cycle.
**Why:** the owner finds slow beating unpleasant (D7), but with independent ±1 ¢ errors the opening stops, Diapason and Melodia, beat slowly on every key: periods from 2 s to minutes, median about 11 s, with the fundamental swinging up to 9.6 dB because Melodia is nearly all fundamental. Sources this close in pitch on a shared wind supply tend to pull into step; the effect is well documented for organ pipes (the *Mitnahme* effect), and a reed organ's reeds share a single chest. Locking gives that behaviour without new detunes. Every oscillator used to start at phase 0 at the same instant, so each stop combination had the same waveform on every note and every coupled octave started perfectly aligned; real reeds start wherever their swing happens to be. Locked reeds start nearly together so a lucky or unlucky start can't cancel their fundamentals.
**Measured** (default stops, helper 100%): level swing on a held A4 over 6 s, 8.4 dB before, 0.0 dB now (8.6 dB with Unison pull Off). Across the white keys C3–C6 held 4 s each: before, median 3.0 dB, worst 8.4 dB, 8 of 15 keys over 1 dB; now median 0.1 dB, worst 0.2 dB. Celeste with Diapason alone is unchanged (8.2 dB, before 8.7). With Diapason, Melodia and Celeste it is a steady 1.5 Hz shimmer of 4.4 dB instead of the shimmer plus a slow swell (11.7 dB). Twelve strikes of A4 vary by 1.0 dB (before 1.4 dB).
**Test change:** the Sub octave test now measures below 160 Hz (the coupled A2's fundamental) rather than below 400 Hz. With independent start phases the A2's 2nd harmonic can add to or partly cancel A3's fundamental, so the old 400 Hz measurement varied from about 1 to 4.5 dB; it had only passed reliably because both notes used to start perfectly aligned. Below 160 Hz the coupler adds about 23.6 dB.
**Guidance:** reeds on different keys still drift independently with the wind, so chords stay alive (D7). Unison pull at 0 restores free beating; Reed scatter above the pull range unlocks reeds naturally.
**Revisit if:** the owner wants some unison beating back, or the lock should depend on frequency in Hz rather than cents.

## D15. Melodia and Bourdon keep a reed's harmonics

**Chosen:** the Melodia's recipe is now even harmonics 0.4 of odd, rolloff 1/k^1.25, 24 harmonics (was 0.3, 1/k^1.9, 16). The Bourdon has its own `bass` recipe: 0.5, 1/k^1.1, 40 harmonics. Rank levels moved (Melodia 0.9 → 0.868, Bourdon 0.85 → 0.914) so each rank's loudness is unchanged.
**Why:** both ranks were almost pure sine waves, 97% of their power in the fundamental, which sounds like a flute or an electronic organ. A free reed always produces a harmonic-rich pulse; mellow reed stops get their softness from voicing and the reed cell, which round off the top but keep clear low harmonics. The Bourdon's big bass reeds are, if anything, buzzier.
**Measured** (each rank alone on A3, helper 100%): Melodia h2/h3 −17/−13 dB against the fundamental (before −24/−21); Bourdon −10/−8 dB (before −20/−17). Loudness against the Diapason: Melodia +4.6 dB (before +4.8), Bourdon +2.5 dB (before +2.2); the other ranks unchanged.
**Revisit if:** the owner wants a softer Melodia. Its Brightness slider in Rank voicing (level-matched, D4) can take it back towards the old tone.

## D16. Reeds speak S-shaped, low reeds slower

**Chosen:** each reed's onset is the product of two equal exponential rises, (1 − e^(−t/τ))², which starts with zero slope. Its 10–90% rise time is `speechTime(fr, p, speech)`: a fixed 20 ms plus about 14 cycles of the reed's own frequency, kept between 25 and 200 ms, scaled by the same wind factor as before (slower at low wind) and by Speech speed. An A3 reed at the reference wind takes about 84 ms, close to the old single time constant.
**Why:** the onset used one exponential approach for every note, so it started at full speed and took the same time from the bottom of the keyboard to the top. A free reed's swing grows from almost nothing, slowly and then quickly, until it saturates (free-reed simulations and measurements show exactly this exponential growth to a limit, [Forum Acusticum 2023](https://dael.euracoustics.org/confs/fa2023/data/articles/000853.pdf)). Big low reeds take roughly a fixed number of cycles to build up, so they speak noticeably more slowly.
**Measured** (Diapason alone, helper 100%, 10–90% rise): C2 162 ms, A3 61 ms, A5 25 ms, C7 19 ms; before, about 53 ms on every note. Level 10 ms after the start: C2 6%, A3 13%, A5 45%, C7 61% (before about 33% on A3 and above).

## D17. Brightness follows each reed's swing, and the wind tilts each reed's own harmonics

**Chosen:** every reed has its own high-shelf filter at 1.5 × its frequency, between its fundamental and 2nd harmonic. The shelf's gain starts Tone bloom dB down (new slider, default 18 dB) and opens to 0 a little behind the amplitude (time constant 1.3 × the onset's). The wind's tilt (Natural tilt, D6) now feeds the same shelves through one shared source (`tiltDb`) instead of a single high shelf at 1.2 kHz after the rank buses, which is removed. The tilt in dB is unchanged.
**Why:** a reed swinging gently moves almost sinusoidally; the upper harmonics appear as the swing grows ([Forum Acusticum 2023](https://dael.euracoustics.org/confs/fa2023/data/articles/000853.pdf)). Notes used to start at full colour. And a shelf at a fixed 1.2 kHz didn't tilt each note's harmonics against its fundamental, as D6 intended: for low notes it only reached the 6th harmonic and up, and for treble notes it moved the fundamental itself, so the wind changed their loudness rather than their tone.
**Measured** (Diapason alone, helper 100%): h2–h4 against the fundamental in 25 ms steps from the start of A3: −17.6, −11.7, −8.6, −7.1, −6.6 dB, settling at −6.2 dB (before flat at about −7 dB). Wind tone Depth 0 → 150 at full wind: A3 fundamental +0.6 dB and h2–h4 +3.0 dB (before 0.0 and +0.3 dB: the tilt barely touched A3's low harmonics); C6 fundamental +0.6 dB (before +1.2 dB). On a draining A4 at the default Depth, the spectral centroid falls 12% from 2.9″ to 1.3″ (before 10%). At the reference wind the tilt is 0 dB, so the settled tone there is as before; at full wind, low and middle notes are slightly brighter than before because the tilt now reaches their low harmonics.
**Revisit if:** the owner finds the onset darkening too obvious (lower Tone bloom) or the full-wind brightness too strong (lower Wind tone Depth).

## D18. All notes off, and no more stuck computer keys

**Chosen:** an **All notes off** button beside Connect MIDI keyboard, and the Escape key, silence every voice and forget every way a note was held: computer keys, pointers, MIDI keys, notes held by the sustain pedal, and couplers (`allNotesOff` in `keys.js`, `silenceAll` in `audio.js`). MIDI all-notes-off (CC123/CC120) does the same. Computer keys are now tracked by physical key (`KeyboardEvent.code`) rather than the character typed. Letting go of Command releases every computer key, and so does the page being hidden. Mouse presses other than the main button are ignored, a lost pointer capture releases its note, and the right-click menu is suppressed on the keys.
**Why:** the owner reported stuck keys. Two causes were certain from the code: (1) notes were tracked by `e.key`, so holding `2`, `3`, `5`, `6`, `7`, `9`, `0`, `[`, `=` or `]` and then pressing Shift made the key-up arrive as `@`, `#`, `{`… and the note never stopped; (2) a Mac sends no key-up for keys released while Command is held. A right-click or a lost pointer capture could also strand a note. A panic button covers anything else, such as a MIDI keyboard that drops a note-off.
**Tested:** Shift and Command cases, a sustained MIDI note plus held computer keys cleared by the button and by Escape, and normal playing afterwards. The Shift/Command test fails with the old key tracking.

## D19. Cabinet bass roll-off, and an optional reed-organ compass

**Chosen:** a gentle highpass (2nd-order Butterworth) on the reeds before the wind gain, at **Cabinet bass** (default 80 Hz; 20–200 Hz; bottom of the slider is Off). A **Keyboard compass** setting chooses Full range (A0–C8, the default, as before) or Reed organ (61 keys, F1–F6); with Reed organ, MIDI notes and coupled notes outside the compass are silent, as on a real organ where a coupler past the end of the keyboard has nothing to pull.
**Why:** a parlor cabinet radiates very little below about 80–100 Hz, so a real reed organ's bass is reedy and its pitch comes largely from the harmonics; the Bourdon at the bottom of the keyboard used to produce a strong 32–65 Hz fundamental like a subwoofer. The owner wants to keep playing notes no real organ had, so Full range stays the default and Cabinet bass can be turned Off.
**Measured** (Bourdon alone): on C3 (sounding C2, 65 Hz) the level drops 3.5 dB with the default setting, and the share of sound below 100 Hz goes from −1.2 to −3.4 dB; on A3 (sounding A2, 110 Hz) it changes by 0.2 dB. Filter response: −15.9 dB at 32 Hz, −5.1 dB at 65 Hz, −0.6 dB at 130 Hz.
**Note:** Web Audio's lowpass and highpass Q is in decibels, so a flat (Butterworth) response is Q = −3.01, not 0.707; 0.707 gives a small bump above the corner.

## D20. Volume, a limiter and a soft ceiling

**Chosen:** a **Volume** slider (0–150%, squared, so 50% is −12 dB and 150% is +7 dB; 100% is the level before), applied after the existing compressor. After it, a limiter (threshold −4 dB, ratio 20, 2 ms attack) and a soft clip that is unity below ±0.9 and never reaches full scale. The treadle thump now goes through the volume too. The existing compressor is unchanged.
**Why:** the owner asked for a volume control. Measured on `main`, the compressor never took off more than about 1 dB, so it wasn't squashing the dynamics; the real issue was headroom: a 6-note chord with the swell open already peaked at −1.9 dBFS and full organ at −2.6 dBFS, so any volume increase would clip. Chromium's `DynamicsCompressorNode` adds automatic make-up gain (0.6 × the gain it would remove at full scale; +2.28 dB for these settings), which made everything louder in the first measurements; the master gain trims it back out (`limiterMakeupDb`). The compressor isn't a brickwall, so transients could still overshoot to 1.03 (+0.25 dB); the soft clip rounds those off.
**Measured:** below the limit the level is unchanged. Volume 150% with the swell open: 6-note chord peaks −0.4 dBFS, full organ −0.5 dBFS (without the limiter, +7 dB on the −2.5 dBFS peaks measured at 100% would reach about +4.5 dBFS). At the default volume the limiter takes about 1 dB off the loudest open-swell chords and nothing off ordinary playing.

## D21. A wider knee swell

**Chosen:** the knee swell's level goes from 0.75 (closed) to 1.5 (open), on top of the brighter lid; before it was 1.0 to 1.25.
**Why:** closed to open was only about 2.6 dB on one note and 1.1 dB on a chord (the compressor ate most of it), small for a swell lid that covers the reed cells. Raising only the open end would have pushed big open chords into the limiter, so the closed end comes down a little and the open end goes up a little.
**Measured:** one note closed → open: 5.9 dB (before 2.6 dB); 6-note chord: 5.5 dB (before 1.1 dB). Against `main`, the default (closed) sound is about 2.2 dB quieter and fully open about 1.1 dB louder. Volume can make up the difference.

## D22. Pedal autoplay, on by default; helper pump 2%

**Chosen:** a looping treadle pattern that presses and lifts the pedals through the same `gateOn`/`gateOff` as the player's feet, so each stroke uses that foot's envelope, the alternating-feet bonus, the hinge thump and the pedal animation. The pattern is a grid with one cell per beat of the meter (2/4, 3/4, 4/4, 5/4, 6/8; tempo counts the beat unit, so eighths in 6/8), 1 to 4 measures, 30 to 200 bpm. Each cell is Left, Right, Rest or Tie (holds the stroke before it; a tie at the start holds the loop's last stroke). A foot lifts a quarter of a beat (at most 120 ms) before its stroke ends, so repeated strokes on one foot stay separate. Autoplay starts with the audio, on the player's first touch, because browsers allow no sound before that. The owner's defaults: on, one bar of 4/4 at 100 bpm, right and left quarter notes on beats 1 and 2, a half-note rest; helper pump 2% (was 0%). The pattern and on/off are saved under `reed-autoplay`, the tempo under `reed-autoTempo`.
**Why:** the owner asked for it, with these defaults. Driving the existing gates rather than adding a separate air source keeps everything the treadles already do, and lets the player's own feet join in. With autoplay on, the "Helper can't keep up" message is suppressed, because the gaps between strokes would make it flicker on every beat.
**Measured** (wind gauge with default settings and stops, 24 s held, mean and range over the last 12 s): one note 3.5″ (3.3–3.6″); three-note chord 2.1″ (1.8–2.5″), so the strokes ripple the wind by about 0.7″; six-note chord 0.3″ (0.0–0.7″), running out of wind. With Right, Left, Right, Left at 120 bpm: three-note chord 3.6″, six-note chord 2.9″ (2.7–3.0″). With autoplay off and the helper at 2%, a three-note chord is out of wind within 5 s.
**Tests changed:** the shared quiet setup in `tests/organ.js` turns autoplay off, so the steady-wind measurements stay steady.
**Revisit if:** the owner wants eighth-note subdivisions, more than 4 measures (the grid already wraps by measure on narrow screens), or autoplay to stop while the player pumps by hand.
