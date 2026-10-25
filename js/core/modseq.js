// The modulation sequencer (D30–D32): piano rolls of sweep shapes that move the
// treadles, Direct wind, the Vox Humana fan's speed and the knee swell in time
// with the tempo. It also pumps the organ, in place of Pedal autoplay (D32).
// Pure: no page, no audio.
//
// There is one pattern (a lane) for each thing it moves, and they play
// together. A pattern is 1–4 bars of 16th notes in the chosen time. Each row is
// a shape: a sweep up or a sweep down, along one of a few curves. A note on a
// row moves its lane's control by the lane's Amount (a share of its whole
// range) along that curve, for as long as the note lasts. Every note starts from wherever the last one left the control, so
// the movement is always continuous; between notes the control holds still. A
// sweep that reaches the top or bottom of the range stops there: sweeping up
// past the top does nothing. Each pass of the loop starts again from the
// control's own setting.

// x runs 0…1 through the note; the result runs 0…1 of the way there.
//  linear: even
//  slow:   slow start, then faster, x²
//  fast:   fast start, then settling, 1 − (1 − x)²
//  s:      slow at both ends, smoothstep
export const SEQ_CURVES = { linear: 'Linear', slow: 'Slow start', fast: 'Fast start', s: 'S-curve' };
export function seqShape(x, curve) {
  const u = Math.min(1, Math.max(0, x));
  if (curve === 'slow') return u * u;
  if (curve === 'fast') return 1 - (1 - u) * (1 - u);
  if (curve === 's') return u * u * (3 - 2 * u);
  return u;
}
// The rows, top to bottom: sweeps up, then sweeps down.
export const SEQ_ROWS = [1, -1].flatMap(dir => Object.keys(SEQ_CURVES).map(curve => ({ id: (dir > 0 ? 'up-' : 'down-') + curve, dir, curve })));
const ROW = Object.fromEntries(SEQ_ROWS.map(r => [r.id, r]));

// Time signatures. The tempo counts the beat unit: quarter notes in x/4, eighth
// notes in 6/8 (as Pedal autoplay did, D22).
export const METERS = {
  '2/4': { beats: 2, unit: 4 },
  '3/4': { beats: 3, unit: 4 },
  '4/4': { beats: 4, unit: 4 },
  '5/4': { beats: 5, unit: 4 },
  '6/8': { beats: 6, unit: 8 },
};
export const MAX_BARS = 4;
export const TEMPO_MIN = 30, TEMPO_MAX = 200;
export const stepsPerBeat = meter => 16 / METERS[meter].unit;      // 4 in x/4, 2 in 6/8
export const stepsPerBar = meter => METERS[meter].beats * stepsPerBeat(meter);
export const seqSteps = (meter, bars) => bars * stepsPerBar(meter);
export const SEQ_TRIGGERS = ['first', 'each'];

// The lanes, in order, and each one's range: the sequencer works in shares of
// the range (0…1), and Amount is a share of it too.
//  left, right: how far that treadle is pressed down, 0–100% of its stroke
//  direct:      Direct wind, 0–3.6″ on the gauge (the reservoir's pressure, 0…1)
//  fan:         the Vox Humana fan's speed, 1–12 blade passes a second, as its slider
//  swell:       the knee swell, closed to fully open
export const SEQ_TARGET_RANGE = { left: [0, 100], right: [0, 100], direct: [0, 3.6], fan: [1, 12], swell: [0, 100] };
export const SEQ_TARGETS = Object.keys(SEQ_TARGET_RANGE);
export const LANE_NAMES = { left: 'Left treadle', right: 'Right treadle', direct: 'Direct wind', fan: 'Fan speed', swell: 'Knee swell' };
// The treadle lanes are the bellows: they run all the time, from the first
// touch, as Pedal autoplay did. The others follow Starts on.
export const FREE_LANES = ['left', 'right'];
// A target's value as a share of its range, and back.
export const toShare = (target, v) => { const [lo, hi] = SEQ_TARGET_RANGE[target]; return (v - lo) / (hi - lo); };
export const fromShare = (target, s) => { const [lo, hi] = SEQ_TARGET_RANGE[target]; return lo + s * (hi - lo); };
// The Amount readout: the percentage, and what it comes to in the target's units.
export function amountText(target, pct) {
  if (pct === 0) return 'None';
  const span = SEQ_TARGET_RANGE[target][1] - SEQ_TARGET_RANGE[target][0], d = pct / 100 * span;
  if (target === 'direct') return `${pct}% · ${d.toFixed(1)}″`;
  if (target === 'fan') return `${pct}% · ${d.toFixed(1)} Hz`;
  return target === 'swell' ? `${pct}% of the swell` : `${pct}% of a stroke`;
}

// One treadle stroke lasting n 16ths: pressed quickly (a Fast start sweep up
// over the first quarter of it), then let up (a Fast start sweep down) with a
// 16th to spare when there's room. A quarter-note stroke is up for one 16th and
// down over two, which gives about the air of an autoplay stroke with the
// default foot envelope (D22).
export function stroke(start, n = 4) {
  const up = Math.max(1, Math.floor(n / 4)), down = Math.max(1, n - up - (n >= 4 ? 1 : 0));
  return [{ row: 'up-fast', start, len: up }, { row: 'down-fast', start: start + up, len: down }];
}

// The starting patterns. The treadles reproduce Pedal autoplay's default (D22):
// one bar of 4/4, right on beat 1, left on beat 2, then a half-note rest, and
// they're on. The others are off, each with a swell up and back over the bar.
const SWELL = [{ row: 'up-s', start: 0, len: 8 }, { row: 'down-s', start: 8, len: 8 }];
export const DEFAULT_SEQ = {
  meter: '4/4', bars: 1, trigger: 'first', edit: 'left',
  lanes: {
    left: { on: true, amount: 1, notes: stroke(4) },
    right: { on: true, amount: 1, notes: stroke(0) },
    direct: { on: false, amount: .25, notes: SWELL },
    fan: { on: false, amount: .25, notes: SWELL },
    swell: { on: false, amount: .25, notes: SWELL },
  },
};

// Notes kept on known rows, inside n steps, in order, and never overlapping (a
// later note that overlaps an earlier one is dropped).
function cleanNotes(src, n) {
  const notes = [];
  for (const x of [...src].filter(x => x && ROW[x.row] && Number.isInteger(x.start) && Number.isInteger(x.len)).sort((a, b) => a.start - b.start)) {
    const start = Math.max(0, x.start), end = Math.min(n, x.start + x.len);
    if (end <= start || (notes.length && start < notes[notes.length - 1].start + notes[notes.length - 1].len)) continue;
    notes.push({ row: x.row, start, len: end - start });
  }
  return notes;
}
// A pattern with every field valid; anything missing or wrong takes the default.
export function normaliseSeq(p) {
  p = p || {};
  const meter = METERS[p.meter] ? p.meter : DEFAULT_SEQ.meter;
  const bars = Number.isInteger(p.bars) && p.bars >= 1 && p.bars <= MAX_BARS ? p.bars : DEFAULT_SEQ.bars;
  const n = seqSteps(meter, bars), lanes = {};
  for (const id of SEQ_TARGETS) {
    const src = p.lanes && p.lanes[id] || {}, def = DEFAULT_SEQ.lanes[id];
    lanes[id] = {
      on: typeof src.on === 'boolean' ? src.on : def.on,
      amount: typeof src.amount === 'number' && src.amount >= 0 && src.amount <= 1 ? src.amount : def.amount,
      notes: cleanNotes(Array.isArray(src.notes) ? src.notes : def.notes, n),
    };
  }
  return {
    meter, bars, lanes,
    trigger: SEQ_TRIGGERS.includes(p.trigger) ? p.trigger : DEFAULT_SEQ.trigger,
    edit: SEQ_TARGETS.includes(p.edit) ? p.edit : DEFAULT_SEQ.edit,
  };
}

// Editing. Each returns a new list of notes (in order) and the index of the
// note it placed or changed, or −1.
// Placing a note on a step replaces whatever note covered that step, on any row:
// the control can only move one way at a time.
export function placeNote(notes, row, step) {
  const kept = notes.filter(x => step < x.start || step >= x.start + x.len);
  const out = [...kept, { row, start: step, len: 1 }].sort((a, b) => a.start - b.start);
  return { notes: out, index: out.findIndex(x => x.start === step) };
}
// Moves one end of note i to step `to`: edge 'end' stretches or shortens it
// forwards, 'start' backwards. It can't shrink below one step, pass the
// pattern's ends, or run into the notes either side of it.
export function resizeNote(notes, i, edge, to, steps) {
  const x = notes[i]; if (!x) return { notes, index: -1 };
  const prevEnd = i > 0 ? notes[i - 1].start + notes[i - 1].len : 0;
  const nextStart = i < notes.length - 1 ? notes[i + 1].start : steps;
  let start = x.start, end = x.start + x.len;
  if (edge === 'end') end = Math.min(nextStart, Math.max(start + 1, to));
  else start = Math.max(prevEnd, Math.min(end - 1, to));
  const out = notes.map((y, k) => k === i ? { ...y, start, len: end - start } : y);
  return { notes: out, index: i };
}
export const removeNote = (notes, i) => notes.filter((_, k) => k !== i);
// Where the control is at position `pos` (in steps, 0…steps) through one pass:
// `base` is the control's own setting and `amount` how far each note moves it,
// both as shares of its range (0…1). Notes are in order.
export function seqValue(notes, pos, base, amount) {
  const clamp = v => Math.min(1, Math.max(0, v));
  let v = clamp(base);
  for (const x of notes) {
    if (pos < x.start) break;
    const r = ROW[x.row], x1 = Math.min(1, (pos - x.start) / x.len);
    if (x1 < 1) return clamp(v + r.dir * amount * seqShape(x1, r.curve));
    v = clamp(v + r.dir * amount);
  }
  return v;
}

// Changing the time or the number of bars keeps what each bar had: a note
// stays at its place in its bar, and notes that no longer fit are dropped or
// shortened.
export function reshape(p, meter, bars) {
  const oldBar = stepsPerBar(p.meter), newBar = stepsPerBar(meter), lanes = {};
  for (const id of SEQ_TARGETS) {
    const notes = [];
    for (const x of p.lanes[id].notes) {
      const bar = Math.floor(x.start / oldBar), off = x.start % oldBar;
      if (bar < bars && off < newBar) notes.push({ ...x, start: bar * newBar + off });
    }
    lanes[id] = { ...p.lanes[id], notes };
  }
  return normaliseSeq({ ...p, meter, bars, lanes });
}

// Saved settings from before D32. A saved Pedal autoplay pattern becomes the
// treadle lanes: its time, bars and on/off, with a stroke for each Left or
// Right beat, a tie making that stroke longer and slower. A saved sequencer
// pattern from D30/D31 becomes the lane it moved, with its on/off and Amount
// (`amount` in percent); it was always 4/4, so it's placed bar by bar.
export function migrateSaved({ autoplay, modseq, amount }) {
  const d = JSON.parse(JSON.stringify(DEFAULT_SEQ));
  if (autoplay && METERS[autoplay.meter] && Array.isArray(autoplay.cells)) {
    d.meter = autoplay.meter;
    d.bars = Math.min(MAX_BARS, Math.max(1, Math.round(+autoplay.measures) || 1));
    const per = stepsPerBeat(d.meter), cells = autoplay.cells, notes = { L: [], R: [] };
    cells.forEach((c, i) => {
      if (c !== 'L' && c !== 'R') return;
      let len = 1; while (i + len < cells.length && cells[i + len] === '~') len++;
      notes[c].push(...stroke(i * per, len * per));
    });
    d.lanes.left = { ...d.lanes.left, notes: notes.L, on: autoplay.on !== false };
    d.lanes.right = { ...d.lanes.right, notes: notes.R, on: autoplay.on !== false };
  }
  if (modseq && SEQ_TARGET_RANGE[modseq.target || 'direct']) {
    const id = modseq.target || 'direct', oldBars = modseq.bars === 2 ? 2 : 1, bar = stepsPerBar(d.meter);
    d.bars = Math.max(d.bars, oldBars);
    const notes = (Array.isArray(modseq.notes) ? modseq.notes : []).filter(x => x && x.start % 16 < bar)
      .map(x => ({ ...x, start: Math.floor(x.start / 16) * bar + x.start % 16 }));
    d.lanes[id] = { on: !!modseq.on, amount: typeof amount === 'number' ? Math.min(1, Math.max(0, amount / 100)) : .25, notes };
    if (SEQ_TRIGGERS.includes(modseq.trigger)) d.trigger = modseq.trigger;
  }
  return normaliseSeq(d);
}

// Seconds per 16th note: the tempo counts the meter's beat unit.
export const stepSeconds = (tempo, meter) => 60 / tempo / stepsPerBeat(meter);
// The position in steps, looping, `elapsed` seconds after the pattern started.
export const seqPosition = (elapsed, tempo, meter, steps) => (Math.max(0, elapsed) / stepSeconds(tempo, meter)) % steps;
