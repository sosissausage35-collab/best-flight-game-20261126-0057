// A small deterministic random source: the same seed always builds the same island,
// the same rings and the same clouds, so a screenshot can be reproduced exactly.
export function createRandom(seed) {
  let state = (seed >>> 0) || 1;
  function next() {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  }
  function range(min, max) {
    return min + (max - min) * next();
  }
  function int(min, max) {
    return Math.floor(range(min, max + 1));
  }
  function pick(list) {
    return list[Math.floor(next() * list.length)];
  }
  return { next, range, int, pick };
}
