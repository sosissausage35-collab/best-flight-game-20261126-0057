// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s
// steps (several in a slow frame, none in a fast one), and the renderer paints what is
// there. The game moves between four screens: title, play, paused and game over.
//
// ?seed=N fixes the island. ?shot=takeoff|play|approach|landed (with &seed=N) stages
// that scene instead of running the loop, paints it twice and sets window.__shotReady
// for a screenshot.
import { BEST_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import { buildScenery } from './terrain.js';
import { createWorld, EVENT_CRASH, EVENT_LANDED, EVENT_RING, EVENT_TOUCHDOWN } from './physics.js';
import { ACTION_CONFIRM, ACTION_MUTE, ACTION_PAUSE, ACTION_RESTART, ACTION_TAKEOFF, createInput } from './input.js';
import { createAudio } from './audio.js';
import { createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const random = createRandom(seed);
const world = createWorld(random);
world.state.scenery = buildScenery(random);
const renderer = createRenderer(canvas);
const audio = createAudio();

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  window.__debugState = () => {
    const s = world.state;
    return {
      screen: scene.screen, x: Math.round(s.x), y: Math.round(s.y), z: Math.round(s.z),
      speed: Math.round(s.speed), heading: Math.round((s.heading * 180) / Math.PI),
      rings: s.ringsPassed, score: s.score, fuel: Math.round(s.fuel),
      onGround: s.onGround, missionDone: s.missionDone, crash: s.crashReason || null,
    };
  };
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, scene.best, performance.now() / 1000);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();

  // Screen readers (and anyone watching the page's text) hear the screen changes.
  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    audio.unlock();
    audio.click();
    world.reset();
    world.state.scenery = buildScenery(random);
    accumulator = 0;
    screen = SCREEN_PLAY;
    announce('Flying. Take off, thread the eight rings, then land on the runway.');
  }

  function endGame() {
    screen = SCREEN_OVER;
    if (world.state.score > best) {
      best = world.state.score;
      saveBest(best);
    }
    announce(world.state.missionDone
      ? `Mission complete. Score ${world.state.score}. Best ${best}.`
      : `Crashed. ${world.state.crashReason} Score ${world.state.score}. Best ${best}.`);
  }

  input.onAction = (action) => {
    if (action === ACTION_MUTE) {
      const muted = audio.toggleMute();
      announce(muted ? 'Sound off.' : 'Sound on.');
      return;
    }
    if (action === ACTION_PAUSE && (screen === SCREEN_PLAY || screen === SCREEN_PAUSED)) {
      screen = screen === SCREEN_PLAY ? SCREEN_PAUSED : SCREEN_PLAY;
      announce(screen === SCREEN_PAUSED ? 'Paused.' : 'Flying.');
      return;
    }
    if (action === ACTION_RESTART && screen !== SCREEN_TITLE) {
      startGame();
      return;
    }
    if (action === ACTION_TAKEOFF && screen === SCREEN_PLAY && world.state.onGround) {
      input.setThrottle(1);
      world.showMessage('Full throttle — pull up to rotate!', 2.5);
      return;
    }
    if (action === ACTION_CONFIRM) {
      if (screen === SCREEN_TITLE || screen === SCREEN_OVER) startGame();
      else if (screen === SCREEN_PAUSED) screen = SCREEN_PLAY;
    }
  };
  input.onMute = () => {
    const muted = audio.toggleMute();
    announce(muted ? 'Sound off.' : 'Sound on.');
  };

  function frame(now) {
    requestAnimationFrame(frame);
    const elapsed = Math.min(MAX_FRAME, (now - last) / 1000);
    last = now;
    if (screen === SCREEN_PLAY) {
      accumulator += elapsed;
      while (accumulator >= STEP) {
        accumulator -= STEP;
        const events = world.step(STEP, input.readControl());
        if (events & EVENT_RING) audio.ring();
        if (events & EVENT_TOUCHDOWN) audio.touchdown();
        if (events & EVENT_CRASH) audio.crash();
        if (world.state.screen === 'over') {
          endGame();
          break;
        }
      }
      audio.update(world.state.throttle, world.state.speed, world.state.onGround);
    }
    renderer.draw(world.state, screen, best, now / 1000);
  }
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
