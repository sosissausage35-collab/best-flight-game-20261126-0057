// Tuning for Langit Run: one place for every number that shapes how the plane flies,
// how the island looks and how the mission is scored.
export const STEP = 1 / 60;
export const BEST_KEY = 'langit-run-best';
export const RING_COUNT = 8;
export const RING_RADIUS = 18;
export const RING_SCORE = 100;
export const LANDING_BONUS = 500;

// Runway: a flat strip along +Z at x = 0. Heading 0 means flying along +Z (north).
export const RUNWAY = { x: 0, z0: 0, z1: 600, halfWidth: 15, flatHalfWidth: 70 };

// Flight model (arcade, metres / seconds / radians).
export const PLANE = {
  maxThrottleSpeed: 105, // m/s at full throttle, level flight
  minSpeed: 18, // below this the wing gives up
  stallSpeed: 30, // below this, in the air, the nose drops
  rotateSpeed: 42, // speed at which the plane can lift off
  maxPitch: 0.42, // ~24 degrees
  maxRoll: 0.96, // ~55 degrees
  pitchRate: 2.2, // rad/s toward the commanded pitch
  rollRate: 3.0, // rad/s toward the commanded bank
  turnRate: 0.55, // heading change per radian of bank, scaled by speed
  throttleRate: 0.6, // throttle units per second
  fuelCapacity: 100,
  fuelDrain: 0.26, // units per second at full throttle
  groundAccel: 0.35, // how fast speed chases its target on the runway
  airAccel: 0.5, // how fast speed chases its target in the air
};

// Landing is only a landing when it is gentle, slow, level and lined up with the runway.
export const LANDING = { maxSink: 6.5, maxSpeed: 78, maxRoll: 0.28, maxHeadingError: 0.35 };

// World extents the renderer and the autopilot care about.
export const WORLD = { viewDistance: 750, sliceStep: 20, halfViewWidth: 520 };
export const CAMERA = { behind: 15, above: 4.6, lookAhead: 42 };
