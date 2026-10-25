// Patches (D33): named snapshots of the organ's sound, saved in the browser and
// as files. Pure: no page, no audio, no storage.
//
// A patch's settings are a plain object, one entry per setting (see js/patches.js
// for the list). Anything a patch doesn't mention gets the factory setting when
// it's loaded, so patches saved now still load after new controls arrive.

export const PATCH_VERSION = 1;
export const FACTORY = 'Factory';           // the built-in patch: every setting at its default
export const NAME_MAX = 40;
export const FILE_APP = 'parlor-reed-organ';

// A name as typed, tidied: single spaces, trimmed, at most NAME_MAX characters.
export const cleanName = s => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

// A name not already taken (and never Factory): "Hymn", then "Hymn (2)", "Hymn (3)"…
export function uniqueName(name, taken) {
  const base = cleanName(name) || 'Untitled', used = new Set([...taken, FACTORY]);
  if (!used.has(base)) return base;
  for (let k = 2; ; k++) { const n = cleanName(`${base.slice(0, NAME_MAX - 6)} (${k})`); if (!used.has(n)) return n; }
}

// Names in menu order: alphabetical, ignoring case.
export const sortNames = names => [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }) || (a < b ? -1 : 1));

// Two sets of settings are the same if they serialise the same with their keys
// in order, however they were built.
const stable = v => Array.isArray(v) ? `[${v.map(stable).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',')}}`
  : JSON.stringify(v);
export const sameSettings = (a, b) => stable(a) === stable(b);

// The saved library, cleaned: { name: { version, settings } }, keeping only
// entries with a usable name and a settings object. Factory is never stored.
export function normaliseLibrary(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const name = cleanName(k);
    if (!name || name === FACTORY || !v || typeof v !== 'object' || !v.settings || typeof v.settings !== 'object' || Array.isArray(v.settings)) continue;
    out[name] = { version: Number.isInteger(v.version) ? v.version : PATCH_VERSION, settings: v.settings };
  }
  return out;
}

// A patch as a file, and reading one back.
export const patchFile = (name, settings) => ({ app: FILE_APP, kind: 'patch', version: PATCH_VERSION, name, settings });
export const fileName = name => (cleanName(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'patch') + '.reedorgan.json';
// Returns {name, settings}, or throws an Error whose message can be shown to the player.
export function readPatchFile(text) {
  let d;
  try { d = JSON.parse(text); } catch (e) { throw new Error('That file isn’t a patch: it can’t be read.'); }
  if (!d || d.app !== FILE_APP || d.kind !== 'patch' || !d.settings || typeof d.settings !== 'object' || Array.isArray(d.settings)) throw new Error('That file isn’t a reed organ patch.');
  if (Number.isInteger(d.version) && d.version > PATCH_VERSION) throw new Error('That patch comes from a newer version of the organ.');
  return { name: cleanName(d.name) || 'Imported patch', settings: d.settings };
}
