// The screenshot scenes behind ?shot=takeoff|play|approach|landed. Each one plays the
// real rules forward from a fresh world for a fixed number of steps, steered by a simple
// autopilot (point the nose at the next target, hold the throttle, flare for landing),
// so the frame is what a short game really looks like and the same seed always gives
// the same frame.
import { RUNWAY, STEP } from './config.js';
import { EVENT_CRASH, EVENT_LANDED } from './physics.js';
import { SCREEN_OVER, SCREEN_PLAY } from './render.js';
import { groundHeight } from './terrain.js';

const SAMPLE = STEP;

/** Steer toward the next ring (or the runway, once the rings are done). Exported for
 * headless testing: node can run the flight model without a browser. */
export function autopilot(state, world) {
  const target = world.nextTarget();
  // Steer at the point we want to be over: the ring, or — on the way home — the
  // centreline 400 m ahead, so the plane is lined up with the strip long before
  // it touches down. Aiming at the far threshold instead would let a lateral
  // offset survive all the way to the runway.
  let aimX = target.x;
  let aimZ = target.z;
  if (target.runway) {
    aimX = RUNWAY.x;
    aimZ = state.z - 400;
  }
  const dx = aimX - state.x;
  const dz = aimZ - state.z;
  const tdx = target.x - state.x;
  const tdz = target.z - state.z;
  const dy = target.y - state.y;
  const dist = Math.hypot(tdx, tdz);
  const wantHeading = Math.atan2(dx, dz);
  const headingError = world.normAngle(wantHeading - state.heading);
  const roll = Math.max(-1, Math.min(1, headingError * 1.6));
  // Aim the nose along the line to the target: the control is the angle over max pitch.
  const wantAngle = Math.atan2(dy, Math.max(60, dist));
  let pitch = Math.max(-1, Math.min(1, wantAngle / 0.42));
  let throttle = 0.85;
  if (target.runway) {
    // Final approach: never descend steeply enough to slam the runway.
    pitch = Math.max(pitch, -0.3);
    const heightAbove = state.y - groundHeight(state.x, state.z);
    throttle = heightAbove > 90 ? 0.5 : heightAbove > 30 ? 0.34 : 0.3;
    // Short final is measured to the strip itself, not to the far target point:
    // once close and low, hold a firm descent and bleed speed.
    const distStrip = Math.hypot(state.x - RUNWAY.x, state.z - (RUNWAY.z0 + RUNWAY.z1) / 2);
    if (distStrip < 650 && heightAbove < 30) {
      return { pitch: Math.min(pitch, -0.15), roll, throttle: 0.2 };
    }
  }
  if (state.onGround) throttle = 1;
  return { pitch, roll, throttle };
}

function flyFor(world, seconds, until) {
  const steps = Math.round(seconds / SAMPLE);
  for (let i = 0; i < steps; i += 1) {
    const events = world.step(SAMPLE, autopilot(world.state, world));
    if (until && until(world.state, events)) break;
    if (world.state.screen === 'over') break;
  }
}

/**
 * Set `world` to the named scene and return the screen to draw over it and the best
 * score to show. Names: takeoff | play | approach | landed (anything else is takeoff).
 */
export function stageShot(name, world) {
  const state = world.state;
  world.reset();
  if (name === 'play') {
    // Take off and thread the first rings: a busy mid-flight frame, ring ahead.
    flyFor(world, 46);
    return { screen: SCREEN_PLAY, best: 0 };
  }
  if (name === 'approach') {
    // Fly the whole course, then catch the plane on final approach to the strip.
    flyFor(world, 400, (s) => {
      if (s.ringsPassed < s.rings.length) return false;
      const d = Math.hypot(s.x, s.z - 300);
      return d < 900 && d > 500 && s.y < 160 && !s.onGround;
    });
    if (state.screen !== 'over') state.screen = 'play';
    return { screen: SCREEN_PLAY, best: 0 };
  }
  if (name === 'landed') {
    // Fly the whole course and land: the mission-complete frame.
    flyFor(world, 600, (s, events) => (events & EVENT_LANDED) !== 0 || (events & EVENT_CRASH) !== 0);
    if (state.missionDone) {
      // Roll out to a stop on the strip, brakes on, throttle cut.
      for (let i = 0; i < Math.round(6 / SAMPLE); i += 1) {
        world.step(SAMPLE, { pitch: 0, roll: 0, throttle: 0 });
      }
    }
    if (state.screen === 'play' && state.missionDone) state.screen = 'over';
    return { screen: SCREEN_OVER, best: state.score };
  }
  // takeoff: throttle up and rotate off the strip, caught just after liftoff while
  // the runway is still in frame.
  flyFor(world, 5);
  return { screen: SCREEN_PLAY, best: 0 };
}
