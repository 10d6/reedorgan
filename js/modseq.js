// The modulation sequencer (D30–D32): piano rolls of sweep shapes, one for each
// thing it moves (the two treadles, Direct wind, the Vox Humana fan's speed and
// the knee swell), all playing together in time with its tempo. The treadle
// lanes are the bellows: they pump all the time, from the first touch, in place
// of Pedal autoplay. The other lanes start from the keys.
//
// The pattern maths is in core/modseq.js; this module draws the editor, saves
// the pattern, starts and stops the key-driven lanes (seqPress, seqReleaseAll),
// and tells the control loop each frame what every playing lane wants (seqTick).

import {
  SEQ_ROWS, SEQ_CURVES, SEQ_TARGETS, LANE_NAMES, FREE_LANES, METERS, MAX_BARS, normaliseSeq, migrateSaved, reshape,
  placeNote, resizeNote, removeNote, seqValue, seqSteps, stepsPerBar, stepsPerBeat, seqPosition, seqShape, stepSeconds,
  toShare, fromShare, amountText,
} from './core/modseq.js';
import { S, stops, store } from './state.js';
import { ctx } from './audio.js';
import { ctl, setDirectWind } from './controls.js';
import { drawVox } from './stops.js';
import { patchField } from './patches.js';

let P = normaliseSeq();       // meter, bars, trigger, edit (the lane on show), lanes {on, amount, notes}
let t0 = null;                // when the key-driven lanes' pass started (seconds), or null when stopped
let free0 = null;             // when the treadle lanes started (seconds), or null while they rest
let lastTempo = 100, sel = -1; // the selected note's index in the lane on show, or −1
let gridEl, laneEl, playEl, onEl, amountEl, amountOut, tabsEl, meterEl, barsEl, trigEl;

const now = () => performance.now() / 1000;
const lane = () => P.lanes[P.edit];
const steps = () => seqSteps(P.meter, P.bars);
const rowOf = id => SEQ_ROWS.findIndex(r => r.id === id);
// grid rows: 1 the beat numbers, 2 "Sweep up", 3–6 its curves, 7 "Sweep down", 8–11 its curves
const gridRow = i => i < 4 ? 3 + i : 4 + i;
const describe = r => `Sweep ${r.dir > 0 ? 'up' : 'down'}, ${SEQ_CURVES[r.curve]}`;
function where(s) {
  const bar = stepsPerBar(P.meter), beat = stepsPerBeat(P.meter);
  return `bar ${Math.floor(s / bar) + 1}, beat ${Math.floor(s % bar / beat) + 1}, 16th ${s % beat + 1}`;
}

// Each lane's control, in its own units: its own setting (where every pass
// starts), whether it can move right now, and how to turn it on.
//  - The treadles start up (0) and rest while Direct wind supplies the air;
//    turning a treadle lane on turns Direct wind off.
//  - Direct wind only moves the wind while it's on; turning its lane on turns
//    it on (and the treadle lanes then rest).
//  - The fan only turns while the Vox Humana is drawn; turning its lane on
//    draws the stop.
const TARGETS = {
  left: { base: () => 0, ready: () => !S.directWind, enable: () => { if (S.directWind) setDirectWind(false); } },
  right: { base: () => 0, ready: () => !S.directWind, enable: () => { if (S.directWind) setDirectWind(false); } },
  direct: { base: () => ctl.directAir.value * 3.6, ready: () => S.directWind, enable: () => { if (!S.directWind) setDirectWind(true); } },
  fan: { base: () => ctl.voxRate(), ready: () => stops.vox, enable: () => drawVox() },
  swell: { base: () => ctl.swell.value * 100, ready: () => true, enable: () => {} },
};
const isFree = id => FREE_LANES.includes(id);
// The time a lane's current pass started, or null if it isn't running.
const startOf = id => isFree(id) ? free0 : t0;
const playing = id => P.lanes[id].on && startOf(id) !== null && TARGETS[id].ready();

// A curve as an SVG path in a 100 × 100 box, rising or falling.
function curvePath(r) {
  let d = '';
  for (let k = 0; k <= 20; k++) { const x = k * 5, y = seqShape(k / 20, r.curve) * 100; d += (k ? 'L' : 'M') + x + ' ' + (r.dir > 0 ? 100 - y : y).toFixed(1); }
  return d;
}
const curveSvg = (r, cls) => `<svg class="${cls}" viewBox="-4 -4 108 108" preserveAspectRatio="none" aria-hidden="true"><path d="${curvePath(r)}" vector-effect="non-scaling-stroke"/></svg>`;

/* ---------- the lanes and the piano roll ---------- */
function renderTabs() {
  tabsEl.querySelectorAll('.seq-tab').forEach(b => {
    const id = b.dataset.lane;
    b.setAttribute('aria-selected', id === P.edit ? 'true' : 'false');
    b.classList.toggle('on', P.lanes[id].on);
  });
  onEl.checked = lane().on;
  amountEl.value = Math.round(lane().amount * 100);
  amountOut.textContent = amountText(P.edit, +amountEl.value);
  gridEl.setAttribute('aria-label', `${LANE_NAMES[P.edit]} pattern`);
}
function render() {
  const n = steps(), bar = stepsPerBar(P.meter), beat = stepsPerBeat(P.meter);
  gridEl.style.setProperty('--steps', n);
  let h = '';
  for (let s = 0; s < n; s += beat) {
    const b = Math.floor(s / bar), k = s % bar / beat + 1;
    h += `<span class="seq-beat${s % bar === 0 ? ' is-bar' : ''}" style="grid-column:${s + 2} / span ${beat}">${s % bar === 0 && P.bars > 1 ? `${b + 1}.` : ''}${k}</span>`;
  }
  h += `<span class="seq-group" style="grid-row:2">Sweep up</span><span class="seq-group" style="grid-row:7">Sweep down</span>`;
  SEQ_ROWS.forEach((r, i) => {
    h += `<span class="seq-label" style="grid-row:${gridRow(i)}">${curveSvg(r, 'seq-icon')}<span>${SEQ_CURVES[r.curve]}</span></span>`;
    for (let s = 0; s < n; s++) {
      h += `<button type="button" class="seq-cell${s % beat === 0 ? ' is-beat' : ''}${s % bar === 0 ? ' is-bar' : ''}" style="grid-row:${gridRow(i)};grid-column:${s + 2}" data-row="${r.id}" data-step="${s}" aria-label="${describe(r)}, ${where(s)}"></button>`;
    }
  });
  lane().notes.forEach((x, k) => { h += noteHtml(x, k); });
  h += `<div class="seq-lane" style="grid-column:2 / -1;grid-row:1 / -1"><div class="seq-play" hidden></div></div>`;
  gridEl.innerHTML = h;
  laneEl = gridEl.querySelector('.seq-lane'); playEl = gridEl.querySelector('.seq-play');
  renderTabs();
}
function noteHtml(x, k) {
  const r = SEQ_ROWS[rowOf(x.row)];
  return `<button type="button" class="seq-note ${r.dir > 0 ? 'up' : 'down'}${k === sel ? ' selected' : ''}" data-i="${k}" style="${noteStyle(x)}" aria-label="${noteLabel(x)}">`
    + `${curveSvg(r, 'seq-shape')}<span class="seq-handle start" data-edge="start"></span><span class="seq-handle end" data-edge="end"></span></button>`;
}
const noteStyle = x => `grid-row:${gridRow(rowOf(x.row))};grid-column:${x.start + 2} / span ${x.len}`;
const noteLabel = x => `${describe(SEQ_ROWS[rowOf(x.row)])}, ${x.len} sixteenth${x.len > 1 ? 's' : ''} from ${where(x.start)}`;
function select(k, focus = true) {
  sel = k;
  gridEl.querySelectorAll('.seq-note').forEach(el => el.classList.toggle('selected', +el.dataset.i === k));
  const el = gridEl.querySelector(`.seq-note[data-i="${k}"]`); if (el && focus) el.focus();
}
function edit({ notes, index }) { lane().notes = notes; render(); if (index >= 0) select(index); }

// Stretching a note by dragging either end. The note is updated in place while
// dragging (re-drawing would lose the pointer), and saved when it's let go.
function startDrag(e, handle) {
  const el = handle.closest('.seq-note'), k = +el.dataset.i, edge = handle.dataset.edge;
  e.preventDefault(); e.stopPropagation(); select(k);
  handle.setPointerCapture(e.pointerId);
  const move = ev => {
    const box = laneEl.getBoundingClientRect(), n = steps();
    const to = Math.round((ev.clientX - box.left) / box.width * n);
    lane().notes = resizeNote(lane().notes, k, edge, to, n).notes;
    el.style.cssText = noteStyle(lane().notes[k]); el.setAttribute('aria-label', noteLabel(lane().notes[k]));
  };
  const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); render(); select(k); };
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
}

// Keys on a selected note. They're kept from the organ, so they don't play
// notes or pump the treadles.
//  Backspace or Delete removes it; Shift+→ / Shift+← stretch it forwards or
//  backwards by a 16th; Alt+← / Alt+→ shorten it from the end or the start.
function onKey(e) {
  const el = e.target.closest && e.target.closest('.seq-note'); if (!el) return;
  const k = +el.dataset.i, x = lane().notes[k], n = steps();
  if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault(); e.stopPropagation();
    lane().notes = removeNote(lane().notes, k); sel = -1; render();
    gridEl.querySelector(`.seq-cell[data-row="${x.row}"][data-step="${x.start}"]`)?.focus();
    return;
  }
  if (!e.key.startsWith('Arrow') || !(e.shiftKey || e.altKey) || e.key === 'ArrowUp' || e.key === 'ArrowDown') return;
  e.preventDefault(); e.stopPropagation();
  const right = e.key === 'ArrowRight';
  const [edge, to] = e.shiftKey ? (right ? ['end', x.start + x.len + 1] : ['start', x.start - 1])
    : (right ? ['start', x.start + 1] : ['end', x.start + x.len - 1]);
  edit(resizeNote(lane().notes, k, edge, to, n));
}

/* ---------- playing ---------- */
// A key going down starts the key-driven lanes: on the first note of a phrase
// (no other keys held), or on every note with Each note. They loop while keys
// are held.
export function seqPress(first) {
  if (first || P.trigger === 'each' || t0 === null) t0 = now();
}
// Letting go of every key stops them, and each control eases back to its own setting.
export function seqReleaseAll() { t0 = null; }
// Whether the treadle lanes are pumping now (for the status line).
export const seqPumping = () => FREE_LANES.some(playing);
export const seqPlaying = id => playing(id);

// Once a frame, from the control loop: what every playing lane wants, in its
// own units ({left, right} in percent of a stroke, {direct} in inches, {fan}
// in Hz, {swell} in percent); a lane that isn't playing is missing. Each pass
// starts from the control's own setting. The treadle lanes start with the
// sound (the first touch) and rest, starting again from beat 1, while Direct
// wind is on.
export function seqTick() {
  const out = {}, t = now();
  if (ctx && FREE_LANES.some(id => P.lanes[id].on) && !S.directWind) { if (free0 === null) free0 = t; }
  else free0 = null;
  const n = steps();
  for (const id of SEQ_TARGETS) {
    if (!playing(id)) continue;
    const pos = seqPosition(t - startOf(id), ctl.tempo.value, P.meter, n), L = P.lanes[id];
    out[id] = fromShare(id, seqValue(L.notes, pos, toShare(id, TARGETS[id].base()), L.amount));
  }
  if (playEl) {
    const on = playing(P.edit);
    if (on) playEl.style.left = (seqPosition(t - startOf(P.edit), ctl.tempo.value, P.meter, n) / n * 100).toFixed(2) + '%';
    if (playEl.hidden === on) playEl.hidden = !on;
  }
  return out;
}
// A tempo change keeps both clocks' place.
export function seqRetime() {
  const t = now(), from = stepSeconds(lastTempo, P.meter), to = stepSeconds(ctl.tempo.value, P.meter);
  if (t0 !== null) t0 = t - (t - t0) / from * to;
  if (free0 !== null) free0 = t - (t - free0) / from * to;
  lastTempo = ctl.tempo.value;
}

export function setupModSeq() {
  // which pattern is on show is page layout, remembered on its own (D33)
  P = normaliseSeq({ edit: store.get('seqLane', 'left') });
  lastTempo = ctl.tempo.value;
  gridEl = document.getElementById('seqGrid'); onEl = document.getElementById('seqOn'); tabsEl = document.getElementById('seqLanes');
  amountEl = document.getElementById('seqAmountAmt'); amountOut = document.getElementById('seqAmountOut');
  meterEl = document.getElementById('seqMeter'); barsEl = document.getElementById('seqBars'); trigEl = document.getElementById('seqTrigger');
  meterEl.innerHTML = Object.keys(METERS).map(k => `<option value="${k}">${k}</option>`).join('');
  barsEl.innerHTML = Array.from({ length: MAX_BARS }, (_, i) => `<option value="${i + 1}">${i + 1} bar${i ? 's' : ''}</option>`).join('');
  tabsEl.innerHTML = SEQ_TARGETS.map(id => `<button type="button" role="tab" class="seq-tab" data-lane="${id}"><span class="lamp" aria-hidden="true"></span>${LANE_NAMES[id]}</button>`).join('');
  meterEl.value = P.meter; barsEl.value = String(P.bars); trigEl.value = P.trigger;
  tabsEl.addEventListener('click', e => { const b = e.target.closest('.seq-tab'); if (!b) return; P.edit = b.dataset.lane; store.set('seqLane', P.edit); sel = -1; render(); });
  // Turning a lane on turns on what it moves (D31, D32).
  onEl.addEventListener('change', () => { lane().on = onEl.checked; if (lane().on) TARGETS[P.edit].enable(); renderTabs(); });
  amountEl.addEventListener('input', () => { lane().amount = +amountEl.value / 100; amountOut.textContent = amountText(P.edit, +amountEl.value); });
  const reshapeTo = () => { P = reshape(P, meterEl.value, +barsEl.value); sel = -1; render(); };
  meterEl.addEventListener('change', reshapeTo); barsEl.addEventListener('change', reshapeTo);
  trigEl.addEventListener('change', () => { P.trigger = trigEl.value; });
  document.getElementById('seqClear').addEventListener('click', () => { lane().notes = []; sel = -1; render(); });
  gridEl.addEventListener('pointerdown', e => { const h = e.target.closest('.seq-handle'); if (h) startDrag(e, h); });
  gridEl.addEventListener('click', e => {
    const note = e.target.closest('.seq-note');
    if (note) { select(+note.dataset.i); return; }
    const cell = e.target.closest('.seq-cell');
    if (cell) edit(placeNote(lane().notes, cell.dataset.row, +cell.dataset.step));
  });
  gridEl.addEventListener('focusin', e => { const note = e.target.closest('.seq-note'); if (note && +note.dataset.i !== sel) select(+note.dataset.i, false); });
  gridEl.addEventListener('keydown', onKey);
  render();
  // Patches (D33) hold the whole sequencer: time, bars, Starts on and every
  // lane. Which lane is on show isn't part of the sound, so it's left out and
  // kept as it is when a patch loads. Before patches, it was saved under
  // reed-seq, or as Pedal autoplay and the first sequencer's settings.
  patchField('seq', {
    def: (({ edit, ...rest }) => rest)(normaliseSeq()),
    get: () => { const { edit, ...rest } = P; return rest; },
    set: v => {
      P = normaliseSeq({ ...v, edit: P.edit }); sel = -1;
      meterEl.value = P.meter; barsEl.value = String(P.bars); trigEl.value = P.trigger;
      render();
    },
    ok: v => !!v && typeof v === 'object' && !Array.isArray(v),
    legacy: () => {
      const seq = store.get('seq', null), autoplay = store.get('autoplay', null), modseq = store.get('modseq', null);
      if (seq) return seq;
      if (autoplay || modseq) return migrateSaved({ autoplay, modseq, amount: store.get('seqAmount', null) });
      return undefined;
    },
  });
}
