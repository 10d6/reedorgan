// State shared across the instrument. Modules read and change S's fields and
// mutate `stops` and `voices` in place.

import { SPLITS } from './core/ranks.js';
import { SCOOP_MODES, SCOOP_CURVES, VIB_MODES } from './core/expression.js';

// Settings saved in this browser, under reed-<key>. Never throws.
export const store = {
  get(k, d) { try { const v = localStorage.getItem('reed-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('reed-' + k, JSON.stringify(v)); } catch (e) {} },
};
const saved = (key, def, ok) => { const v = store.get(key, def); return ok(v) ? v : def; };

export const S = {
  pressure: .5,        // reservoir, 0…1
  tonePress: .5,       // smoothed copy of pressure that drives tone
  swellPos: 0,         // where the swell lid actually is, 0…1
  reliefT: 0,          // seconds left of relief-valve venting
  lastSide: null,      // which treadle was pressed last
  started: false,      // a note has been played
  splitMode: saved('split', 'none', v => !!SPLITS[v]),
  compass: saved('compass', 'full', v => v === 'full' || v === 'organ'),
  easyWind: saved('easyWind', false, v => typeof v === 'boolean'),
  directWind: saved('directWind', false, v => typeof v === 'boolean'),
  directCC: saved('directCC', 7, v => Number.isInteger(v) && v >= 0 && v < 120),   // MIDI control for Direct wind (D27)
  toneModel: saved('toneModel', 'tilt', v => v === 'tilt' || v === 'sweep'),
  voxShape: saved('voxShape', 'sine', v => v === 'sine' || v === 'fan'),
  scoopMode: saved('scoopMode', 'top', v => SCOOP_MODES.includes(v)),        // Expression (D28)
  scoopCurve: saved('scoopCurve', 'ease', v => SCOOP_CURVES.includes(v)),
  vibMode: saved('vibMode', 'top', v => VIB_MODES.includes(v)),               // D29
  vibCC: saved('vibCC', null, v => v === null || (Number.isInteger(v) && v >= 0 && v < 120)),   // controller for Vibrato delay, none by default
  wheel: [0, 64],      // the MIDI pitch wheel's last position (LSB, MSB); centre is no bend
  reedSeed: store.get('reedSeed', 1),
};

// Each rank can be drawn separately in the bass and treble halves (divided stops).
// When stops are not divided, both halves are kept identical.
export const stops = { bass: { diapason: true, melodia: true }, treble: { diapason: true, melodia: true }, vox: false, sub: false, sup: false };

// Sounding notes: midi → {refs, oscs, envs, winds, released, half, f, m}
export const voices = new Map();

export const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const splitNote = () => SPLITS[S.splitMode].note;
export const halfOf = m => m < splitNote() ? 'bass' : 'treble';
