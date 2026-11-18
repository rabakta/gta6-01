// BRISA BAY — sound. Everything is synthesised with WebAudio: no audio
// files, no network. Radio stations are tiny step sequencers (bass, lead,
// hats) over a chord root; SFX are filtered noise and oscillator blips.
import { RADIO_STATIONS } from './config.js';

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.station = 0;
    this.radioOn = true;
    this.muted = false;
    this.step = 0;
    this.nextStepTime = 0;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.started = false;
  }

  // Must be called from a user gesture at least once (start button, key).
  ensure() {
    if (this.started) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.started = true;
      this.nextStepTime = this.ctx.currentTime + 0.1;
    } catch (e) { this.started = false; }
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  setStation(i) {
    this.station = ((i % RADIO_STATIONS.length) + RADIO_STATIONS.length) % RADIO_STATIONS.length;
    this.step = 0;
  }
  stationName() { return RADIO_STATIONS[this.station].name; }

  // One sequencer step, called from the game loop with the audio clock.
  update() {
    if (!this.started || !this.ctx || this.muted) return;
    const st = RADIO_STATIONS[this.station];
    const stepDur = 60 / st.bpm / 2; // eighth notes
    while (this.nextStepTime < this.ctx.currentTime + 0.12) {
      if (this.radioOn) this.playStep(st, this.step, this.nextStepTime, stepDur);
      this.step = (this.step + 1) % 32;
      this.nextStepTime += stepDur;
    }
  }

  playStep(st, step, t, stepDur) {
    const scale = st.scale;
    // Bass on beats 0, 4, 8, 12... walking the bass pattern.
    if (step % 4 === 0) {
      const note = st.root - 12 + st.bass[(step / 4 | 0) % st.bass.length];
      this.tone(midiToFreq(note), t, stepDur * 1.8, 'triangle', 0.20);
    }
    // Lead: a sparse pentatonic wander, seeded by the step number.
    if (step % 2 === 0 && ((step * 2654435761) >>> 8) % 5 < 2) {
      const deg = ((step * 7 + 3) % scale.length);
      const note = st.root + 12 + scale[deg];
      this.tone(midiToFreq(note), t, stepDur * 0.9, 'sine', 0.07);
    }
    // Hat tick on the off-beats.
    if (step % 2 === 1) this.noise(t, 0.03, 0.05, 6000);
  }

  tone(freq, t, dur, type, vol) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  noise(t, dur, vol, cutoff) {
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  }

  // --- one-shot SFX -------------------------------------------------------
  blip(freq = 880, dur = 0.08, vol = 0.15) {
    if (!this.started) return;
    this.tone(freq, this.ctx.currentTime, dur, 'square', vol);
  }
  gunshot() {
    if (!this.started) return;
    this.noise(this.ctx.currentTime, 0.14, 0.5, 1800);
    this.tone(140, this.ctx.currentTime, 0.1, 'sawtooth', 0.2);
  }
  crash() {
    if (!this.started) return;
    this.noise(this.ctx.currentTime, 0.25, 0.4, 900);
  }
  explosion() {
    if (!this.started) return;
    this.noise(this.ctx.currentTime, 0.7, 0.6, 500);
    this.tone(60, this.ctx.currentTime, 0.6, 'sine', 0.5);
  }
  jingle() {
    if (!this.started) return;
    const t0 = this.ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, t0 + i * 0.11, 0.16, 'triangle', 0.18));
  }
  fail() {
    if (!this.started) return;
    const t0 = this.ctx.currentTime;
    [392, 330, 262].forEach((f, i) => this.tone(f, t0 + i * 0.14, 0.2, 'sawtooth', 0.12));
  }

  // --- continuous loops (engine hum, police siren) -------------------------
  startEngine() {
    if (!this.started || this.engineOsc) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = 55;
    g.gain.value = 0.0;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 420;
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start();
    this.engineOsc = o; this.engineGain = g;
  }

  setEngine(speedNorm, driving) {
    if (!this.engineOsc) return;
    const t = this.ctx.currentTime;
    this.engineOsc.frequency.setTargetAtTime(52 + speedNorm * 130, t, 0.08);
    this.engineGain.gain.setTargetAtTime(driving ? 0.05 + speedNorm * 0.05 : 0.0, t, 0.1);
  }

  startSiren() {
    if (!this.started || this.sirenOsc) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 700;
    g.gain.value = 0.0;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 1.6;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain); lfoGain.connect(o.frequency);
    o.connect(g); g.connect(this.master);
    o.start(); lfo.start();
    this.sirenOsc = o; this.sirenGain = g; this.sirenLfo = lfo;
  }

  setSiren(on, dist) {
    if (!this.sirenGain) return;
    const t = this.ctx.currentTime;
    const vol = on ? Math.max(0, 0.10 - dist * 0.0004) : 0;
    this.sirenGain.gain.setTargetAtTime(vol, t, 0.2);
  }
}
