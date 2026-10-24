// The control loop. Once per animation frame: step the treadles, run the
// reservoir, smooth the swell and tone, push the wind into the sound, and update
// the gauge, pedals and readouts.

import { RANKS, HALVES } from './core/ranks.js';
import { GMAX, PEAK_FLOW, P_REF, gaugeInches, stepEnvelope } from './core/wind.js';
import { S, stops, voices, reduceMotion } from './state.js';
import { applyWind } from './audio.js';
import { ctl } from './controls.js';
import { ped, placeDot } from './treadles.js';

let needle, rWind, rPitch, rReeds, rUse, statusEl;
let last = performance.now(), uiT = 0;

function drawGauge() {
  const g = document.getElementById('ticks'); let s = '';
  for (let i = 0; i <= GMAX * 4; i++) {
    const v = i / 4, a = Math.PI * (1 - v / GMAX), major = i % 4 === 0;
    const r1 = major ? 70 : 76, r2 = 84;
    const x1 = 100 + r1 * Math.cos(a), y1 = 112 - r1 * Math.sin(a), x2 = 100 + r2 * Math.cos(a), y2 = 112 - r2 * Math.sin(a);
    s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#3a2416" stroke-width="${major ? 2 : 1}"/>`;
    if (major) { const xr = 100 + 58 * Math.cos(a), yr = 112 - 58 * Math.sin(a) + 4; s += `<text x="${xr.toFixed(1)}" y="${yr.toFixed(1)}" text-anchor="middle" font-family="IM Fell English SC, Georgia, serif" font-size="13" fill="#3a2416">${v}</text>`; }
  }
  g.innerHTML = s;
  const a0 = Math.PI * (1 - 3.6 / GMAX);
  document.getElementById('redzone').setAttribute('d', `M${(100 + 80 * Math.cos(a0)).toFixed(1)} ${(112 - 80 * Math.sin(a0)).toFixed(1)} A80 80 0 0 1 180 112`);
}

function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  // the swell lid swings toward the knee lever rather than jumping
  S.swellPos += (ctl.swell.value - S.swellPos) * Math.min(1, dt / .12);
  const ranksOn = { bass: 0, treble: 0 };
  HALVES.forEach(h => { ranksOn[h] = RANKS.filter(r => stops[h][r.id]).length; });
  let sounding = 0, reeds = 0;
  for (const v of voices.values()) if (!v.released) { sounding++; reeds += ranksOn[v.half]; }
  const load = reeds * (1 + .3 * S.swellPos);
  const drain = .018 + .021 * load;

  let inflow = 0;
  for (const P of [ped.L, ped.R]) {
    stepEnvelope(P, dt);
    inflow += P.lvl * PEAK_FLOW * P.boost * (1 - Math.min(1, S.pressure) * .5);
  }
  const help = ctl.helperRate();
  inflow += help * Math.max(0, Math.min(1, (.8 - S.pressure) / .12));   // helper eases off near full

  S.pressure += (inflow - drain) * dt / ctl.res.value;                    // a bigger reservoir changes more slowly
  if (S.pressure > 1) { S.pressure = 1; S.reliefT = .7; }
  S.pressure = Math.max(0, S.pressure); S.reliefT = Math.max(0, S.reliefT - dt);

  // tone follows a smoothed copy of the wind so treadle ripples don't flutter it
  S.tonePress += (S.pressure - S.tonePress) * Math.min(1, dt / ctl.toneResp.value);
  applyWind(sounding);

  needle.setAttribute('transform', `rotate(${(-90 + 180 * S.pressure * .9).toFixed(1)} 100 112)`);
  for (const P of [ped.L, ped.R]) {
    if (reduceMotion) P.el.style.filter = `brightness(${1 + P.lvl * .35})`;
    else P.el.style.transform = `perspective(400px) rotateX(${(P.lvl * 24).toFixed(1)}deg)`;
    placeDot(P);
  }

  uiT += dt;
  if (uiT > .1) {
    uiT = 0;
    rWind.textContent = gaugeInches(S.pressure).toFixed(1) + '″';
    const c = Math.round((S.pressure - P_REF) * ctl.sens.value); rPitch.textContent = (c > 0 ? '+' : c < 0 ? '−' : '') + Math.abs(c) + ' ¢';
    rReeds.textContent = reeds;
    rUse.textContent = drain.toFixed(2) + '/s';
    for (const P of [ped.L, ped.R]) {
      P.flowEl.textContent = P.stage === 'idle' ? 'idle' : ({ a: 'attack', d: 'decay', s: 'sustain', r: 'release' }[P.stage]) + ' · ' + (P.lvl * PEAK_FLOW * P.boost).toFixed(2) + '/s';
    }
    let msg = '', ok = false;
    if (!S.started) { msg = 'Press a key to start'; ok = true; }
    else if (S.reliefT > 0) msg = 'Relief valve venting';
    else if (S.pressure < .05 && sounding) msg = 'Out of wind. Pump!';
    else if (S.pressure < .2) msg = 'Wind is low';
    else if (help > 0 && help < drain && sounding && inflow < drain) msg = 'Helper can’t keep up; wind falling';
    else { msg = help > 0 ? 'Helper pumping' : 'Keep pumping to hold the wind'; ok = true; }
    statusEl.textContent = msg; statusEl.classList.toggle('ok', ok);
  }
  requestAnimationFrame(frame);
}

export function startWindLoop() {
  const $ = id => document.getElementById(id);
  drawGauge();
  needle = $('needle'); rWind = $('rWind'); rPitch = $('rPitch'); rReeds = $('rReeds'); rUse = $('rUse'); statusEl = $('status');
  last = performance.now();
  requestAnimationFrame(frame);
}
