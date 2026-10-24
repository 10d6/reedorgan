// Every slider and setting the player can change, and where it is saved.
// setupControls() binds them to the page; the sound reads them through `ctl`.

import { RANKS } from './core/ranks.js';
import { HELPER_MAX } from './core/wind.js';
import { S, store } from './state.js';
import { initAudio, applyStops, applyVox, applyMix, setFanShape, retune, rewind, revoice, updateComp, ctx } from './audio.js';

// Filled in by setupControls(). Each slider is {el, value, set(v)}; `value` is
// already mapped to what the sound uses (see bindSlider).
export const ctl = {};
// Cabinet, room and treadle-noise levels in percent.
export const mix = { cab: store.get('cab', 45), room: store.get('room', 30), thump: store.get('thump', 60) };

/* Sliders that save themselves: fmt turns the slider value into its readout,
   map turns it into the value the sound uses. The input id ends in Amt and its
   <output> in Out. */
export function bindSlider(id, key, def, fmt, onChange, map = v => v) {
  const el = document.getElementById(id), out = document.getElementById(id.replace('Amt', 'Out'));
  const s = { el, value: map(def) };
  const show = () => { s.value = map(+el.value); out.textContent = fmt(+el.value, s.value); };
  s.set = (v, save = true) => { el.value = v; show(); if (save) store.set(key, +el.value); if (onChange) onChange(s.value); };
  el.value = store.get(key, def); show();
  el.addEventListener('input', () => { initAudio(); show(); store.set(key, +el.value); if (onChange) onChange(s.value); });
  return s;
}
export const logMap = (lo, hi) => v => lo * Math.pow(hi / lo, v / 100);
const fmtX = (_, x) => x.toFixed(x < .95 ? 2 : 1) + '×';
const fmtHz = f => f >= 1000 ? (f / 1000).toFixed(1) + ' kHz' : Math.round(f / 10) * 10 + ' Hz';
const signed = (v, d = 0) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
const cap = s => s[0].toUpperCase() + s.slice(1);

const TONE_MODELS = {
  tilt: 'Upper harmonics grow and fade against the fundamental as the wind changes, the way a reed responds to pressure. The filter edge stays put, so there is no wah.',
  sweep: 'A lowpass filter whose cutoff follows the wind. Dramatic, and at high depth or resonance it sounds like a wah.',
};
const VOX_SHAPES = {
  sine: 'A smooth, even sway. The fan turns only while the stop is drawn, takes a moment to spin up and coasts to a stop.',
  fan: 'Two blades sweep past the reed cells, so the upper harmonics dip briefly with each pass instead of swaying evenly. The blades aren’t quite matched, which gives a slight lilt.',
};

export function setupControls() {
  const $ = id => document.getElementById(id);

  /* ---- swell and wind ---- */
  ctl.swell = bindSlider('swellAmt', 'swell', 0, v => v === 0 ? 'Closed' : v === 100 ? 'Full' : v + '%', null, v => v / 100);
  ctl.res = bindSlider('resAmt', 'reservoir', 45, fmtX, null, logMap(.4, 3));
  ctl.sens = bindSlider('sensAmt', 'sensitivity', 10, v => v + ' ¢');
  ctl.driftVar = bindSlider('driftVarAmt', 'driftVariation', 40, v => v === 0 ? 'None' : v + '%', () => rewind(), v => v / 100);

  /* ---- wind tone ---- */
  const toneModelEl = $('toneModel'), toneModelSub = $('toneModelSub');
  toneModelEl.value = S.toneModel; toneModelSub.textContent = TONE_MODELS[S.toneModel];
  toneModelEl.addEventListener('change', () => {
    S.toneModel = toneModelEl.value; store.set('toneModel', S.toneModel); toneModelSub.textContent = TONE_MODELS[S.toneModel];
  });
  ctl.toneDepth = bindSlider('toneDepthAmt', 'toneDepth', 60, v => v === 0 ? 'None' : v + '%', null, v => v / 100);
  ctl.toneQ = bindSlider('toneQAmt', 'toneQ', 12, (_, q) => 'Q ' + q.toFixed(2), null, logMap(.5, 8));
  ctl.toneResp = bindSlider('toneRespAmt', 'toneResponse', 55, (_, t) => t < .1 ? Math.round(t * 1000) + ' ms' : t < 1 ? Math.round(t * 100) * 10 + ' ms' : t.toFixed(1) + ' s', null, logMap(.02, 2));

  /* ---- reeds ---- */
  ctl.speech = bindSlider('speechAmt', 'speech', 33, fmtX, null, logMap(.5, 4));
  ctl.scoop = bindSlider('scoopAmt', 'scoop', 5, v => v === 0 ? 'None' : v + ' ¢');
  ctl.scatter = bindSlider('scatterAmt', 'reedScatter', 1, v => v === 0 ? 'Perfect' : '±' + v.toFixed(1) + ' ¢', () => retune());
  $('newReeds').addEventListener('click', () => {
    S.reedSeed = (S.reedSeed % 100000) + 1 + Math.floor(Math.random() * 997); store.set('reedSeed', S.reedSeed);
    retune();
  });
  ctl.pull = bindSlider('pullAmt', 'unisonPull', 3, v => v === 0 ? 'Off' : v.toFixed(1) + ' ¢', () => retune());
  ctl.beat = bindSlider('beatAmt', 'celesteBeat', 1.5, v => v.toFixed(1) + ' /s', () => retune());
  ctl.breath = bindSlider('breathAmt', 'breath', 100, v => v === 0 ? 'Off' : v + '%', null, v => v / 100);

  /* ---- rank voicing drawer: level, fine tuning and brightness per rank ---- */
  const voicingGrid = $('voicingGrid');
  RANKS.forEach(r => {
    const c = cap(r.id), card = document.createElement('div');
    card.className = 'rank-card';
    card.innerHTML = `
    <p class="rank-name">${r.nm} <span>${r.ft}</span></p>
    <div class="field"><div class="field-head"><label for="lv${c}Amt">Level</label><output id="lv${c}Out" for="lv${c}Amt"></output></div>
      <input type="range" id="lv${c}Amt" min="0" max="150" step="5"></div>
    <div class="field"><div class="field-head"><label for="tu${c}Amt">Tuning</label><output id="tu${c}Out" for="tu${c}Amt"></output></div>
      <input type="range" id="tu${c}Amt" min="-20" max="20" step="0.5"></div>
    <div class="field"><div class="field-head"><label for="br${c}Amt">Brightness</label><output id="br${c}Out" for="br${c}Amt"></output></div>
      <input type="range" id="br${c}Amt" min="-100" max="100" step="5"></div>`;
    voicingGrid.appendChild(card);
  });
  ctl.voicing = RANKS.map((r, i) => {
    const c = cap(r.id);
    return {
      level: bindSlider(`lv${c}Amt`, 'v-level-' + r.id, 100, v => v === 0 ? 'Silent' : v + '%', () => applyStops(), v => v / 100),
      tune: bindSlider(`tu${c}Amt`, 'v-tune-' + r.id, 0, v => v === 0 ? '0 ¢' : signed(v, 1) + ' ¢', () => retune()),
      bright: bindSlider(`br${c}Amt`, 'v-bright-' + r.id, 0, v => v === 0 ? 'Factory' : signed(v), () => revoice(i)),
    };
  });
  $('voicingReset').addEventListener('click', () => {
    ctl.voicing.forEach(v => { v.level.set(100); v.tune.set(0); v.bright.set(0); });
  });
  const voicingEl = $('voicing');
  voicingEl.open = store.get('voicingOpen', false);
  voicingEl.addEventListener('toggle', () => store.set('voicingOpen', voicingEl.open));
  RANKS.forEach((_, i) => updateComp(i));

  /* ---- cabinet, room and treadle noise ---- */
  [['cab', 'cabAmt', 'cabOut'], ['room', 'roomAmt', 'roomOut'], ['thump', 'thumpAmt', 'thumpOut']].forEach(([k, id, oid]) => {
    const el = $(id), out = $(oid);
    el.value = mix[k]; out.textContent = mix[k] === 0 ? 'Off' : mix[k] + '%';
    el.addEventListener('input', () => {
      mix[k] = +el.value; out.textContent = mix[k] === 0 ? 'Off' : mix[k] + '%';
      store.set(k, mix[k]); applyMix();
    });
  });

  /* ---- Vox Humana fan ---- */
  const voxEl = $('voxRate'), voxOut = $('voxOut');
  voxEl.value = store.get('voxRate', 5.6);
  const syncVox = () => { voxOut.textContent = (+voxEl.value).toFixed(1) + ' Hz'; };
  voxEl.addEventListener('input', () => { initAudio(); syncVox(); store.set('voxRate', +voxEl.value); applyVox(); });
  syncVox();
  ctl.voxRate = () => +voxEl.value;           // blade passes per second
  const voxShapeEl = $('voxShape'), voxSub = $('voxSub');
  voxShapeEl.value = S.voxShape; voxSub.textContent = VOX_SHAPES[S.voxShape];
  voxShapeEl.addEventListener('change', () => {
    initAudio(); S.voxShape = voxShapeEl.value; store.set('voxShape', S.voxShape); voxSub.textContent = VOX_SHAPES[S.voxShape];
    if (ctx) setFanShape(); applyVox();
  });
  // bigger blades reach further down the spectrum: 4 kHz (small) to 600 Hz (large)
  ctl.voxBlade = bindSlider('voxBladeAmt', 'voxBlade', 52, (_, f) => 'above ' + fmtHz(f), () => applyVox(), logMap(4000, 600));
  ctl.voxShadow = bindSlider('voxShadowAmt', 'voxShadow', 35, v => v === 0 ? 'None' : v + '%', () => applyVox(), v => v / 100);
  ctl.voxShim = bindSlider('voxShimmerAmt', 'voxShimmer', 30, v => v === 0 ? 'None' : v + '%', () => applyVox(), v => v / 100);
  ctl.voxStereo = bindSlider('voxStereoAmt', 'voxStereo', 0, v => v === 0 ? 'Off' : v + '%', () => applyVox(), v => v / 100);
  ctl.voxWhole = bindSlider('voxWholeAmt', 'voxWhole', 0, v => v === 0 ? 'Off' : v + '%', () => applyVox(), v => v / 100);
  ctl.voxLid = bindSlider('voxLidAmt', 'voxLid', 0, v => v === 0 ? 'Off' : v + '%', () => applyVox(), v => v * 4);   // 100% = ±400 cents on the lid filter

  /* ---- helper pump ---- */
  const helperEl = $('helper'), helperOut = $('helperOut');
  helperEl.value = store.get('helper', 0);
  const syncHelper = () => { const v = +helperEl.value; helperOut.textContent = v === 0 ? 'Off' : v + '% · ' + (v / 100 * HELPER_MAX).toFixed(2) + '/s'; };
  helperEl.addEventListener('input', () => { initAudio(); store.set('helper', +helperEl.value); syncHelper(); });
  syncHelper();
  ctl.helperRate = () => +helperEl.value / 100 * HELPER_MAX;   // reservoir units per second
}
