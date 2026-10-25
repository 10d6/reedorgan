// Entry point. Modules only define things when they load; all the work of
// building the page happens here, in this order, once every module is ready.
// (The modules import each other in a loop, which is safe only because nothing
// runs until these setup calls.)

import { setupControls } from './controls.js';
import { setupStops } from './stops.js';
import { setupKeys } from './keys.js';
import { setupTreadles } from './treadles.js';
import { setupModSeq } from './modseq.js';
import { setupInfo } from './info.js';
import { startWindLoop } from './wind-loop.js';

setupControls();   // sliders, selects and saved settings (the sound reads these)
setupStops();      // stop rail and divided-stops selector
setupKeys();       // on-screen keyboard, computer keys, MIDI
setupTreadles();   // pedals and their envelopes
setupModSeq();     // the modulation sequencer's lanes and piano roll; it also pumps the treadles (D30–D32)
setupInfo();       // the info buttons that show and hide each section's explanations
startWindLoop();   // gauge and the per-frame wind simulation
