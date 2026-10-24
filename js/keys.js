// The keyboard on screen, octave couplers, and every way of playing it:
// pointer, computer keys and MIDI.

import { S, stops, voices, splitNote, store } from './state.js';
import { initAudio, noteOn, noteOff, silenceAll, ctx } from './audio.js';
import { ctl } from './controls.js';
import { ped, gateOn, gateOff } from './treadles.js';

const KEYMAP = {
  z: 48, s: 49, x: 50, d: 51, c: 52, v: 53, g: 54, b: 55, h: 56, n: 57, j: 58, m: 59,
  q: 60, '2': 61, w: 62, '3': 63, e: 64, r: 65, '5': 66, t: 67, '6': 68, y: 69, '7': 70, u: 71,
  i: 72, '9': 73, o: 74, '0': 75, p: 76, '[': 77, '=': 78, ']': 79,
};
// The same keys by physical position (KeyboardEvent.code). Notes are tracked by
// position, so Shift or a symbol on the key can't change which note a key-up
// releases (a shifted "2" comes up as "@", which used to leave the note stuck).
const CODE_NAME = { '[': 'BracketLeft', '=': 'Equal', ']': 'BracketRight' };
const CODEMAP = {}; for (const k in KEYMAP) CODEMAP[CODE_NAME[k] || (/\d/.test(k) ? 'Digit' + k : 'Key' + k.toUpperCase())] = KEYMAP[k];
const keyId = e => (e.code && e.code in CODEMAP) ? e.code : (e.key || '').toLowerCase();
const noteOfKey = id => id in CODEMAP ? CODEMAP[id] : KEYMAP[id];
const LABEL = {}; for (const k in KEYMAP) LABEL[KEYMAP[k]] = k;
const isBlack = m => [1, 3, 6, 8, 10].includes(m % 12);
let keysEl, range = null;

/* ---------- the keyboard on screen ---------- */
// 25 keys on narrow screens, 37 on wide ones, rebuilt only when that changes.
function buildKeys() {
  const w = keysEl.clientWidth || window.innerWidth;
  const r = w < 620 ? [48, 72] : [48, 84];
  if (range && range[0] === r[0] && range[1] === r[1]) return;
  range = r; keysEl.innerHTML = '';
  const whites = []; for (let m = r[0]; m <= r[1]; m++) if (!isBlack(m)) whites.push(m);
  const W = 100 / whites.length;
  let wi = 0;
  for (let m = r[0]; m <= r[1]; m++) {
    const el = document.createElement('div');
    el.dataset.midi = m;
    const lbl = LABEL[m] && w >= 620 ? `<span class="lbl">${LABEL[m]}</span>` : '';
    if (isBlack(m)) {
      el.className = 'key black';
      const bw = W * .6;
      el.style.left = `calc(${wi * W - bw / 2}% - 0.5px)`; el.style.width = bw + '%';
    } else { el.className = 'key white' + (m === splitNote() && m > r[0] ? ' split' : ''); wi++; }
    el.innerHTML = lbl;
    keysEl.appendChild(el);
  }
  for (const [m, v] of voices) if (!v.released) markKey(m, true);
}
// Redraws the keys, e.g. when the split point moves.
export function rebuildKeys() { range = null; buildKeys(); }
export function markKey(m, on) { const el = keysEl.querySelector(`[data-midi="${m}"]`); if (el) el.classList.toggle('down', on); }

/* ---------- compass (D19) ---------- */
// Which notes the organ has. A real 61-key reed organ runs F to F; Full range
// plays anything a MIDI keyboard or a coupler reaches, A0 to C8.
export const COMPASS = { full: [21, 108], organ: [29, 89] };
const inCompass = n => { const c = COMPASS[S.compass] || COMPASS.full; return n >= c[0] && n <= c[1]; };

/* ---------- octave couplers (D5) ---------- */
// Like the real mechanism, a coupler pulls down the key an octave below or above,
// so the coupled note sounds with whichever stops are drawn in its own half.
// A coupler past the end of the compass has no key to pull, so it stays silent.
const coupled = new Map();   // played key -> list of sets of notes it is holding down
const couplesFor = m => [m, ...(stops.sub ? [m - 12] : []), ...(stops.sup ? [m + 12] : [])].filter(inCompass);
export function press(m) {
  const set = couplesFor(m); set.forEach(noteOn);
  if (!coupled.has(m)) coupled.set(m, []); coupled.get(m).push(set);
}
export function release(m) {
  const st = coupled.get(m); if (!st || !st.length) return;
  st.shift().forEach(noteOff);
  if (!st.length) coupled.delete(m);
}
// Drawing or retiring a coupler moves the keys under a chord that is already held.
export function recouple() {
  for (const [m, sets] of coupled) for (const set of sets) {
    const want = couplesFor(m);
    want.forEach(n => { if (!set.includes(n)) { set.push(n); noteOn(n); } });
    [...set].forEach(n => { if (!want.includes(n)) { set.splice(set.indexOf(n), 1); noteOff(n); } });
  }
}

/* ---------- MIDI ---------- */
let midiAccess = null, sustain = false, midiBtn, midiStatus;
const midiHeld = new Set(), sustained = new Set();
const kbHeld = new Set(), ptrs = new Map();   // computer keys and pointers holding notes

/* ---------- all notes off (D18) ---------- */
// Forgets every way a note is being held (computer keys, pointers, MIDI keys
// and the sustain pedal's notes, couplers) and silences every voice. For the
// button, Escape, and MIDI all-notes-off.
export function allNotesOff() {
  kbHeld.clear(); ptrs.clear(); midiHeld.clear(); sustained.clear(); coupled.clear();
  silenceAll();
}
function setMidi(msg, cls) { midiStatus.textContent = msg; midiStatus.className = 'midi-status' + (cls ? ' ' + cls : ''); }
async function connectMidi() {
  initAudio();
  if (!navigator.requestMIDIAccess) { setMidi('This browser has no Web MIDI. Chrome, Edge, Opera and Firefox support it.', 'bad'); return; }
  setMidi('Asking for MIDI access…');
  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    midiAccess.onstatechange = bindInputs; bindInputs();
    midiBtn.textContent = 'Rescan MIDI';
  } catch (e) {
    setMidi('MIDI access was blocked. Allow MIDI devices for this site in your browser’s site settings, then try again.', 'bad');
  }
}
function bindInputs() {
  const names = [];
  midiAccess.inputs.forEach(inp => { if (inp.state !== 'disconnected') { inp.onmidimessage = onMidi; names.push(inp.name || 'MIDI input'); } });
  if (names.length) setMidi('Listening to ' + names.join(', '), 'on');
  else setMidi('No MIDI inputs found. Plug one in and it connects automatically.');
}
// Notes, CC64 sustain, CC11/CC4 expression (knee swell), CC120/123 all notes off.
function onMidi(ev) {
  const [st, d1, d2] = ev.data, cmd = st & 0xf0;
  if (cmd === 0x90 && d2 > 0) {
    if (ctx && ctx.state === 'suspended') ctx.resume();
    if (midiHeld.has(d1)) return;
    midiHeld.add(d1);
    if (sustained.has(d1)) { sustained.delete(d1); return; } // still sounding from the damper
    press(d1);
  } else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) {
    if (!midiHeld.has(d1)) return;
    midiHeld.delete(d1);
    if (sustain) sustained.add(d1); else release(d1);
  } else if (cmd === 0xB0) {
    if (d1 === 64) {
      sustain = d2 >= 64;
      if (!sustain) { sustained.forEach(release); sustained.clear(); }
    } else if (d1 === 11 || d1 === 4) {
      ctl.swell.set(Math.round(d2 / 127 * 100));
    } else if (d1 === 123 || d1 === 120) {
      allNotesOff();
    }
  }
}

export function setupKeys() {
  keysEl = document.getElementById('keys');
  buildKeys();
  new ResizeObserver(buildKeys).observe(keysEl);

  /* pointer: press, and slide across keys */
  keysEl.addEventListener('pointerdown', e => {
    const k = e.target.closest('.key'); if (!k) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;   // a right-click's menu can swallow the release
    e.preventDefault(); keysEl.setPointerCapture(e.pointerId);
    const m = +k.dataset.midi; ptrs.set(e.pointerId, m); press(m);
  });
  keysEl.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const k = el && el.closest ? el.closest('.key') : null;
    const m = k && keysEl.contains(k) ? +k.dataset.midi : null, cur = ptrs.get(e.pointerId);
    if (m !== cur) { if (cur != null) release(cur); if (m != null) press(m); ptrs.set(e.pointerId, m); }
  });
  const endPtr = e => { if (!ptrs.has(e.pointerId)) return; const m = ptrs.get(e.pointerId); if (m != null) release(m); ptrs.delete(e.pointerId); };
  keysEl.addEventListener('pointerup', endPtr); keysEl.addEventListener('pointercancel', endPtr);
  keysEl.addEventListener('lostpointercapture', endPtr);
  keysEl.addEventListener('contextmenu', e => e.preventDefault());

  /* computer keys: letter rows play, arrows and Space pump */
  let spaceSide = null;
  const releaseKeys = () => { kbHeld.forEach(id => release(noteOfKey(id))); kbHeld.clear(); };
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') { allNotesOff(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' && (e.key.startsWith('Arrow') || e.key === ' ')) return; // let sliders use arrows
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); if (!e.repeat) gateOn(e.key === 'ArrowLeft' ? ped.L : ped.R); return; }
    if (e.key === ' ') {
      if (tag === 'BUTTON') return;
      e.preventDefault(); if (e.repeat || spaceSide) return;
      spaceSide = S.lastSide === 'L' ? 'R' : 'L'; gateOn(ped[spaceSide]); return;
    }
    const id = keyId(e), m = noteOfKey(id);
    if (m !== undefined) { e.preventDefault(); if (e.repeat || kbHeld.has(id)) return; kbHeld.add(id); press(m); }
  });
  window.addEventListener('keyup', e => {
    if (e.key === 'ArrowLeft') gateOff(ped.L);
    else if (e.key === 'ArrowRight') gateOff(ped.R);
    else if (e.key === ' ' && spaceSide) { gateOff(ped[spaceSide]); spaceSide = null; }
    // A Mac sends no key-up for keys let go while Command is held, so letting go
    // of Command releases every computer key.
    if (e.key === 'Meta') { releaseKeys(); return; }
    const id = keyId(e); if (kbHeld.has(id)) { kbHeld.delete(id); release(noteOfKey(id)); }
  });
  const letGoAll = () => { releaseKeys(); gateOff(ped.L); gateOff(ped.R); spaceSide = null; };
  window.addEventListener('blur', letGoAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) letGoAll(); });

  /* the All notes off button and the keyboard compass */
  document.getElementById('panicBtn').addEventListener('click', () => { allNotesOff(); keysEl.focus?.(); });
  const compassEl = document.getElementById('compass');
  compassEl.value = S.compass;
  compassEl.addEventListener('change', () => { S.compass = compassEl.value; store.set('compass', S.compass); recouple(); });

  /* MIDI */
  midiBtn = document.getElementById('midiBtn'); midiStatus = document.getElementById('midiStatus');
  midiBtn.addEventListener('click', connectMidi);
}
