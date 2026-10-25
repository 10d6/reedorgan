// The stop rail: draw knobs for each rank (per half when divided), the Vox
// Humana and the couplers, and the divided-stops selector.

import { RANKS, HALVES, SPLITS } from './core/ranks.js';
import { S, stops, store } from './state.js';
import { initAudio, applyStops } from './audio.js';
import { recouple, rebuildKeys } from './keys.js';
import { patchField } from './patches.js';

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

// Draws the Vox Humana stop, as clicking it would (the modulation sequencer
// does this when it's set to move the fan, D31).
export function drawVox() {
  if (stops.vox) return;
  stops.vox = true; document.getElementById('voxPanel').open = true;
  renderStops(); initAudio(); applyStops();
}

export function setupStops() {
  stopsEl = document.getElementById('stops');
  const splitEl = document.getElementById('split');
  const setSplit = v => {
    S.splitMode = v; splitEl.value = v;
    // undividing keeps any rank drawn in either half
    if (S.splitMode === 'none') RANKS.forEach(r => { const on = !!(stops.bass[r.id] || stops.treble[r.id]); stops.bass[r.id] = on; stops.treble[r.id] = on; });
    renderStops(); rebuildKeys(); applyStops();
  };
  splitEl.value = S.splitMode;
  splitEl.addEventListener('change', () => setSplit(splitEl.value));
  renderStops();
  // Patches (D33) hold the divided-stops setting, then the drawn stops and couplers.
  patchField('split', { def: 'none', get: () => S.splitMode, set: setSplit, ok: v => !!SPLITS[v] });
  const half = h => Object.fromEntries(RANKS.map(r => [r.id, !!stops[h][r.id]]));
  const factory = { bass: { ...half('bass') }, treble: { ...half('treble') }, vox: false, sub: false, sup: false };
  patchField('stops', {
    def: factory,
    get: () => ({ bass: half('bass'), treble: half('treble'), vox: !!stops.vox, sub: !!stops.sub, sup: !!stops.sup }),
    set: v => {
      for (const h of HALVES) RANKS.forEach(r => { stops[h][r.id] = !!(v[h] && v[h][r.id]); });
      if (S.splitMode === 'none') RANKS.forEach(r => { stops.treble[r.id] = stops.bass[r.id]; });
      stops.vox = !!v.vox; stops.sub = !!v.sub; stops.sup = !!v.sup;
      renderStops(); applyStops(); recouple();
    },
    ok: v => !!v && typeof v === 'object' && !!v.bass && !!v.treble,
    legacy: () => undefined,   // stops were never saved before patches
  });
}
