// All sound is synthesised with WebAudio: engine drone, wind, ring chimes,
// touchdown thuds, stall warning and a delivery jingle. No audio files.
// The context starts only after a user gesture (see Input's gesture hook).
export class SoundBank {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engine = null;
    this.wind = null;
    this.master = null;
  }

  /** Create the context and the looping engine/wind voices. Call from a gesture. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);

    // Engine: a sawtooth through a low-pass, pitch follows the throttle.
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 62;
    const engineFilter = this.ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 420;
    const engineGain = this.ctx.createGain();
    engineGain.gain.value = 0.0;
    osc.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(this.master);
    osc.start();
    this.engine = { osc, filter: engineFilter, gain: engineGain };

    // Wind: looped white noise through a band-pass, gain follows airspeed.
    const len = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 750;
    windFilter.Q.value = 0.6;
    const windGain = this.ctx.createGain();
    windGain.gain.value = 0.0;
    noise.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(this.master);
    noise.start();
    this.wind = { gain: windGain, filter: windFilter };
  }

  /** Per-frame: engine pitch from throttle, wind from airspeed. */
  update(throttle, airspeedKts, onGround) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = 62 + throttle * 95;
    this.engine.osc.frequency.setTargetAtTime(rpm, t, 0.08);
    this.engine.filter.frequency.setTargetAtTime(380 + throttle * 700, t, 0.1);
    const engineLevel = onGround && throttle < 0.05 ? 0.0 : 0.045 + throttle * 0.075;
    this.engine.gain.gain.setTargetAtTime(engineLevel, t, 0.12);
    const windLevel = Math.min(0.16, Math.max(0, airspeedKts - 25) * 0.0016);
    this.wind.gain.gain.setTargetAtTime(windLevel, t, 0.15);
    this.wind.filter.frequency.setTargetAtTime(500 + airspeedKts * 6, t, 0.2);
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.9;
  }

  tone(freq, dur, type, level, when = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(level, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  chime() {
    this.tone(880, 0.35, 'sine', 0.22);
    this.tone(1318, 0.5, 'sine', 0.16, 0.09);
  }

  thud() {
    this.tone(72, 0.3, 'sine', 0.4);
    this.tone(50, 0.4, 'triangle', 0.25, 0.02);
  }

  beep() {
    this.tone(980, 0.12, 'square', 0.1);
  }

  jingle() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((freq, i) => this.tone(freq, 0.4, 'sine', 0.2, i * 0.11));
  }

  crashSound() {
    this.tone(90, 0.7, 'sawtooth', 0.3);
    this.tone(55, 0.9, 'sine', 0.35, 0.05);
  }
}
