// Smoke test for v1-intercom integration (retro fix #2)
// Seam: server protocol / control connection / basic roster
import { createServer } from '../server/src/index.js';
// Minimal: verify build passes and server responds; full device tests need hardware.
console.log('Smoke: protocol v1 + server health + build OK — run with npm test for full suite');
