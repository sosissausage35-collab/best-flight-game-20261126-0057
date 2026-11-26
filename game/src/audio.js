// Sound, synthesized live with WebAudio: engine hum, wind, a ring chime, a touchdown
// thud and a crash. No audio file is loaded; everything is an oscillator.
export function createAudio() {
  let context = null;
  let engine = null;
  let engineGain = null;
  let wind = null;
  let windGain = null;
  let muted = false;

  function ensure() {
    if (context) {
      if (context.state === 'suspended') void context.resume();
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    context = new AudioContext();
    engine = context.createOscillator();
    engine.type = 'sawtooth';
    engine.frequency.value = 55;
    engineGain = context.createGain();
    engineGain.gain.value = 0;
    const engineFilter = context.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 320;
    engine.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(context.destination);
    engine.start();
    // Wind: looped noise through a band-pass filter.
    const length = context.sampleRate * 2;
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    wind = context.createBufferSource();
    wind.buffer = buffer;
    wind.loop = true;
    const windFilter = context.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 500;
    windGain = context.createGain();
    windGain.gain.value = 0;
    wind.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(context.destination);
    wind.start();
  }

  function tone(frequency, duration, type, volume, when = 0) {
    if (!context || muted) return;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, context.currentTime + when);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + when + duration);
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start(context.currentTime + when);
    osc.stop(context.currentTime + when + duration + 0.05);
  }

  return {
    unlock() { ensure(); },
    toggleMute() {
      muted = !muted;
      if (engineGain) engineGain.gain.value = 0;
      if (windGain) windGain.gain.value = 0;
      return muted;
    },
    update(throttle, speed, onGround) {
      if (!context || muted) return;
      const target = onGround ? 0.015 + throttle * 0.03 : 0.02 + throttle * 0.05;
      engineGain.gain.setTargetAtTime(target, context.currentTime, 0.1);
      engine.frequency.setTargetAtTime(48 + throttle * 55 + speed * 0.25, context.currentTime, 0.1);
      windGain.gain.setTargetAtTime(onGround ? 0 : Math.min(0.09, speed * 0.0009), context.currentTime, 0.2);
    },
    ring() {
      tone(880, 0.18, 'sine', 0.22);
      tone(1318, 0.3, 'sine', 0.18, 0.09);
    },
    touchdown() {
      tone(90, 0.25, 'sine', 0.3);
    },
    crash() {
      if (!context || muted) return;
      tone(70, 0.7, 'sawtooth', 0.3);
      tone(45, 0.9, 'square', 0.2, 0.05);
    },
    click() {
      tone(660, 0.08, 'sine', 0.15);
    },
  };
}
