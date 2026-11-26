// The flight model and the mission: throttle, pitch and roll become speed, heading
// and altitude; rings, fuel, stalls, crashes and landings are all decided here.
import { LANDING, PLANE, RING_SCORE, RUNWAY, STEP } from './config.js';
import { buildRings, groundHeight, isWater, onRunway } from './terrain.js';

export const EVENT_RING = 1;
export const EVENT_CRASH = 2;
export const EVENT_LANDED = 4;
export const EVENT_TOUCHDOWN = 8;
export const EVENT_LOW_FUEL = 16;

export function createWorld(random) {
  const state = {
    time: 0,
    screen: 'title', // title | play | paused | over
    x: RUNWAY.x,
    y: 0,
    z: 60,
    heading: 0, // 0 = north, along +Z; grows clockwise (to the east)
    pitch: 0,
    roll: 0,
    speed: 0,
    throttle: 0,
    fuel: PLANE.fuelCapacity,
    onGround: true,
    airborne: false,
    ringsPassed: 0,
    rings: buildRings(),
    score: 0,
    crashReason: '',
    landed: false,
    missionDone: false,
    lowFuelWarned: false,
    stallWarned: false,
    message: '',
    messageUntil: 0,
    best: 0,
  };
  state.y = groundHeight(state.x, state.z);

  function reset() {
    const fresh = createWorld(random);
    Object.assign(state, fresh);
    state.rings = buildRings();
  }

  function showMessage(text, seconds) {
    state.message = text;
    state.messageUntil = state.time + seconds;
  }

  function angleTo(targetX, targetZ) {
    return Math.atan2(targetX - state.x, targetZ - state.z);
  }

  function nextTarget() {
    if (state.ringsPassed < state.rings.length) return state.rings[state.ringsPassed];
    // Home: a point past the far threshold, low — the approach is a straight run down
    // the whole strip, never a turn-around at five metres.
    return {
      x: RUNWAY.x,
      z: RUNWAY.z0 - 400,
      y: groundHeight(0, 300) + 2,
      runway: true,
    };
  }

  function normAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  // One fixed step. `control` is { pitch, roll, throttle } in -1..1 (throttle 0..1),
  // from the keyboard/mouse or from the screenshot autopilot. Returns an event mask.
  function step(dt, control) {
    let events = 0;
    state.time += dt;
    if (state.time > state.messageUntil) state.message = '';

    const targetThrottle = state.fuel <= 0 ? 0 : Math.max(0, Math.min(1, control.throttle));
    state.throttle += Math.max(-PLANE.throttleRate * dt, Math.min(PLANE.throttleRate * dt, targetThrottle - state.throttle));

    const targetSpeed = PLANE.minSpeed + state.throttle * (PLANE.maxThrottleSpeed - PLANE.minSpeed);
    const accel = state.onGround ? PLANE.groundAccel : PLANE.airAccel;
    state.speed += (targetSpeed - state.speed) * Math.min(1, accel * dt);

    const targetRoll = Math.max(-PLANE.maxRoll, Math.min(PLANE.maxRoll, control.roll * PLANE.maxRoll));
    const rollStep = PLANE.rollRate * dt;
    state.roll += Math.max(-rollStep, Math.min(rollStep, targetRoll - state.roll));

    let targetPitch = Math.max(-PLANE.maxPitch, Math.min(PLANE.maxPitch, control.pitch * PLANE.maxPitch));
    // A stalled wing cannot hold the nose up: the nose drops and the plane sinks.
    if (!state.onGround && state.speed < PLANE.stallSpeed) {
      targetPitch = Math.min(targetPitch, -0.18);
      if (!state.stallWarned) {
        state.stallWarned = true;
        showMessage('STALL — nose down, throttle up!', 2.5);
      }
    } else if (state.speed > PLANE.stallSpeed + 6) {
      state.stallWarned = false;
    }
    const pitchStep = PLANE.pitchRate * dt;
    state.pitch += Math.max(-pitchStep, Math.min(pitchStep, targetPitch - state.pitch));

    // Turn: bank right, heading swings right (east); the faster, the wider the turn.
    const turn = state.roll * PLANE.turnRate * Math.min(1, state.speed / 55);
    state.heading = normAngle(state.heading + turn * dt);

    const ground = groundHeight(state.x, state.z);
    const climb = state.onGround ? 0 : state.speed * Math.sin(state.pitch);
    let sink = 0;
    if (!state.onGround && state.speed < PLANE.stallSpeed) {
      sink = (PLANE.stallSpeed - state.speed) * 0.55;
    }

    const forward = state.onGround ? state.speed : state.speed * Math.cos(state.pitch);
    state.x += Math.sin(state.heading) * forward * dt;
    state.z += Math.cos(state.heading) * forward * dt;
    if (!state.onGround) state.y += (climb - sink) * dt;

    // Liftoff: fast enough and the nose up, the wheels leave the strip.
    if (state.onGround && state.speed > PLANE.rotateSpeed && state.pitch > 0.05) {
      state.onGround = false;
      state.airborne = true;
      state.y = ground + 1.5;
      showMessage('Airborne! Climb to the first ring.', 3);
    }

    // Fuel burns with the throttle; empty tanks mean a glide and a forced landing.
    if (state.fuel > 0) {
      state.fuel = Math.max(0, state.fuel - state.throttle * PLANE.fuelDrain * dt);
      if (state.fuel < 20 && !state.lowFuelWarned) {
        state.lowFuelWarned = true;
        showMessage('LOW FUEL — head back to the runway!', 3);
        events |= EVENT_LOW_FUEL;
      }
    }

    // Rings: fly within the hoop and it is yours.
    if (!state.onGround && state.ringsPassed < state.rings.length) {
      const ring = state.rings[state.ringsPassed];
      const dx = state.x - ring.x;
      const dy = state.y - ring.y;
      const dz = state.z - ring.z;
      if (dx * dx + dy * dy + dz * dz < (ring.radius - 2) * (ring.radius - 2)) {
        ring.passed = true;
        state.ringsPassed += 1;
        state.score += RING_SCORE;
        showMessage(`Ring ${state.ringsPassed} of ${state.rings.length}! +${RING_SCORE}`, 2.5);
        events |= EVENT_RING;
      }
    }

    // The ground arrives: a landing, a ditching, or a crash.
    const now = groundHeight(state.x, state.z);
    if (!state.onGround && state.y <= now + 0.6) {
      const sinkRate = sink - climb;
      const aligned = Math.abs(normAngle(state.heading)) < LANDING.maxHeadingError ||
        Math.abs(normAngle(state.heading - Math.PI)) < LANDING.maxHeadingError;
      const gentle = sinkRate < LANDING.maxSink && state.speed < LANDING.maxSpeed &&
        Math.abs(state.roll) < LANDING.maxRoll;
      if (onRunway(state.x, state.z) && gentle && aligned) {
        state.onGround = true;
        state.y = now;
        state.pitch = 0;
        state.roll *= 0.3;
        events |= EVENT_TOUCHDOWN;
        if (state.ringsPassed >= state.rings.length && !state.missionDone) {
          state.missionDone = true;
          state.landed = true;
          state.score += 500;
          const timeBonus = Math.max(0, Math.round((420 - state.time) * 1));
          state.score += timeBonus;
          showMessage(`MISSION COMPLETE! Landing +500, time bonus +${timeBonus}`, 6);
          events |= EVENT_LANDED;
        } else if (state.ringsPassed < state.rings.length) {
          showMessage(`Landed early — ${state.rings.length - state.ringsPassed} rings left. Press T to take off again.`, 5);
        }
      } else if (isWater(state.x, state.z)) {
        state.crashReason = 'Ditched in the river — the plane is a write-off.';
        state.screen = 'over';
        events |= EVENT_CRASH;
      } else if (sinkRate >= LANDING.maxSink || state.speed >= LANDING.maxSpeed) {
        state.crashReason = sinkRate >= LANDING.maxSink
          ? 'Came down too hard — the landing gear folded.'
          : 'Hit the ground too fast to walk away from.';
        state.screen = 'over';
        events |= EVENT_CRASH;
      } else {
        state.crashReason = 'Put down off the runway, in the rough.';
        state.screen = 'over';
        events |= EVENT_CRASH;
      }
      if (state.screen === 'over') state.y = now;
    }

    // Rolling to a stop on the strip after a good landing.
    if (state.onGround && state.airborne) {
      state.speed = Math.max(0, state.speed - 14 * dt);
      if (state.speed < 4 && state.missionDone && state.screen === 'play') {
        state.screen = 'over';
      }
    }
    // Off the edge of the island, the sea is the end of the flight.
    if (Math.abs(state.x) > 1400 || state.z < -500 || state.z > 7600) {
      state.crashReason = 'Flew off the charted island — lost at sea.';
      state.screen = 'over';
      events |= EVENT_CRASH;
    }
    return events;
  }

  return { state, reset, step, nextTarget, angleTo, normAngle, showMessage };
}
