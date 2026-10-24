// The ranks of reeds and the maths of their tone. Pure: no page, no audio.

export const RANKS = [
  { id: 'bourdon',   nm: 'Bourdon',   ft: '16′', mult: .5, wave: 'bass',   det: 0, level: .914 },
  { id: 'diapason',  nm: 'Diapason',  ft: '8′',  mult: 1,  wave: 'reed',   det: 0, level: 1 },
  { id: 'melodia',   nm: 'Melodia',   ft: '8′',  mult: 1,  wave: 'mellow', det: 0, level: .868 },
  { id: 'celeste',   nm: 'Celeste',   ft: '8′',  mult: 1,  wave: 'reed',   det: 0, level: .75, celeste: true },
  { id: 'principal', nm: 'Principal', ft: '4′',  mult: 2,  wave: 'thin',   det: 0, level: .5 },
];
export const CELESTE = RANKS.findIndex(r => r.celeste);
export const HALVES = ['bass', 'treble'];

// Divided stops: the first key of the treble half, and the captions.
export const SPLITS = {
  none: { note: 0, bass: '', treble: '' },
  ef: { note: 53, bass: 'Bass · up to E below middle C', treble: 'Treble · from F below middle C' },
  bc: { note: 60, bass: 'Bass · below middle C', treble: 'Treble · from middle C' },
};

export const noteFreq = m => 440 * Math.pow(2, (m - 69) / 12);

// Factory harmonic recipes: strength of even harmonics relative to odd, and how
// steeply the upper harmonics fall away (amplitude ∝ 1/k^exp). Even a mellow free
// reed keeps clear 2nd and 3rd harmonics (D15); `bass` is the Bourdon's big,
// buzzier reeds. Rank levels are set so each rank's loudness matches the
// earlier recipes.
export const WAVE_SPECS = {
  reed: { even: .55, exp: .85, n: 40 },
  mellow: { even: .4, exp: 1.25, n: 24 },
  bass: { even: .5, exp: 1.1, n: 40 },
  thin: { even: .7, exp: 1.15, n: 40 },
};
// The harmonic recipes before D15, kept so the tests can check loudness stayed put.
export const WAVE_SPECS_V1 = { mellow: { even: .3, exp: 1.9, n: 16 } };

// Brightness (−1…1) bends the harmonic rolloff: brighter keeps more of the upper harmonics.
export function waveRecipe(rank, bright) {
  const sp = WAVE_SPECS[rank.wave];
  return { amp: k => (k % 2 ? 1 : sp.even) / Math.pow(k, Math.max(.3, sp.exp - bright * .8)), n: bright > 0 ? 40 : sp.n };
}

// Loudness of a recipe after the browser scales its wave to a peak of 1
// (createPeriodicWave normalises), as RMS.
export function scaledRms({ amp, n }) {
  let peak = 0, pow = 0;
  for (let k = 1; k <= n; k++) pow += amp(k) * amp(k) / 2;
  for (let j = 0; j < 1024; j++) {
    let x = 0; const ph = 2 * Math.PI * j / 1024;
    for (let k = 1; k <= n; k++) x += amp(k) * Math.sin(k * ph);
    peak = Math.max(peak, Math.abs(x));
  }
  return Math.sqrt(pow) / peak;
}

// Gain that keeps a rank as loud as its factory voicing at any brightness (D4).
export const loudnessComp = (rank, bright) => scaledRms(waveRecipe(rank, 0)) / scaledRms(waveRecipe(rank, bright));

// Celeste offset in cents so it beats `beat` times a second against the unison, on any note (D3).
export const celesteCents = (beat, f) => 1200 * Math.log2(1 + beat / f);
