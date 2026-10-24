// Pedal autoplay (D22): works the treadles in a looping rhythm, through the same
// gateOn/gateOff a player's feet use. The pattern maths is in core/autoplay.js;
// this module draws the pattern editor, saves it, and is stepped once a frame
// from the control loop (stepAutoplay).

import { METERS, MAX_MEASURES, DEFAULT_PATTERN, REST, LEFT, RIGHT, TIE, normalise, reshape, nextCell, cellSeconds, pedalsAt } from './core/autoplay.js';
import { S, store } from './state.js';
import { ctx } from './audio.js';
import { ctl } from './controls.js';
import { ped, gateOn, gateOff } from './treadles.js';

let A = normalise(DEFAULT_PATTERN);            // the pattern: on, meter, measures, cells
let t0 = null;                                 // when beat 1 of the loop started (seconds)
const held = { L: false, R: false };           // treadles autoplay is holding down
let gridEl, onEl, meterEl, measuresEl, cellEls = [], nowIdx = -1, lastTempo = 100;

const NAME = { [REST]: 'Rest', [LEFT]: 'Left', [RIGHT]: 'Right', [TIE]: 'Tie' };
const GLYPH = { [REST]: '·', [LEFT]: 'L', [RIGHT]: 'R', [TIE]: '' };
const save = () => store.set('autoplay', A);
const now = () => performance.now() / 1000;

/* ---------- the pattern editor ---------- */
function renderGrid() {
  const beats = METERS[A.meter].beats;
  gridEl.innerHTML = ''; cellEls = []; nowIdx = -1;
  for (let m = 0; m < A.measures; m++) {
    const meas = document.createElement('div'); meas.className = 'measure';
    meas.style.gridTemplateColumns = `repeat(${beats}, minmax(0, 1fr))`;
    meas.setAttribute('role', 'group'); meas.setAttribute('aria-label', `Measure ${m + 1}`);
    for (let b = 0; b < beats; b++) {
      const i = m * beats + b, el = document.createElement('button');
      el.type = 'button'; el.className = 'beat'; el.dataset.i = i;
      el.innerHTML = `<span class="beat-n">${b + 1}</span><span class="beat-v"></span>`;
      el.addEventListener('click', () => { A.cells[i] = nextCell(A.cells[i]); save(); paintCell(i); });
      meas.appendChild(el); cellEls.push(el);
    }
    gridEl.appendChild(meas);
  }
  A.cells.forEach((_, i) => paintCell(i));
}
function paintCell(i) {
  const el = cellEls[i], c = A.cells[i], m = Math.floor(i / METERS[A.meter].beats) + 1, b = i % METERS[A.meter].beats + 1;
  el.dataset.v = c;
  el.querySelector('.beat-v').textContent = GLYPH[c];
  el.setAttribute('aria-label', `Measure ${m}, beat ${b}: ${NAME[c]}`);
}
function showPlayhead(i) {
  if (i === nowIdx) return;
  if (cellEls[nowIdx]) cellEls[nowIdx].classList.remove('now');
  nowIdx = i;
  if (cellEls[i]) cellEls[i].classList.add('now');
}

// A tempo change keeps the loop's place, so the rhythm doesn't jump.
export function retime() {
  if (t0 !== null) { const t = now(), pos = (t - t0) / cellSeconds(lastTempo); t0 = t - pos * cellSeconds(ctl.tempo.value); }
  lastTempo = ctl.tempo.value;
}

function letGo() {
  for (const s of ['L', 'R']) if (held[s]) { gateOff(ped[s]); held[s] = false; }
  showPlayhead(-1);
}

/* ---------- once a frame, from the control loop ---------- */
// Autoplay waits for the sound to start (the first key, pedal or slider touch),
// because browsers only allow sound after the player does something.
export function stepAutoplay() {
  // Direct wind takes over the air (D26), so autoplay rests while it's on.
  if (!A.on || !ctx || S.directWind) { if (held.L || held.R || nowIdx >= 0) letGo(); t0 = null; return; }
  const t = now();
  if (t0 === null) t0 = t;
  const want = pedalsAt(A.cells, cellSeconds(ctl.tempo.value), t - t0);
  for (const s of ['L', 'R']) {
    if (want[s] && !held[s]) { gateOn(ped[s]); held[s] = true; }
    else if (!want[s] && held[s]) { gateOff(ped[s]); held[s] = false; }
  }
  showPlayhead(want.index);
}
export const autoplayOn = () => A.on && !!ctx && !S.directWind;

export function setupAutoplay() {
  A = normalise(store.get('autoplay', DEFAULT_PATTERN));
  lastTempo = ctl.tempo.value;
  gridEl = document.getElementById('autoGrid');
  onEl = document.getElementById('autoOn'); meterEl = document.getElementById('meter'); measuresEl = document.getElementById('measures');
  meterEl.innerHTML = Object.keys(METERS).map(k => `<option value="${k}">${k}</option>`).join('');
  measuresEl.innerHTML = Array.from({ length: MAX_MEASURES }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
  onEl.checked = A.on; meterEl.value = A.meter; measuresEl.value = String(A.measures);
  onEl.addEventListener('change', () => { A.on = onEl.checked; save(); t0 = null; });
  const reshapeTo = () => { A = reshape(A, meterEl.value, +measuresEl.value); save(); renderGrid(); };
  meterEl.addEventListener('change', reshapeTo);
  measuresEl.addEventListener('change', reshapeTo);
  renderGrid();
}
