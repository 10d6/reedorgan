// Patches (D33): the organ's sound saved by name, in this browser and as files.
//
// Every setting that belongs to the sound registers itself here with
// patchField() during its module's setup: a key, its factory value, and how to
// read and set it. A patch is the settings object those make. Nothing about the
// sound saves itself any more; it's saved when you save a patch. What's left
// remembered automatically is your setup and the page layout: Volume, the
// learned MIDI controls, open drawers and info explanations.
//
// Saved in localStorage: reed-patches (the library) and reed-patch (the patch
// last loaded or saved, which the organ opens with).

import { store } from './state.js';
import { PATCH_VERSION, FACTORY, cleanName, uniqueName, sortNames, sameSettings, normaliseLibrary, patchFile, fileName, readPatchFile } from './core/patches.js';

const fields = [];           // {key, def, get, set, ok, legacy}, in the order they're applied
let lib = {};                // {name: {version, settings}}
let current = FACTORY;       // the patch on show
let loaded = {};             // its settings as loaded or saved, to tell whether anything has changed
let edited = false, askMode = null;
let selEl, editedEl, msgEl, askEl, askLabel, nameEl, okEl, buttons = {};

const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));

// Registers a setting that belongs in patches. `def` is its factory value; `get`
// returns its value now (plain data); `set(v)` applies a value, updating the
// page and the sound; `ok(v)` says whether a saved value can be used (otherwise
// the factory value is); `legacy()` reads its value as saved before patches
// existed (default: the old storage key of the same name).
export function patchField(key, { def, get, set, ok = () => true, legacy }) {
  fields.push({ key, def: clone(def), get, set, ok, legacy: legacy || (() => store.get(key, undefined)) });
}

// The sound now, as a patch's settings.
export function snapshot() {
  const s = {};
  for (const f of fields) s[f.key] = clone(f.get());
  return s;
}
// Applies a patch's settings; anything missing or unusable gets the factory value.
function apply(settings) {
  for (const f of fields) {
    const has = settings && Object.prototype.hasOwnProperty.call(settings, f.key);
    let v = f.def;
    if (has) { try { if (f.ok(settings[f.key])) v = settings[f.key]; } catch (e) {} }
    f.set(clone(v));
  }
  loaded = snapshot();
  checkEdited();
}

/* ---------- the library ---------- */
const saveLib = () => store.set('patches', lib);
const remember = name => { current = name; store.set('patch', name === FACTORY ? null : name); };
function load(name) {
  const p = name !== FACTORY && lib[name];
  apply(p ? p.settings : {});
  remember(p ? name : FACTORY);
  render();
}
function saveAs(name) {
  lib[name] = { version: PATCH_VERSION, settings: snapshot() };
  saveLib(); remember(name); loaded = snapshot(); render(); checkEdited();
  say(`Saved “${name}”.`);
}

/* ---------- the patch bar ---------- */
function render() {
  selEl.replaceChildren(...[FACTORY, ...sortNames(Object.keys(lib))].map(n => new Option(n, n)));
  selEl.value = current;
  const factory = current === FACTORY;
  buttons.save.disabled = factory;          // Factory can't be overwritten: use Save as…
  buttons.rename.disabled = factory;
  buttons.del.disabled = factory;
  checkEdited();
}
function checkEdited() {
  if (!selEl) return;
  const now = !sameSettings(snapshot(), loaded);
  if (now === edited && editedEl.hidden === !now) return;
  edited = now;
  editedEl.hidden = !edited;
  buttons.revert.disabled = !edited;
}
const say = text => { msgEl.textContent = text; };

// The little name box and confirmation, used by Save as…, Rename and Delete.
function ask(mode) {
  askMode = mode;
  askEl.hidden = false;
  nameEl.hidden = mode === 'delete';
  if (mode === 'delete') { askLabel.textContent = `Delete “${current}”?`; okEl.textContent = 'Delete'; okEl.disabled = false; okEl.focus(); return; }
  askLabel.textContent = mode === 'rename' ? 'New name' : 'Save as';
  nameEl.value = mode === 'rename' || current !== FACTORY ? current : '';
  syncAsk(); nameEl.focus(); nameEl.select();
}
function syncAsk() {
  const n = cleanName(nameEl.value), taken = n in lib && n !== current;
  if (askMode === 'rename') { okEl.textContent = 'Rename'; okEl.disabled = !n || n === FACTORY || taken; }
  else { okEl.textContent = n in lib ? 'Replace' : 'Save'; okEl.disabled = !n || n === FACTORY; }
}
function closeAsk() { askEl.hidden = true; askMode = null; }
function submitAsk() {
  const mode = askMode, n = cleanName(nameEl.value);
  closeAsk();
  if (mode === 'delete') {
    const gone = current; delete lib[gone]; saveLib(); load(FACTORY); say(`Deleted “${gone}”.`); return;
  }
  if (!n || n === FACTORY) return;
  if (mode === 'rename') {
    if (n !== current && !(n in lib)) { lib[n] = lib[current]; delete lib[current]; saveLib(); remember(n); render(); say(`Renamed to “${n}”.`); }
    return;
  }
  saveAs(n);
}

function download() {
  const blob = new Blob([JSON.stringify(patchFile(current, snapshot()), null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName(current);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  say(`Downloaded “${current}”.`);
}
async function loadFile(file) {
  try {
    const { name, settings } = readPatchFile(await file.text());
    const n = uniqueName(name, Object.keys(lib));
    lib[n] = { version: PATCH_VERSION, settings }; saveLib();
    load(n); say(`Loaded “${n}” from the file.`);
  } catch (e) { say(e.message); }
}

/* ---------- before patches ---------- */
// Old automatic settings become a patch called "My settings" the first time
// this version opens, so nothing is lost, unless they come to the factory
// sound anyway (since D32 every visit saved the sequencer whether or not it was
// changed). Then they're cleared. Your setup and the page layout (Volume,
// learned MIDI controls, drawers, info) stay as they are.
const OLD_KEYS = ['autoplay', 'modseq', 'seqAmount', 'seqOpen'];
const MINE = 'My settings';
function carryOver() {
  if (store.get('patches', null) !== null) return;
  const old = {};
  for (const f of fields) { const v = f.legacy(); if (v !== undefined && v !== null) old[f.key] = v; }
  if (Object.keys(old).length) {
    apply({}); const factory = snapshot();
    apply(old); const mine = snapshot();
    if (!sameSettings(mine, factory)) { lib[MINE] = { version: PATCH_VERSION, settings: mine }; store.set('patch', MINE); }
  }
  saveLib();
  for (const k of [...fields.map(f => f.key), ...OLD_KEYS]) { try { localStorage.removeItem('reed-' + k); } catch (e) {} }
}

// Runs after every other module's setup, so every setting has registered.
export function setupPatches() {
  selEl = document.getElementById('patchSel'); editedEl = document.getElementById('patchEdited'); msgEl = document.getElementById('patchMsg');
  askEl = document.getElementById('patchAsk'); askLabel = document.getElementById('patchAskLabel'); nameEl = document.getElementById('patchName'); okEl = document.getElementById('patchOk');
  for (const [k, id] of Object.entries({ save: 'patchSave', saveAs: 'patchSaveAs', revert: 'patchRevert', rename: 'patchRename', del: 'patchDelete', download: 'patchDownload', loadFile: 'patchLoadFile' })) buttons[k] = document.getElementById(id);
  const fileEl = document.getElementById('patchFile');

  carryOver();
  lib = normaliseLibrary(store.get('patches', {}));
  const start = store.get('patch', null);
  load(start && lib[start] ? start : FACTORY);
  say('');

  selEl.addEventListener('change', () => { closeAsk(); load(selEl.value); say(''); });
  buttons.save.addEventListener('click', () => { if (current !== FACTORY) saveAs(current); });
  buttons.saveAs.addEventListener('click', () => ask('saveAs'));
  buttons.rename.addEventListener('click', () => ask('rename'));
  buttons.del.addEventListener('click', () => ask('delete'));
  buttons.revert.addEventListener('click', () => { load(current); say(`Back to “${current}” as saved.`); });
  buttons.download.addEventListener('click', download);
  buttons.loadFile.addEventListener('click', () => fileEl.click());
  fileEl.addEventListener('change', () => { if (fileEl.files[0]) loadFile(fileEl.files[0]); fileEl.value = ''; });
  nameEl.addEventListener('input', syncAsk);
  askEl.addEventListener('submit', e => { e.preventDefault(); if (!okEl.disabled) submitAsk(); });
  document.getElementById('patchCancel').addEventListener('click', closeAsk);
  askEl.addEventListener('keydown', e => { if (e.key === 'Escape') closeAsk(); });
  // Anything can change the sound (sliders, stops, the sequencer, MIDI
  // controls), so the edited mark compares the sound with the patch a few times a second.
  setInterval(checkEdited, 250);
}
