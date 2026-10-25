// Shared helpers for the organ tests.
//
// The tests are black-box: they use the page only through what a player can
// reach (element ids, aria-labels, readouts) and through the audio it sends to
// the speakers. They never call the organ's own functions, so the same tests
// check that a refactor changes nothing.
//
// The public contract the tests rely on is documented in tests/README.md.

import { expect } from "@playwright/test";

// Runs in the page before any of its scripts.
function instrument() {
  // 1. Tap the speakers. Every AudioContext's `destination` is replaced by a
  //    pass-through gain whose output also feeds left and right analysers, so
  //    whatever the organ connects to the speakers is measured.
  const real = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, "destination").get;
  Object.defineProperty(BaseAudioContext.prototype, "destination", {
    configurable: true,
    get() {
      if (!this.__tap) {
        const out = real.call(this);
        const tap = new GainNode(this, { channelCount: 2, channelCountMode: "explicit" });
        const split = new ChannelSplitterNode(this, { numberOfOutputs: 2 });
        const L = new AnalyserNode(this, { fftSize: 1024, smoothingTimeConstant: 0 });
        const R = new AnalyserNode(this, { fftSize: 1024, smoothingTimeConstant: 0 });
        tap.connect(out); tap.connect(split); split.connect(L, 0); split.connect(R, 1);
        Object.defineProperty(tap, "maxChannelCount", { get: () => out.maxChannelCount });
        this.__tap = tap; window.__ears = { L, R, ctx: this };
      }
      return this.__tap;
    },
  });

  // 2. A fake MIDI keyboard the tests can play: window.__midi(status, d1, d2).
  const input = { name: "Test Keyboard", state: "connected", onmidimessage: null };
  window.__midi = (a, b, c) => input.onmidimessage && input.onmidimessage({ data: new Uint8Array([a, b, c]) });
  navigator.requestMIDIAccess = async () => ({ inputs: new Map([["1", input]]), onstatechange: null });

  // 3. Sampling: every 8 ms, power per band (<400 Hz, >2 kHz, all, <160 Hz) for each ear.
  const bands = (an) => {
    const f = new Float32Array(an.frequencyBinCount); an.getFloatFrequencyData(f);
    const bin = an.context.sampleRate / an.fftSize; let lo = 0, hi = 0, all = 0, sub = 0;
    for (let i = 1; i < f.length; i++) { const p = 10 ** (f[i] / 10), hz = i * bin; all += p; if (hz < 400) lo += p; else if (hz > 2000) hi += p; if (hz < 160) sub += p; }
    return [lo, hi, all, sub];
  };
  window.__sample = (ms) => new Promise((done) => {
    const frames = [], iv = setInterval(() => { const e = window.__ears; if (e) frames.push([bands(e.L), bands(e.R)]); }, 8);
    setTimeout(() => { clearInterval(iv); done(frames); }, ms);
  });
  window.__rms = () => {
    const e = window.__ears; if (!e) return 0;
    const a = new Float32Array(e.L.fftSize), b = new Float32Array(e.R.fftSize);
    e.L.getFloatTimeDomainData(a); e.R.getFloatTimeDomainData(b);
    let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i] + b[i] * b[i];
    return Math.sqrt(s / (2 * a.length));
  };
  // 4. Pitch: the fundamental of what's playing, by autocorrelation of the left
  //    ear's last 1024 samples, between lo and hi Hz. Returns [hz, clarity]
  //    (clarity 1 = perfectly periodic) or null when it's too quiet to tell.
  window.__pitch = (lo = 80, hi = 1000) => {
    const e = window.__ears; if (!e) return null;
    const x = new Float32Array(e.L.fftSize); e.L.getFloatTimeDomainData(x);
    const sr = e.ctx.sampleRate, n = x.length;
    let energy = 0; for (let i = 0; i < n; i++) energy += x[i] * x[i];
    if (Math.sqrt(energy / n) < 2e-4) return null;
    const minLag = Math.floor(sr / hi), maxLag = Math.min(n - 64, Math.ceil(sr / lo));
    const r = new Float32Array(maxLag + 2);
    for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
      let s = 0, a = 0, b = 0;
      for (let i = 0; i + lag < n; i++) { s += x[i] * x[i + lag]; a += x[i] * x[i]; b += x[i + lag] * x[i + lag]; }
      r[lag] = s / Math.sqrt(a * b || 1);
    }
    let best = minLag; for (let lag = minLag; lag <= maxLag; lag++) if (r[lag] > r[best]) best = lag;
    // the first peak nearly as strong as the best, so an octave down isn't chosen
    for (let lag = minLag; lag < best; lag++) if (r[lag] > .93 * r[best] && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) { best = lag; break; }
    const y0 = r[best - 1], y1 = r[best], y2 = r[best + 1], d = y0 - 2 * y1 + y2;
    const shift = d ? .5 * (y0 - y2) / d : 0;
    return [sr / (best + shift), y1];
  };
  // Runs `start` (a MIDI message or none), then records the pitch every ~6 ms for
  // `ms`: [[seconds since start, hz, clarity], …], skipping silent moments.
  window.__pitchTrace = (ms, msgs = [], lo, hi) => new Promise((done) => {
    const e = window.__ears, t0 = e.ctx.currentTime, out = [];
    msgs.forEach(([a, b, c]) => window.__midi(a, b, c));
    const iv = setInterval(() => { const p = window.__pitch(lo, hi); if (p) out.push([e.ctx.currentTime - t0, p[0], p[1]]); }, 6);
    setTimeout(() => { clearInterval(iv); done(out); }, ms);
  });
  // 5. The wind gauge: plays MIDI messages, then reads the needle every frame for
  //    `ms`: [[seconds, inches], …]. The needle turns 162° across the 3.6″ scale.
  window.__gaugeTrace = (ms, msgs = []) => new Promise((done) => {
    const needle = document.getElementById("needle"), out = [], t0 = performance.now();
    msgs.forEach(([a, b, c]) => window.__midi(a, b, c));
    const f = () => {
      const m = /rotate\(([-\d.]+)/.exec(needle.getAttribute("transform") || "");
      if (m) out.push([(performance.now() - t0) / 1000, (+m[1] + 90) / 162 * 3.6]);
      if (performance.now() - t0 < ms) requestAnimationFrame(f); else done(out);
    };
    requestAnimationFrame(f);
  });
  window.__centroid = () => {
    const e = window.__ears; const f = new Float32Array(e.L.frequencyBinCount); e.L.getFloatFrequencyData(f);
    const bin = e.ctx.sampleRate / e.L.fftSize; let n = 0, d = 0;
    for (let i = 1; i < f.length; i++) { const p = 10 ** (f[i] / 10); n += p * i * bin; d += p; }
    return n / d;
  };
}

// Errors that only mean the sandbox can't reach Google Fonts.
const benign = (t) => /fonts\.(googleapis|gstatic)\.com|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(t);

/** Opens the organ with test instrumentation. Returns a list that collects page errors. */
export async function openOrgan(page, { quiet = true } = {}) {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !benign(m.text())) errors.push("console: " + m.text()); });
  await page.addInitScript(instrument);
  await page.goto("/");
  await expect(page.locator("#keys .key").first()).toBeVisible();
  if (quiet) {
    // Steady wind, nothing but the reeds: makes measurements repeatable. The
    // sequencer's treadle patterns are off, because their strokes ripple the wind (D32).
    await stopPumping(page);
    for (const [id, v] of [["helper", 100], ["breathAmt", 0], ["thumpAmt", 0], ["roomAmt", 0], ["cabAmt", 0]]) await setSlider(page, id, v);
  }
  return errors;
}

/** Turns off the modulation sequencer's two treadle patterns (they pump by default, D32). */
export async function stopPumping(page) {
  for (const lane of ["left", "right"]) {
    await page.click(`#seqLanes .seq-tab[data-lane="${lane}"]`);
    if (await page.locator("#seqOn").isChecked()) await page.locator("#seqOn").uncheck();
  }
}

/** Saves the sound as a patch with Save as… (D33): settings are only kept in a saved patch. */
export async function savePatch(page, name = "Test") {
  await page.click("#patchSaveAs");
  await page.fill("#patchName", name);
  await page.click("#patchOk");
  await expect(page.locator("#patchSel")).toHaveValue(name);
}

/** Moves a slider as if the player dragged it. */
export async function setSlider(page, id, value) {
  await page.$eval("#" + id, (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }, value);
}

/** Toggles a stop by its accessible name, e.g. "Melodia 8′" or "Sub octave coupler". */
export async function toggleStop(page, label) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await focusKeys(page);
}

/** Moves focus off any control so the computer keyboard plays notes. */
export async function focusKeys(page) {
  await page.mouse.click(4, 4);
}

/** Holds computer keys (organ keys) down. Z = C3, Q = C4, N = A3, Y = A4. */
export async function hold(page, ...keys) { await focusKeys(page); for (const k of keys) await page.keyboard.down(k); }
export async function letGo(page, ...keys) { for (const k of keys) await page.keyboard.up(k); }

/** MIDI note numbers of keys drawn as pressed. */
export async function keysDown(page) {
  return page.$$eval(".key.down", (els) => els.map((e) => Number(e.dataset.midi)).sort((a, b) => a - b));
}

/** Cents from `ref` to `hz`. */
export const cents = (hz, ref) => 1200 * Math.log2(hz / ref);
/** Plays MIDI messages and traces the pitch for `ms`: [[s, hz, clarity], …]. */
export const pitchTrace = (page, ms, msgs = [], lo = 80, hi = 1000) =>
  page.evaluate(([t, m, l, h]) => window.__pitchTrace(t, m, l, h), [ms, msgs, lo, hi]);

/** Plays MIDI messages and traces the wind gauge for `ms`: [[s, inches], …]. */
export const gaugeTrace = (page, ms, msgs = []) => page.evaluate(([t, m]) => window.__gaugeTrace(t, m), [ms, msgs]);

export const readout = (page, id) => page.locator("#" + id).textContent();
export const rms = (page) => page.evaluate(() => window.__rms());
export const centroid = (page) => page.evaluate(() => window.__centroid());
export const db = (ratio) => 20 * Math.log10(ratio);

/**
 * Samples the output for `ms` and reports, per band, how much the level moves
 * (5th–95th percentile, dB) and how far the sound swings between left and right.
 */
export async function measure(page, ms = 1500) {
  const frames = await page.evaluate((t) => window.__sample(t), ms);
  const pct = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length * 0.95)] - s[Math.floor(s.length * 0.05)]; };
  const pulse = (k) => pct(frames.map(([l, r]) => 10 * Math.log10(l[k] + r[k])));
  const swing = (k) => pct(frames.map(([l, r]) => 10 * Math.log10(l[k] / r[k])));
  return { bass: pulse(0), treble: pulse(1), overall: pulse(2), bassLR: swing(0), trebleLR: swing(1), frames: frames.length };
}
