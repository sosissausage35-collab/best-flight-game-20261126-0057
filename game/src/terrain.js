// The island: a deterministic heightfield, a river valley, a lake, farmland patches,
// a pine forest, the runway and the eight golden rings of the course.
import { RING_COUNT, RING_RADIUS, RUNWAY } from './config.js';

function smooth(x) {
  return x * x * (3 - 2 * x);
}

// Rolling hills: a few layered sine waves, flattened near the runway so the strip is level.
export function groundHeight(x, z) {
  const flat = smooth(Math.min(1, Math.max(0, (Math.abs(x) - RUNWAY.flatHalfWidth) / 220)));
  const along = smooth(Math.min(1, Math.max(0, (z - RUNWAY.z1 - 60) / 260)));
  const t = Math.min(1, Math.max(flat, along));
  let h = 0;
  h += 26 * Math.sin(x * 0.004 + 1.7) * Math.cos(z * 0.0031 - 0.6);
  h += 15 * Math.sin(x * 0.011 - z * 0.005 + 2.2);
  h += 8 * Math.sin(x * 0.027 + z * 0.019 + 0.4);
  h += 34 * Math.max(0, Math.sin(x * 0.0016 - 1.1)) * Math.cos(z * 0.0012 + 0.8);
  // A base elevation keeps the island dry: only the carved river and lake fall
  // below the waterline.
  h = Math.max(3, h + 14);
  // The river valley cuts a low channel that winds down the west side of the island.
  const riverX = riverCentre(z);
  const dRiver = Math.abs(x - riverX);
  h -= 16 * Math.max(0, 1 - dRiver / 70);
  // The lake north of the runway is below water level.
  const dLake = Math.hypot(x - 260, z - 5200);
  h -= 22 * Math.max(0, 1 - dLake / 260);
  // Dry land everywhere except the carved river and lake: the island is green,
  // not an ocean with a few fields in it.
  return Math.max(-6, h * t + 2 * (1 - t));
}

export function riverCentre(z) {
  return -190 + 130 * Math.sin(z * 0.00042 + 0.5) + 40 * Math.sin(z * 0.0013);
}

export function waterLevel() {
  return 1.5;
}

export function isWater(x, z) {
  // Water is only where the river or the lake carved it — never by height alone.
  if (Math.abs(x - riverCentre(z)) < 20 && groundHeight(x, z) < 4) return true;
  return Math.hypot(x - 260, z - 5200) < 240 && groundHeight(x, z) < 2;
}

export function onRunway(x, z) {
  return Math.abs(x - RUNWAY.x) <= RUNWAY.halfWidth && z >= RUNWAY.z0 && z <= RUNWAY.z1;
}

// Farmland patch colour: wheat, meadow, forest floor or bare hill, by patch and height.
export function groundColour(x, z, h) {
  if (isWater(x, z)) return '#3d8fd0';
  if (Math.abs(x) <= RUNWAY.flatHalfWidth + 6 && z >= RUNWAY.z0 - 40 && z <= RUNWAY.z1 + 40) {
    return '#7d9b52'; // mown grass beside the strip
  }
  const patch = Math.floor(x / 150) + Math.floor(z / 150) * 7;
  const wheat = ((patch * 2654435761) >>> 0) % 5 === 0;
  if (h > 42) return '#8a7a4e';
  if (h > 26) return '#5e8f3e';
  if (wheat) return '#a89a4e';
  return (patch & 1) === 0 ? '#69a84f' : '#5d9c46';
}

// The ring course: out along the valley, around the lake, back toward the runway.
export function buildRings() {
  const stops = [
    { x: -40, z: 1200, y: 95 },
    { x: -190, z: 1900, y: 80 },
    { x: -260, z: 2700, y: 130 },
    { x: -80, z: 3500, y: 170 },
    { x: 180, z: 4300, y: 150 },
    { x: 300, z: 5000, y: 120 },
    { x: 160, z: 5700, y: 100 },
    { x: -30, z: 6300, y: 130 },
  ];
  return stops.slice(0, RING_COUNT).map((s, i) => ({
    index: i,
    x: s.x,
    y: Math.max(s.y, groundHeight(s.x, s.z) + 45),
    z: s.z,
    radius: RING_RADIUS,
    passed: false,
  }));
}

// Scatter pines and clouds once, from the seed, so the island never changes shape.
export function buildScenery(random) {
  const trees = [];
  for (let i = 0; i < 420; i += 1) {
    const x = random.range(-700, 700);
    const z = random.range(-100, 6800);
    if (Math.abs(x) < RUNWAY.flatHalfWidth + 14 && z > RUNWAY.z0 - 60 && z < RUNWAY.z1 + 60) continue;
    if (Math.abs(x - riverCentre(z)) < 40) continue;
    const h = groundHeight(x, z);
    if (h < 3 || h > 46) continue;
    trees.push({ x, z, y: h, size: random.range(9, 17) });
  }
  const clouds = [];
  for (let i = 0; i < 26; i += 1) {
    clouds.push({
      x: random.range(-900, 900),
      y: random.range(300, 460),
      z: random.range(0, 7000),
      size: random.range(60, 150),
    });
  }
  const towns = [];
  for (let i = 0; i < 14; i += 1) {
    const x = random.pick([-1, 1]) * random.range(240, 520);
    const z = random.range(900, 6200);
    towns.push({ x, z, y: groundHeight(x, z), size: random.range(14, 26) });
  }
  return { trees, clouds, towns };
}
