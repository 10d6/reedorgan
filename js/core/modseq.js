// The modulation sequencer (D30): a piano roll of sweep shapes that moves a
// control (Direct wind, for now) in time with the tempo. Pure: no page, no audio.
//
// The pattern is one or two bars of 16th notes. Each row is a shape: a sweep up
// or a sweep down, along one of a few curves. A note on a row moves the control
// by Amount (a share of its whole range) along that curve, for as long as the
// note lasts. Every note starts from wherever the last one left the control, so
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

export const STEPS_PER_BAR = 16, MAX_BARS = 2;
export const SEQ_TRIGGERS = ['first', 'each'];
export const SEQ_TARGETS = ['direct'];

// Off by default. The starting pattern is one bar that swells the wind up over
// the first half and back down over the second, so it loops smoothly.
export const DEFAULT_SEQ = {
  on: false, target: 'direct', bars: 1, trigger: 'first',
  notes: [{ row: 'up-s', start: 0, len: 8 }, { row: 'down-s', start: 8, len: 8 }],
};

export const seqSteps = bars => bars * STEPS_PER_BAR;

// A pattern with every field valid. Notes are kept on known rows, inside the
// pattern, in order, and never overlapping (a later note that overlaps an
// earlier one is dropped).
export function normaliseSeq(p) {
  const bars = p && (p.bars === 1 || p.bars === 2) ? p.bars : DEFAULT_SEQ.bars;
  const n = seqSteps(bars), src = p && Array.isArray(p.notes) ? p.notes : DEFAULT_SEQ.notes;
  const notes = [];
  for (const x of [...src].filter(x => x && ROW[x.row] && Number.isInteger(x.start) && Number.isInteger(x.len)).sort((a, b) => a.start - b.start)) {
    const start = Math.max(0, x.start), end = Math.min(n, x.start + x.len);
    if (end <= start || (notes.length && start < notes[notes.length - 1].start + notes[notes.length - 1].len)) continue;
    notes.push({ row: x.row, start, len: end - start });
  }
  return {
    on: p && typeof p.on === 'boolean' ? p.on : DEFAULT_SEQ.on,
    target: SEQ_TARGETS.includes(p && p.target) ? p.target : DEFAULT_SEQ.target,
    bars, trigger: SEQ_TRIGGERS.includes(p && p.trigger) ? p.trigger : DEFAULT_SEQ.trigger, notes,
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
// Changing between one and two bars keeps what fits.
export const setBars = (p, bars) => normaliseSeq({ ...p, bars });

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

// Seconds per 16th note: the tempo counts quarter notes.
export const stepSeconds = tempo => 60 / tempo / 4;
// The position in steps, looping, `elapsed` seconds after the pattern started.
export const seqPosition = (elapsed, tempo, steps) => (Math.max(0, elapsed) / stepSeconds(tempo)) % steps;
