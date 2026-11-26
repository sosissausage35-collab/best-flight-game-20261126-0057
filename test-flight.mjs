// Headless flight test: run the real autopilot through the whole mission in Node and
// log the flight every 5 s, so the approach and landing can be tuned without a browser.
import { createRandom } from './game/src/random.js';
import { createWorld, EVENT_CRASH, EVENT_LANDED, EVENT_RING } from './game/src/physics.js';
import { autopilot } from './game/src/shots.js';
import { groundHeight } from './game/src/terrain.js';

const world = createWorld(createRandom(1));
const s = world.state;
const dt = 1 / 60;
let t = 0;
let lastLog = -10;
let lastRing = 0;
for (let i = 0; i < 600 / dt; i += 1) {
  const events = world.step(dt, autopilot(s, world));
  t += dt;
  if (events & EVENT_RING) console.log(`t=${t.toFixed(1)} RING ${s.ringsPassed} at (${Math.round(s.x)}, ${Math.round(s.y)}, ${Math.round(s.z)}) speed ${Math.round(s.speed)}`);
  if (t - lastLog >= 5) {
    lastLog = t;
    console.log(`t=${t.toFixed(0)} pos=(${Math.round(s.x)}, ${Math.round(s.y)}, ${Math.round(s.z)}) hdg=${Math.round((s.heading * 180) / Math.PI)} pitch=${s.pitch.toFixed(2)} roll=${s.roll.toFixed(2)} spd=${Math.round(s.speed)} thr=${s.throttle.toFixed(2)} fuel=${Math.round(s.fuel)} gnd=${Math.round(groundHeight(s.x, s.z))} rings=${s.ringsPassed} ${s.onGround ? 'GROUND' : ''}`);
  }
  if (events & EVENT_LANDED) { console.log(`t=${t.toFixed(1)} LANDED score=${s.score}`); break; }
  if (events & EVENT_CRASH) { console.log(`t=${t.toFixed(1)} CRASH: ${s.crashReason} at (${Math.round(s.x)}, ${Math.round(s.y)}, ${Math.round(s.z)}) hdg=${Math.round((s.heading * 180) / Math.PI)}`); break; }
  if (s.screen === 'over') { console.log(`t=${t.toFixed(1)} screen over, missionDone=${s.missionDone}`); break; }
}
console.log(`END t=${t.toFixed(1)} pos=(${Math.round(s.x)}, ${Math.round(s.y)}, ${Math.round(s.z)}) score=${s.score} rings=${s.ringsPassed} fuel=${Math.round(s.fuel)}`);
