// Pedal autoplay (D22): a looping pattern of left and right treadle strokes.
// Pure: no page, no audio.
//
// The pattern is a grid with one cell per beat (the meter's beat unit). Each cell
// is a Left or Right stroke, a Rest, or a Tie that holds the note before it, so
// a half note in 4/4 is a stroke followed by a tie. The pattern loops, and a
// tie at the very start holds the last note of the loop.

export const METERS = {
  '2/4': { beats: 2, unit: 4 },
  '3/4': { beats: 3, unit: 4 },
  '4/4': { beats: 4, unit: 4 },
  '5/4': { beats: 5, unit: 4 },
  '6/8': { beats: 6, unit: 8 },
};
export const MAX_MEASURES = 4;
export const TEMPO_MIN = 30, TEMPO_MAX = 200;
export const REST = '-', LEFT = 'L', RIGHT = 'R', TIE = '~';
const CELLS = [REST, LEFT, RIGHT, TIE];

// The owner's default: one measure of 4/4 at 100 bpm, right then left quarter
// notes on beats 1 and 2, and a half-note rest.
export const DEFAULT_PATTERN = { on: true, meter: '4/4', measures: 1, cells: [RIGHT, LEFT, REST, REST] };

// Clicking a cell cycles Rest → Left → Right → Tie → Rest.
export const nextCell = c => CELLS[(CELLS.indexOf(c) + 1) % CELLS.length] || REST;

// A pattern with every field valid: known meter, 1–MAX_MEASURES measures, and
// exactly measures × beats cells, each one of the four kinds.
export function normalise(p) {
  const meter = METERS[p && p.meter] ? p.meter : DEFAULT_PATTERN.meter;
  const measures = Math.min(MAX_MEASURES, Math.max(1, Math.round(+(p && p.measures)) || 1));
  const n = measures * METERS[meter].beats;
  const src = Array.isArray(p && p.cells) ? p.cells : [];
  const cells = Array.from({ length: n }, (_, i) => CELLS.includes(src[i]) ? src[i] : REST);
  return { on: p && typeof p.on === 'boolean' ? p.on : DEFAULT_PATTERN.on, meter, measures, cells };
}

// Changes the meter or the number of measures, keeping what each measure had:
// each measure is cut or padded with rests to the new beat count, and new
// measures start as rests.
export function reshape(p, meter, measures) {
  const oldBeats = METERS[p.meter].beats, beats = METERS[meter].beats, cells = [];
  for (let m = 0; m < measures; m++) for (let b = 0; b < beats; b++) {
    cells.push(m < p.measures && b < oldBeats ? p.cells[m * oldBeats + b] : REST);
  }
  return normalise({ ...p, meter, measures, cells });
}

// Seconds per cell: the tempo counts the meter's beat unit (quarters in x/4,
// eighths in 6/8).
export const cellSeconds = tempo => 60 / tempo;

// The note sounding at time t (seconds since the pattern started): which foot,
// when its stroke started and ends (absolute seconds), and which cell the
// playhead is on. foot is null during a rest.
export function noteAt(cells, cellSec, t) {
  const n = cells.length, pos = Math.max(0, t) / cellSec, abs = Math.floor(pos), idx = abs % n;
  let back = 0;
  while (cells[(idx - back + n * 2) % n] === TIE && back < n) back++;
  const head = cells[(idx - back + n * 2) % n];
  if (back >= n || head === REST) return { foot: null, index: idx };
  let len = 1;
  while (len < n && cells[(idx - back + len + n * 2) % n] === TIE) len++;
  const start = (abs - back) * cellSec;
  return { foot: head, start, end: start + len * cellSec, index: idx };
}

// The foot comes up a moment before its stroke ends, so two strokes in a row on
// the same foot are two separate strokes: a quarter of a cell, at most 120 ms.
export const liftGap = cellSec => Math.min(.12, cellSec * .25);

// Which treadles should be held down at time t, and where the playhead is.
export function pedalsAt(cells, cellSec, t) {
  const note = noteAt(cells, cellSec, t), down = !!note.foot && t < note.end - liftGap(cellSec);
  return { L: down && note.foot === LEFT, R: down && note.foot === RIGHT, index: note.index };
}
