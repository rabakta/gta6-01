// BRISA BAY — sound. Everything is synthesised with WebAudio: no audio
// files, no network. Radio stations are tiny step sequencers (bass, lead,
// snare, hats) over a chord root; SFX are filtered noise and oscillator
// blips. The engine hum and the police siren are continuous loops whose
// volume follows the game. The taxi fares reuse the existing SFX — blip for
// a pickup, jingle for a delivery, fail for a lost fare — so no new sounds
// were needed. The radio cycles five stations, and upgrades, roadblocks and
// pickups each have their own sting.
import { RADIO_STATIONS } from './config.js';

// Radio personality: a DJ per station, fake ads, and a talk-show host.
// Text only — the lines ride the HUD radio flash; no voice, no new audio
// engine. TALK BRISA's lines are its talk segments (host + caller).
export const RADIO_DJS = [
  { dj: 'MARINA', lines: [
    'Buenos dias, Brisa! Traffic on the bridge is a parking lot.',
    'That was Los Corales. Next: a song for everyone stuck in traffic.',
    'Caller says Jay Torres is back in town. Big if true.',
  ] },
  { dj: 'VOLT', lines: [
    'Night drive, synth loud. This one is for the midnight racers.',
    'Brisa after dark — neon, salt air, and a V8 somewhere.',
    'If your engine is louder than this song, you are winning.',
  ] },
  { dj: 'KAI', lines: [
    'Slow morning, slow waves. Coffee on the balcony, Brisa.',
    'Lo-fi for the long way home. No rush, the tide waits.',
    'Shout-out to the night-shift nurses at Coral Clinic.',
  ] },
  { dj: 'REEF', lines: [
    'Island time, island bass. The marina never sleeps, it just sways.',
    'Big love to the fishermen out before sunrise. Respect.',
    'That riddim is older than the bridge. Still slaps.',
  ] },
  { dj: 'OCE', talk: true, lines: [
    'OCE: "Is the Grand Prix rigged?" Caller, the league says no. Ask Vane.',
    'CALLER: "My bus never comes." OCE: "Walk, love. It is Brisa."',
    'OCE: Tonight — roadblocks: safety or theatre? Lines are open.',
    'CALLER: "Jay Torres owes me fifty bucks." OCE: "Join the queue."',
  ] },
];
export const RADIO_ADS = [
  'AD: Torres Tuning — engine, tyres, armour. Garage 24, Coral Row.',
  'AD: Solmar Casino — where the tide brings your luck back. 18+.',
  'AD: Marina Fish Shack — catch of the day, fried golden. Open till late.',
  'AD: BCPD reminds you: a car is not yours if the keys are in it.',
];

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

export function clampVolume(v) {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.station = 0;
    this.radioOn = true;
    this.muted = false;
    this.volume = 0.5; // master, 0..1 (pause-menu slider)
    this.radioVol = 0.8; // radio bus, 0..1 (pause-menu slider)
    this.radioGain = null;
    this.step = 0;
    this.nextStepTime = 0;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenLfo = null;
    this.started = false;
    this.lineIdx = 0; // rotating DJ line within the station
    this.line = ''; // current HUD radio line (DJ banter, ad, or talk)
    this.loopCount = 0; // completed 32-step bars on this station
    this.adSteps = 0; // steps left in an ad break (music paused)
    this.adIdx = 0;
    this.setStation(0);
  }

  // Must be called from a user gesture at least once (start button, a key).
  ensure() {
    if (this.started) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      this.radioGain = this.ctx.createGain();
      this.radioGain.gain.value = this.radioVol;
      this.radioGain.connect(this.master);
      this.started = true;
      this.nextStepTime = this.ctx.currentTime + 0.1;
    } catch (e) {
      this.started = false;
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  // Volume sliders (0..1, clamped): master drives everything, the radio
  // bus only the sequencer, so music can sit under the SFX.
  setVolume(v) {
    this.volume = clampVolume(v);
    if (this.master && !this.muted) this.master.gain.value = this.volume;
  }
  setRadioVolume(v) {
    this.radioVol = clampVolume(v);
    if (this.radioGain) this.radioGain.gain.value = this.radioVol;
  }

  setStation(i) {
    const n = RADIO_STATIONS.length;
    this.station = ((i % n) + n) % n;
    this.step = 0;
    this.loopCount = 0;
    this.adSteps = 0;
    this.lineIdx = 0;
    this.line = this.djLine();
  }

  // The line the HUD flash shows for the current station. '' while the
  // radio is off, so the flash hides instead of going stale.
  radioLine() { return this.radioOn ? this.line : ''; }

  djLine() {
    const d = RADIO_DJS[this.station];
    if (!d) return '';
    const line = d.lines[this.lineIdx % d.lines.length];
    return d.talk ? line : d.dj + ': ' + line;
  }

  // A 32-step bar just ended: rotate the DJ line, or every fourth bar
  // run an ad break (one bar of silence + a jingle + the ad line).
  onBarEnd() {
    this.loopCount++;
    if (this.radioOn && this.loopCount % 4 === 0 && !RADIO_STATIONS[this.station].talk) {
      this.adSteps = 32;
      this.line = RADIO_ADS[this.adIdx++ % RADIO_ADS.length];
      this.jingle();
      return;
    }
    this.lineIdx++;
    this.line = this.djLine();
  }

  setRadioOn(on) { this.radioOn = !!on; }
  toggleRadio() { this.radioOn = !this.radioOn; return this.radioOn; }
  stationName() { return RADIO_STATIONS[this.station].name; }

  // One sequencer step, called from the game loop with the audio clock.
  update() {
    if (!this.started || !this.ctx || this.muted) return;
    // If the tab was hidden, the clock raced ahead: snap the schedule
    // forward instead of firing a burst of stale notes at once.
    if (this.nextStepTime < this.ctx.currentTime - 0.1) {
      this.nextStepTime = this.ctx.currentTime + 0.05;
    }
    const st = RADIO_STATIONS[this.station];
    const stepDur = 60 / st.bpm / 2; // eighth notes
    while (this.nextStepTime < this.ctx.currentTime + 0.12) {
      if (this.adSteps > 0) this.adSteps--; // ad break: music paused
      else if (this.radioOn) this.playStep(st, this.step, this.nextStepTime, stepDur);
      this.step = (this.step + 1) % 32;
      if (this.step === 0) this.onBarEnd();
      this.nextStepTime += stepDur;
    }
  }

  playStep(st, step, t, stepDur) {
    const scale = st.scale;
    // Bass on beats 0, 4, 8, 12... walking the bass pattern.
    if (step % 4 === 0) {
      const note = st.root - 12 + st.bass[(step / 4 | 0) % st.bass.length];
      this.tone(midiToFreq(note), t, stepDur * 1.8, 'triangle', 0.2, this.radioGain);
    }
    // Lead: a sparse pentatonic wander, seeded by the step number.
    if (step % 2 === 0 && ((step * 2654435761) >>> 8) % 5 < 2) {
      const deg = (step * 7 + 3) % scale.length;
      const note = st.root + 12 + scale[deg];
      this.tone(midiToFreq(note), t, stepDur * 0.9, 'sine', 0.07, this.radioGain);
    }
    // Snare crack on beats 4 and 12 of the 16-step bar. Talk radio keeps
    // a soft bed only — no snare, no hats under the host.
    if (!st.talk && (step % 16 === 4 || step % 16 === 12)) this.noise(t, 0.09, 0.12, 1800, this.radioGain);
    // Hat tick on the off-beats.
    if (!st.talk && step % 2 === 1) this.noise(t, 0.03, 0.05, 6000, this.radioGain);
  }

  tone(freq, t, dur, type, vol, dest) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(dest || this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise(t, dur, vol, cutoff, dest) {
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(dest || this.master);
    src.start(t);
  }

  // --- one-shot SFX -------------------------------------------------------
  // The taxi fares reuse these: blip for a pickup, jingle for a
  // delivery, fail for a lost fare. No fare-specific sounds exist.
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

  // Two-tone car horn (KeyH while driving).
  horn() {
    if (!this.started) return;
    const t0 = this.ctx.currentTime;
    this.tone(370, t0, 0.28, 'square', 0.12);
    this.tone(466, t0, 0.28, 'square', 0.1);
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

  // A bright two-note chime when a health or armour pickup is taken.
  pickup() {
    if (!this.started) return;
    const t0 = this.ctx.currentTime;
    this.tone(880, t0, 0.1, 'sine', 0.18);
    this.tone(1319, t0 + 0.09, 0.14, 'sine', 0.18);
  }

  // A rising three-note sting when a garage upgrade is fitted.
  upgrade() {
    if (!this.started) return;
    const t0 = this.ctx.currentTime;
    [440, 554, 659].forEach((f, i) => this.tone(f, t0 + i * 0.09, 0.16, 'triangle', 0.2));
  }

  // A low two-tone alert when the BCPD sets a roadblock ahead.
  roadblock() {
    if (!this.started) return;
    const t0 = this.ctx.currentTime;
    this.tone(311, t0, 0.18, 'square', 0.12);
    this.tone(233, t0 + 0.2, 0.22, 'square', 0.12);
  }

  // A tyre screech for hard turns at speed (called with the dust).
  skid() {
    if (!this.started) return;
    this.noise(this.ctx.currentTime, 0.18, 0.1, 2400);
  }

  // --- continuous loops (engine hum, police siren) -------------------------
  startEngine() {
    if (!this.started || this.engineOsc) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = 55;
    g.gain.value = 0;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    o.connect(f);
    f.connect(g);
    g.connect(this.master);
    o.start();
    this.engineOsc = o;
    this.engineGain = g;
  }

  setEngine(speedNorm, driving) {
    if (!this.engineOsc) return;
    const t = this.ctx.currentTime;
    this.engineOsc.frequency.setTargetAtTime(52 + speedNorm * 130, t, 0.08);
    this.engineGain.gain.setTargetAtTime(driving ? 0.05 + speedNorm * 0.05 : 0, t, 0.1);
  }

  startSiren() {
    if (!this.started || this.sirenOsc) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 700;
    g.gain.value = 0;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 1.6;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain);
    lfoGain.connect(o.frequency);
    o.connect(g);
    g.connect(this.master);
    o.start();
    lfo.start();
    this.sirenOsc = o;
    this.sirenGain = g;
    this.sirenLfo = lfo;
  }

  setSiren(on, dist) {
    if (!this.sirenGain) return;
    const t = this.ctx.currentTime;
    const vol = on ? Math.max(0, 0.1 - dist * 0.0004) : 0;
    this.sirenGain.gain.setTargetAtTime(vol, t, 0.2);
  }
}
