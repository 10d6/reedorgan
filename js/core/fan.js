// The Vox Humana's Spinning fan shape (D8). Pure: no page, no audio.
//
// One full turn of a two-bladed fan: a dip as each blade passes, the second
// blade a little smaller and wider, giving a slight lilt. Returned as Fourier
// coefficients for createPeriodicWave (with normalisation off), scaled so the
// deepest dip is −1 and the mean is 0.
export function fanWaveCoefficients(harmonics = 24) {
  const N = 512, H = harmonics, x = new Float32Array(N);
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  for (let j = 0; j < N; j++) {
    const ph = 2 * Math.PI * j / N;
    x[j] = -(Math.exp(-Math.pow(wrap(ph) / .5, 2)) + .8 * Math.exp(-Math.pow(wrap(ph - Math.PI) / .6, 2)));
  }
  const mean = x.reduce((a, b) => a + b) / N; let peak = 0;
  for (let j = 0; j < N; j++) { x[j] -= mean; peak = Math.max(peak, Math.abs(x[j])); }
  const re = new Float32Array(H + 1), im = new Float32Array(H + 1);
  for (let k = 1; k <= H; k++) {
    let c = 0, sn = 0;
    for (let j = 0; j < N; j++) { const ph = 2 * Math.PI * k * j / N; c += x[j] * Math.cos(ph); sn += x[j] * Math.sin(ph); }
    re[k] = 2 * c / N / peak; im[k] = 2 * sn / N / peak;
  }
  return { re, im };
}
