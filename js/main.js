// Entry point. Modules only define things when they load; all the work of
// building the page happens here, in this order, once every module is ready.
// (The modules import each other in a loop, which is safe only because nothing
// runs until these setup calls.)

import { setupControls } from './controls.js';
import { setupStops } from './stops.js';
import { setupKeys } from './keys.js';
import { setupTreadles } from './treadles.js';
import { startWindLoop } from './wind-loop.js';

setupControls();   // sliders, selects and saved settings (the sound reads these)
setupStops();      // stop rail and divided-stops selector
setupKeys();       // on-screen keyboard, computer keys, MIDI
setupTreadles();   // pedals and their envelopes
startWindLoop();   // gauge and the per-frame wind simulation
