// Keyboard and mouse: arrows (or WASD) fly the plane, Shift/Ctrl work the throttle,
// the mouse steers by position and its wheel works the throttle, click starts the game.
export const ACTION_CONFIRM = 'confirm';
export const ACTION_PAUSE = 'pause';
export const ACTION_RESTART = 'restart';
export const ACTION_TAKEOFF = 'takeoff';
export const ACTION_MUTE = 'mute';

export function createInput(canvas) {
  const keys = new Set();
  const mouse = { x: 0.5, y: 0.5, active: false };
  let throttle = 0.55;
  let onAction = () => {};
  let onMute = () => {};

  function keyDown(event) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(event.key)) {
      event.preventDefault();
    }
    keys.add(event.key.toLowerCase());
    if (event.key === 'Enter' || event.key === ' ') onAction(ACTION_CONFIRM);
    if (event.key === 'p' || event.key === 'P' || event.key === 'Escape') onAction(ACTION_PAUSE);
    if (event.key === 'r' || event.key === 'R') onAction(ACTION_RESTART);
    if (event.key === 't' || event.key === 'T') onAction(ACTION_TAKEOFF);
    if (event.key === 'm' || event.key === 'M') onMute();
  }

  function keyUp(event) {
    keys.delete(event.key.toLowerCase());
  }

  function mouseMove(event) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (event.clientX - rect.left) / rect.width;
    mouse.y = (event.clientY - rect.top) / rect.height;
    mouse.active = true;
  }

  function mouseWheel(event) {
    event.preventDefault();
    throttle = Math.max(0, Math.min(1, throttle - Math.sign(event.deltaY) * 0.06));
  }

  function mouseDown() {
    onAction(ACTION_CONFIRM);
  }

  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  canvas.addEventListener('mousemove', mouseMove);
  canvas.addEventListener('wheel', mouseWheel, { passive: false });
  canvas.addEventListener('mousedown', mouseDown);

  // Turn the held keys (or the mouse) into a flight control for this frame.
  function readControl() {
    const up = keys.has('arrowup') || keys.has('w');
    const down = keys.has('arrowdown') || keys.has('s');
    const left = keys.has('arrowleft') || keys.has('a');
    const right = keys.has('arrowright') || keys.has('d');
    if (keys.has('shift')) throttle = Math.min(1, throttle + 0.9 / 60);
    if (keys.has('control')) throttle = Math.max(0, throttle - 0.9 / 60);

    let pitch = 0;
    let roll = 0;
    if (up) pitch += 1;
    if (down) pitch -= 1;
    if (left) roll -= 1;
    if (right) roll += 1;
    if (pitch === 0 && roll === 0 && mouse.active) {
      // Mouse steering: push the nose toward where the pointer sits.
      roll = Math.max(-1, Math.min(1, (mouse.x - 0.5) * 2.4));
      pitch = Math.max(-1, Math.min(1, (0.5 - mouse.y) * 2.0));
    }
    return { pitch, roll, throttle };
  }

  function setThrottle(value) {
    throttle = Math.max(0, Math.min(1, value));
  }

  return {
    readControl,
    setThrottle,
    set onAction(fn) { onAction = fn; },
    set onMute(fn) { onMute = fn; },
  };
}
