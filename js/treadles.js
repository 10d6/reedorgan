// The two treadles: each feeds the reservoir through its own ADSR envelope, with
// an on-screen pedal and an envelope picture whose dot follows the airflow.

import { DEFAULT_ENV, TMAX, toTime, toSlider, fmtT } from './core/wind.js';
import { S, store } from './state.js';
import { initAudio, thump } from './audio.js';
import { mix } from './controls.js';

// {side, gate, stage ('idle'|'a'|'d'|'s'|'r'), lvl 0…1 (the foot's envelope),
//  seq 0…1 (the sequencer's treadle lane, D32), relFrom, boost, p:{a,d,s,r}}
export const ped = {
  L: { side: 'L', name: 'Left', gate: false, stage: 'idle', lvl: 0, seq: 0, seqDown: false, relFrom: 0, boost: 1, p: { ...DEFAULT_ENV, ...store.get('envL', {}) } },
  R: { side: 'R', name: 'Right', gate: false, stage: 'idle', lvl: 0, seq: 0, seqDown: false, relFrom: 0, boost: 1, p: { ...DEFAULT_ENV, ...store.get('envR', {}) } },
};
// How far the pedal is down: the player's foot or the sequencer, whichever is further.
export const pedalLevel = P => Math.max(P.lvl, P.seq);
let linkEl;

export function gateOn(P) {
  initAudio();
  if (P.gate) return;
  P.gate = true;
  P.boost = P.side !== S.lastSide ? 1 : .45;   // alternating feet fills the feeders better
  S.lastSide = P.side;
  P.stage = 'a';
  thump(mix.thump / 100);
}
export function gateOff(P) {
  if (!P.gate) return;
  P.gate = false;
  if (P.lvl > 0) { P.stage = 'r'; P.relFrom = P.lvl; } else P.stage = 'idle';
}

// The sequencer's treadle lanes press the pedals too (D32), each frame. A
// stroke starts when the pedal leaves the top: it gets the bonus for
// alternating feet and the hinge thump, as a foot does.
export function seqPedal(P, lvl) {
  if (lvl > .02 && !P.seqDown) {
    P.seqDown = true;
    if (!P.gate) { P.boost = P.side !== S.lastSide ? 1 : .45; S.lastSide = P.side; thump(mix.thump / 100); }
  } else if (lvl < .01) P.seqDown = false;
  P.seq = lvl;
}

function setParam(P, k, v) {
  P.p[k] = v; store.set('env' + P.side, P.p);
  if (linkEl.checked) { const O = P.side === 'L' ? ped.R : ped.L; O.p[k] = v; store.set('env' + O.side, O.p); syncUI(O); }
  syncUI(P);
}
function syncUI(P) {
  ['a', 'd', 'r'].forEach(k => { P.inputs[k].value = toSlider(P.p[k]); P.outs[k].textContent = fmtT(P.p[k]); });
  P.inputs.s.value = Math.round(P.p.s * 100); P.outs.s.textContent = Math.round(P.p.s * 100) + '%';
  drawShape(P);
}
// Envelope picture: segment widths on a log-ish scale so 5 ms and 30 s both read.
const segW = t => 8 + 46 * Math.log10(1 + t * 20) / Math.log10(1 + TMAX * 20);
function geom(P) {
  const wa = segW(P.p.a), wd = segW(P.p.d), ws = 36, wr = segW(P.p.r);
  const total = wa + wd + ws + wr, k = 212 / total;
  const x0 = 4, xa = x0 + wa * k, xd = xa + wd * k, xs = xd + ws * k, xr = xs + wr * k;
  const y = l => 58 - 50 * l;
  return { x0, xa, xd, xs, xr, y };
}
function drawShape(P) {
  const g = geom(P), ys = g.y(P.p.s);
  P.shape.setAttribute('points', `${g.x0},58 ${g.xa.toFixed(1)},8 ${g.xd.toFixed(1)},${ys.toFixed(1)} ${g.xs.toFixed(1)},${ys.toFixed(1)} ${g.xr.toFixed(1)},58`);
}
// Moves the dot along the envelope picture to where the airflow is now.
export function placeDot(P) {
  if (P.stage === 'idle') { P.dot.setAttribute('opacity', '0'); return; }
  const g = geom(P), s = P.p.s; let x;
  if (P.stage === 'a') x = g.x0 + (g.xa - g.x0) * P.lvl;
  else if (P.stage === 'd') x = g.xa + (g.xd - g.xa) * (s >= 1 ? 1 : Math.min(1, (1 - P.lvl) / (1 - s)));
  else if (P.stage === 's') x = (g.xd + g.xs) / 2;
  else x = g.xs + (g.xr - g.xs) * (P.relFrom > 0 ? 1 - P.lvl / P.relFrom : 1);
  P.dot.setAttribute('cx', x.toFixed(1)); P.dot.setAttribute('cy', g.y(P.lvl).toFixed(1)); P.dot.setAttribute('opacity', '1');
}

function buildFoot(P, feetEl) {
  const s = P.side;
  const wrap = document.createElement('div'); wrap.className = 'foot';
  wrap.innerHTML = `
    <button class="treadle" id="t${s}" type="button" aria-label="${P.name} treadle, hold to pump"><span class="carpet">${P.name}</span></button>
    <div class="rail env">
      <div class="env-top"><p class="rail-label">${P.name} foot</p><span class="env-flow" id="flow${s}">idle</span></div>
      <svg viewBox="0 0 220 64" aria-hidden="true">
        <line x1="4" y1="58" x2="216" y2="58" stroke="#5a4028" stroke-width="1"/>
        <polyline id="shape${s}" fill="rgba(201,160,82,.14)" stroke="#c9a052" stroke-width="1.6" stroke-linejoin="round"/>
        <circle id="dot${s}" r="4" fill="#eee3c6" stroke="#1c110b" stroke-width="1.5" cx="4" cy="58" opacity="0"/>
      </svg>
      <div class="env-grid">
        <label for="a${s}">Attack</label><input type="range" id="a${s}" min="0" max="1000"><output id="ao${s}"></output>
        <label for="d${s}">Decay</label><input type="range" id="d${s}" min="0" max="1000"><output id="do${s}"></output>
        <label for="s${s}">Sustain</label><input type="range" id="s${s}" min="0" max="100"><output id="so${s}"></output>
        <label for="r${s}">Release</label><input type="range" id="r${s}" min="0" max="1000"><output id="ro${s}"></output>
      </div>
    </div>`;
  feetEl.appendChild(wrap);
  P.el = wrap.querySelector('.treadle');
  P.shape = wrap.querySelector('#shape' + s); P.dot = wrap.querySelector('#dot' + s); P.flowEl = wrap.querySelector('#flow' + s);
  P.inputs = { a: wrap.querySelector('#a' + s), d: wrap.querySelector('#d' + s), s: wrap.querySelector('#s' + s), r: wrap.querySelector('#r' + s) };
  P.outs = { a: wrap.querySelector('#ao' + s), d: wrap.querySelector('#do' + s), s: wrap.querySelector('#so' + s), r: wrap.querySelector('#ro' + s) };
  ['a', 'd', 'r'].forEach(k => P.inputs[k].addEventListener('input', () => setParam(P, k, toTime(+P.inputs[k].value))));
  P.inputs.s.addEventListener('input', () => setParam(P, 's', +P.inputs.s.value / 100));
  P.el.addEventListener('pointerdown', e => { e.preventDefault(); try { P.el.setPointerCapture(e.pointerId); } catch (_) {} gateOn(P); });
  const up = () => gateOff(P);
  P.el.addEventListener('pointerup', up); P.el.addEventListener('pointercancel', up); P.el.addEventListener('lostpointercapture', up);
  P.el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) gateOn(P); } });
  P.el.addEventListener('keyup', e => { if (e.key === 'Enter') { e.stopPropagation(); gateOff(P); } });
  syncUI(P);
}

export function setupTreadles() {
  const easyEl = document.getElementById('easyWind');   // Easy wind (D23)
  easyEl.checked = S.easyWind;
  easyEl.addEventListener('change', () => { S.easyWind = easyEl.checked; store.set('easyWind', S.easyWind); });
  linkEl = document.getElementById('link');
  linkEl.checked = store.get('link', true);
  linkEl.addEventListener('change', () => {
    store.set('link', linkEl.checked);
    if (linkEl.checked) { ped.R.p = { ...ped.L.p }; store.set('envR', ped.R.p); syncUI(ped.R); }
  });
  const feetEl = document.getElementById('feet');
  buildFoot(ped.L, feetEl); buildFoot(ped.R, feetEl);
}
