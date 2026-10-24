// The stop rail: draw knobs for each rank (per half when divided), the Vox
// Humana and the couplers, and the divided-stops selector.

import { RANKS, HALVES, SPLITS } from './core/ranks.js';
import { S, stops, store } from './state.js';
import { initAudio, applyStops } from './audio.js';
import { recouple, rebuildKeys } from './keys.js';

let stopsEl;

function knob(nm, ft, on, label, toggle, fx) {
  const b = document.createElement('button');
  b.className = 'stop' + (fx ? ' fx' : ''); b.type = 'button';
  b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.setAttribute('aria-label', label);
  b.innerHTML = `<span class="nm">${nm}</span><span class="ft">${ft}</span>`;
  b.addEventListener('click', () => { const now = toggle(); b.setAttribute('aria-pressed', now ? 'true' : 'false'); initAudio(); applyStops(); });
  return b;
}
function group(caption, knobs) {
  const g = document.createElement('div'); g.className = 'stop-group';
  if (caption) { const p = document.createElement('p'); p.className = 'group-label'; p.textContent = caption; g.appendChild(p); }
  const row = document.createElement('div'); row.className = 'stops'; knobs.forEach(k => row.appendChild(k)); g.appendChild(row);
  return g;
}
function renderStops() {
  stopsEl.innerHTML = '';
  const divided = S.splitMode !== 'none';
  stopsEl.classList.toggle('divided', divided);
  // Drawing the Vox Humana opens its controls; retiring it leaves them as they are (D25).
  const vox = knob('Vox Humana', 'tremolo', stops.vox, 'Vox Humana tremolo', () => {
    stops.vox = !stops.vox; if (stops.vox) document.getElementById('voxPanel').open = true; return stops.vox;
  }, true);
  const sub = knob('Sub Octave', 'coupler', stops.sub, 'Sub octave coupler', () => { stops.sub = !stops.sub; recouple(); return stops.sub; }, true);
  const sup = knob('Super Octave', 'coupler', stops.sup, 'Super octave coupler', () => { stops.sup = !stops.sup; recouple(); return stops.sup; }, true);
  if (!divided) {
    const ks = RANKS.map(r => knob(r.nm, r.ft, stops.treble[r.id], `${r.nm} ${r.ft}`, () => {
      const v = !stops.treble[r.id]; stops.bass[r.id] = v; stops.treble[r.id] = v; return v;
    }));
    stopsEl.appendChild(group('', [...ks, vox, sub, sup]));
    return;
  }
  HALVES.forEach(h => {
    const ks = RANKS.map(r => knob(r.nm, r.ft, stops[h][r.id], `${h === 'bass' ? 'Bass' : 'Treble'} ${r.nm} ${r.ft}`, () => (stops[h][r.id] = !stops[h][r.id])));
    stopsEl.appendChild(group(SPLITS[S.splitMode][h], ks));
  });
  stopsEl.appendChild(group('Whole keyboard', [vox, sub, sup]));
}

export function setupStops() {
  stopsEl = document.getElementById('stops');
  const splitEl = document.getElementById('split');
  splitEl.value = S.splitMode;
  splitEl.addEventListener('change', () => {
    S.splitMode = splitEl.value; store.set('split', S.splitMode);
    // undividing keeps any rank drawn in either half
    if (S.splitMode === 'none') RANKS.forEach(r => { const v = !!(stops.bass[r.id] || stops.treble[r.id]); stops.bass[r.id] = v; stops.treble[r.id] = v; });
    renderStops(); rebuildKeys(); applyStops();
  });
  renderStops();
}
