// The modulation sequencer (D30, D31): a piano roll of sweep shapes that moves
// Direct wind, the Vox Humana fan's speed or the knee swell in time with the
// tempo. The pattern maths is in core/modseq.js; this module draws the editor,
// saves the pattern, starts and stops it from the keys (seqPress,
// seqReleaseAll), and tells the control loop each frame what it wants for its
// target (seqTick).

import { SEQ_ROWS, SEQ_CURVES, DEFAULT_SEQ, normaliseSeq, placeNote, resizeNote, removeNote, setBars, seqValue, seqSteps, seqPosition, seqShape, stepSeconds, toShare, fromShare, amountText } from './core/modseq.js';
import { S, stops, store } from './state.js';
import { ctl, setDirectWind } from './controls.js';
import { drawVox } from './stops.js';

let P = normaliseSeq(DEFAULT_SEQ);   // the pattern: on, target, bars, trigger, notes
let t0 = null;                       // when the current pass started (seconds), or null when stopped
let lastTempo = 100, sel = -1;       // the selected note's index, or −1
let gridEl, laneEl, playEl, onEl;

const save = () => store.set('modseq', P);
const now = () => performance.now() / 1000;
const rowOf = id => SEQ_ROWS.findIndex(r => r.id === id);
// grid rows: 1 the beat numbers, 2 "Sweep up", 3–6 its curves, 7 "Sweep down", 8–11 its curves
const gridRow = i => i < 4 ? 3 + i : 4 + i;
const describe = r => `Sweep ${r.dir > 0 ? 'up' : 'down'}, ${SEQ_CURVES[r.curve]}`;
const where = s => `bar ${Math.floor(s / 16) + 1}, beat ${Math.floor(s % 16 / 4) + 1}, 16th ${s % 4 + 1}`;

// A curve as an SVG path in a 100 × 100 box, rising or falling.
function curvePath(r) {
  let d = '';
  for (let k = 0; k <= 20; k++) { const x = k * 5, y = seqShape(k / 20, r.curve) * 100; d += (k ? 'L' : 'M') + x + ' ' + (r.dir > 0 ? 100 - y : y).toFixed(1); }
  return d;
}
const curveSvg = (r, cls) => `<svg class="${cls}" viewBox="-4 -4 108 108" preserveAspectRatio="none" aria-hidden="true"><path d="${curvePath(r)}" vector-effect="non-scaling-stroke"/></svg>`;

/* ---------- the piano roll ---------- */
function render() {
  const n = seqSteps(P.bars);
  gridEl.style.setProperty('--steps', n);
  let h = '';
  for (let s = 0; s < n; s++) if (s % 4 === 0) h += `<span class="seq-beat${s % 16 === 0 ? ' is-bar' : ''}" style="grid-column:${s + 2} / span 4">${s % 16 === 0 && P.bars > 1 ? `${s / 16 + 1}.` : ''}${s % 16 / 4 + 1}</span>`;
  h += `<span class="seq-group" style="grid-row:2">Sweep up</span><span class="seq-group" style="grid-row:7">Sweep down</span>`;
  SEQ_ROWS.forEach((r, i) => {
    h += `<span class="seq-label" style="grid-row:${gridRow(i)}">${curveSvg(r, 'seq-icon')}<span>${SEQ_CURVES[r.curve]}</span></span>`;
    for (let s = 0; s < n; s++) {
      h += `<button type="button" class="seq-cell${s % 4 === 0 ? ' is-beat' : ''}${s % 16 === 0 ? ' is-bar' : ''}" style="grid-row:${gridRow(i)};grid-column:${s + 2}" data-row="${r.id}" data-step="${s}" aria-label="${describe(r)}, ${where(s)}"></button>`;
    }
  });
  P.notes.forEach((x, k) => { h += noteHtml(x, k); });
  h += `<div class="seq-lane" style="grid-column:2 / -1;grid-row:1 / -1"><div class="seq-play" hidden></div></div>`;
  gridEl.innerHTML = h;
  laneEl = gridEl.querySelector('.seq-lane'); playEl = gridEl.querySelector('.seq-play');
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
function edit({ notes, index }) { P.notes = notes; save(); render(); if (index >= 0) select(index); }

// Stretching a note by dragging either end. The note is updated in place while
// dragging (re-drawing would lose the pointer), and saved when it's let go.
function startDrag(e, handle) {
  const el = handle.closest('.seq-note'), k = +el.dataset.i, edge = handle.dataset.edge;
  e.preventDefault(); e.stopPropagation(); select(k);
  handle.setPointerCapture(e.pointerId);
  const move = ev => {
    const box = laneEl.getBoundingClientRect(), n = seqSteps(P.bars);
    const to = Math.round((ev.clientX - box.left) / box.width * n);
    P.notes = resizeNote(P.notes, k, edge, to, n).notes;
    el.style.cssText = noteStyle(P.notes[k]); el.setAttribute('aria-label', noteLabel(P.notes[k]));
  };
  const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); save(); render(); select(k); };
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
}

// Keys on a selected note. They're kept from the organ, so they don't play
// notes or pump the treadles.
//  Backspace or Delete removes it; Shift+→ / Shift+← stretch it forwards or
//  backwards by a 16th; Alt+← / Alt+→ shorten it from the end or the start.
function onKey(e) {
  const el = e.target.closest && e.target.closest('.seq-note'); if (!el) return;
  const k = +el.dataset.i, x = P.notes[k], n = seqSteps(P.bars);
  if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault(); e.stopPropagation();
    P.notes = removeNote(P.notes, k); sel = -1; save(); render();
    gridEl.querySelector(`.seq-cell[data-row="${x.row}"][data-step="${x.start}"]`)?.focus();
    return;
  }
  if (!e.key.startsWith('Arrow') || !(e.shiftKey || e.altKey) || e.key === 'ArrowUp' || e.key === 'ArrowDown') return;
  e.preventDefault(); e.stopPropagation();
  const right = e.key === 'ArrowRight';
  const [edge, to] = e.shiftKey ? (right ? ['end', x.start + x.len + 1] : ['start', x.start - 1])
    : (right ? ['start', x.start + 1] : ['end', x.start + x.len - 1]);
  edit(resizeNote(P.notes, k, edge, to, n));
}

/* ---------- playing ---------- */
// A key going down starts the pattern: on the first note of a phrase (no other
// keys held), or on every note with Each note. It loops while keys are held.
export function seqPress(first) {
  if (!P.on) return;
  if (first || P.trigger === 'each' || t0 === null) t0 = now();
}
// Letting go of every key stops it, and the wind eases back to its own setting.
export function seqReleaseAll() { t0 = null; }
// Each target, in its own units: its own setting (where every pass starts),
// whether it can be moved right now, and how to turn it on. Direct wind only
// moves the wind while it's on, and the fan only turns while its stop is drawn.
const TARGETS = {
  direct: { base: () => ctl.directAir.value * 3.6, ready: () => S.directWind, enable: () => { if (!S.directWind) setDirectWind(true); } },
  fan: { base: () => ctl.voxRate(), ready: () => stops.vox, enable: () => drawVox() },
  swell: { base: () => ctl.swell.value * 100, ready: () => true, enable: () => {} },
};
export const seqTarget = () => P.target;
export const seqPlaying = () => P.on && t0 !== null && TARGETS[P.target].ready();
// The Amount readout for slider position `pct`, in the current target's units.
export const seqAmountText = pct => amountText(P.target, pct);

// Once a frame, from the control loop: {target, value} with the value the
// sequencer wants, in the target's units (inches, Hz or percent), or null when
// it isn't moving anything. Each pass starts from the target's own setting.
export function seqTick() {
  if (!seqPlaying()) { if (playEl && !playEl.hidden) playEl.hidden = true; return null; }
  const n = seqSteps(P.bars), pos = seqPosition(now() - t0, ctl.tempo.value, n), T = TARGETS[P.target];
  if (playEl) { playEl.hidden = false; playEl.style.left = (pos / n * 100).toFixed(2) + '%'; }
  const share = seqValue(P.notes, pos, toShare(P.target, T.base()), ctl.seqAmount.value);
  return { target: P.target, value: fromShare(P.target, share) };
}
// A tempo change keeps the pattern's place.
export function seqRetime() {
  if (t0 !== null) { const t = now(), pos = (t - t0) / stepSeconds(lastTempo); t0 = t - pos * stepSeconds(ctl.tempo.value); }
  lastTempo = ctl.tempo.value;
}

export function setupModSeq() {
  P = normaliseSeq(store.get('modseq', DEFAULT_SEQ));
  lastTempo = ctl.tempo.value;
  gridEl = document.getElementById('seqGrid'); onEl = document.getElementById('seqOn');
  const barsEl = document.getElementById('seqBars'), trigEl = document.getElementById('seqTrigger'), targetEl = document.getElementById('seqTarget');
  onEl.checked = P.on; barsEl.value = String(P.bars); trigEl.value = P.trigger; targetEl.value = P.target;
  // Turning the sequencer on, or choosing what it moves while it's on, turns on
  // what it moves: Direct wind, or the Vox Humana stop.
  onEl.addEventListener('change', () => { P.on = onEl.checked; save(); t0 = null; if (P.on) TARGETS[P.target].enable(); });
  barsEl.addEventListener('change', () => { P = setBars(P, +barsEl.value); sel = -1; save(); render(); });
  trigEl.addEventListener('change', () => { P.trigger = trigEl.value; save(); });
  targetEl.addEventListener('change', () => {
    P.target = targetEl.value; save(); if (P.on) TARGETS[P.target].enable();
    ctl.seqAmount.set(+ctl.seqAmount.el.value, false);   // the readout's units follow the target
  });
  ctl.seqAmount.set(+ctl.seqAmount.el.value, false);
  document.getElementById('seqClear').addEventListener('click', () => { P.notes = []; sel = -1; save(); render(); });
  gridEl.addEventListener('pointerdown', e => { const h = e.target.closest('.seq-handle'); if (h) startDrag(e, h); });
  gridEl.addEventListener('click', e => {
    const note = e.target.closest('.seq-note');
    if (note) { select(+note.dataset.i); return; }
    const cell = e.target.closest('.seq-cell');
    if (cell) edit(placeNote(P.notes, cell.dataset.row, +cell.dataset.step));
  });
  gridEl.addEventListener('focusin', e => { const note = e.target.closest('.seq-note'); if (note && +note.dataset.i !== sel) select(+note.dataset.i, false); });
  gridEl.addEventListener('keydown', onKey);
  const panel = document.getElementById('seqPanel');
  panel.open = store.get('seqOpen', false);
  panel.addEventListener('toggle', () => store.set('seqOpen', panel.open));
  render();
}
