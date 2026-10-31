// Fully synthesized cinematic score — no audio files, all original:
// sub drones, a throat-singing style voice with overtone whistles, a wordless vocal lament,
// war drums and distorted "braam" hits — plus desert wind, worm rumble and gameplay SFX.

// D Phrygian dominant
const HIJAZ = [293.66, 311.13, 369.99, 392.0, 440.0, 466.16, 523.25, 587.33, 622.25, 739.99];
const ROOTS = [36.71, 36.71, 29.14, 32.7];
// formant sets (Hz, Q, gain) for sung vowels
const VOWEL_AH = [[800, 9, 1], [1150, 10, 0.5], [2900, 12, 0.18]];
const VOWEL_OO = [[350, 8, 1], [600, 9, 0.35], [2400, 12, 0.08]];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    try { this.enabled = localStorage.getItem('arrakis.sound') !== 'off'; } catch { /* ignore */ }
    this.intensity = 0.15;
    this.step = 0;
    this.bar = 0;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.music = ctx.createGain();
    this.music.gain.value = 0.55;
    this.music.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);

    // reverb
    const len = ctx.sampleRate * 5.5;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    const rg = ctx.createGain();
    rg.gain.value = 0.55;
    this.reverb.connect(rg).connect(this.master);

    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    let last = 0;
    for (let i = 0; i < nd.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      nd[i] = w * 0.5 + last * 3.0;
    }
    this.noise = nb;

    this.startWind();
    this.startDrone();
    this.startRumble();
    this.nextTime = ctx.currentTime + 0.1;
  }

  setEnabled(on) {
    this.enabled = on;
    try { localStorage.setItem('arrakis.sound', on ? 'on' : 'off'); } catch { /* ignore */ }
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05);
  }

  noiseSrc(loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  startWind() {
    const ctx = this.ctx;
    const src = this.noiseSrc(true);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lg = ctx.createGain();
    lg.gain.value = 220;
    lfo.connect(lg).connect(this.windFilter.frequency);
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();
    lfo.start();
  }

  startDrone() {
    const ctx = this.ctx;
    // sub layer: felt more than heard
    this.droneOsc = [];
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 220;
    this.droneFilter.Q.value = 1.2;
    const sub = ctx.createGain();
    sub.gain.value = 0.16;
    this.droneFilter.connect(sub).connect(this.music);
    for (const [mult, det, type] of [[1, 0, 'sine'], [2, -5, 'sawtooth'], [2, 6, 'sawtooth'], [3, 0, 'triangle']]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = ROOTS[0] * mult;
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.value = mult === 1 ? 1 : 0.25;
      o.connect(g).connect(this.droneFilter);
      o.start();
      this.droneOsc.push({ o, mult });
    }
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.05;
    const sg = ctx.createGain();
    sg.gain.value = 0.06;
    swell.connect(sg).connect(sub.gain);
    swell.start();

    // throat voice: a buzzing fundamental shaped by vowel formants, with a narrow
    // overtone "whistle" that glides between harmonics
    const voice = ctx.createOscillator();
    voice.type = 'sawtooth';
    voice.frequency.value = 73.42;
    const vib = ctx.createOscillator();
    vib.frequency.value = 4.6;
    const vg = ctx.createGain();
    vg.gain.value = 0.35;
    vib.connect(vg).connect(voice.frequency);
    this.throat = ctx.createGain();
    this.throat.gain.value = 0;
    this.throatFormants = VOWEL_OO.map(([f, q, g]) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const gg = ctx.createGain();
      gg.gain.value = g * 0.9;
      voice.connect(bp).connect(gg).connect(this.throat);
      return bp;
    });
    this.whistle = ctx.createBiquadFilter();
    this.whistle.type = 'bandpass';
    this.whistle.frequency.value = 73.42 * 12;
    this.whistle.Q.value = 60;
    const wg = ctx.createGain();
    wg.gain.value = 5;
    voice.connect(this.whistle).connect(wg).connect(this.throat);
    this.throat.connect(this.music);
    this.throat.connect(this.reverb);
    voice.start();
    vib.start();
    this.voice = voice;
    this.breath = 0;
  }

  startRumble() {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 34;
    const n = this.noiseSrc(true);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 110;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    o.connect(f);
    n.connect(f);
    f.connect(this.rumbleGain).connect(this.master);
    o.start();
    n.start();
  }

  env(g, t, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }

  kick(t, vol = 1) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    this.env(g, t, 0.005, 0.7 * vol, 0.35);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + 0.45);
  }

  drum(t, freq, vol, dec = 0.2) {
    const ctx = this.ctx;
    const n = this.noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 1.4;
    const g = ctx.createGain();
    this.env(g, t, 0.003, vol, dec);
    n.connect(f).connect(g);
    g.connect(this.music);
    n.start(t, Math.random());
    n.stop(t + dec + 0.05);
  }

  // war drum: a deep skin hit with a noisy attack
  taiko(t, vol = 1) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.35);
    this.env(g, t, 0.004, 0.85 * vol, 0.7);
    o.connect(g);
    g.connect(this.music);
    g.connect(this.reverb);
    o.start(t);
    o.stop(t + 0.8);
    const n = this.noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    const ng = ctx.createGain();
    this.env(ng, t, 0.002, 0.5 * vol, 0.16);
    n.connect(f).connect(ng).connect(this.music);
    n.start(t, Math.random());
    n.stop(t + 0.25);
  }

  // wordless lament: a sung "ah" with portamento between long notes
  lament(t, notes) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.3;
    const vg = ctx.createGain();
    vib.connect(vg).connect(o.frequency);
    const out = ctx.createGain();
    out.gain.value = 0;
    for (const [f, q, g] of VOWEL_AH) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const gg = ctx.createGain();
      gg.gain.value = g * 1.6;
      o.connect(bp).connect(gg).connect(out);
    }
    out.connect(this.music);
    out.connect(this.reverb);
    let at = t;
    for (const [freq, dur] of notes) {
      o.frequency.setTargetAtTime(freq, at, 0.08);
      vg.gain.setTargetAtTime(freq * 0.012, at + dur * 0.4, 0.3);
      out.gain.setTargetAtTime(0.11, at, 0.25);
      out.gain.setTargetAtTime(0.06, at + dur * 0.85, 0.2);
      at += dur;
    }
    o.frequency.setValueAtTime(notes[0][0], t);
    out.gain.setTargetAtTime(0, at, 0.6);
    o.start(t);
    vib.start(t);
    o.stop(at + 3);
    vib.stop(at + 3);
  }

  // distorted brass-like "braam" for big moments
  braam(power = 1) {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (this.lastBraam && t - this.lastBraam < 2.5) return;
    this.lastBraam = t;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 3.5); }
    shaper.curve = curve;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 4;
    f.frequency.setValueAtTime(140, t);
    f.frequency.exponentialRampToValueAtTime(1400 * power + 300, t + 0.5);
    f.frequency.exponentialRampToValueAtTime(160, t + 3.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * power, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
    shaper.connect(f).connect(g);
    g.connect(this.music);
    g.connect(this.reverb);
    for (const [fr, det] of [[36.71, -8], [36.71, 9], [73.42, -4], [110, 6], [55, 0]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fr;
      o.detune.value = det;
      o.connect(shaper);
      o.start(t);
      o.stop(t + 3.8);
    }
    this.taiko(t, 0.9 * power);
  }

  schedule() {
    const ctx = this.ctx;
    const spb = 60 / 72 / 4; // 16th note at 72 bpm
    while (this.nextTime < ctx.currentTime + 0.15) {
      const t = this.nextTime;
      const s = this.step % 16;
      const I = this.intensity;
      if (s === 0) {
        this.bar++;
        const root = ROOTS[Math.floor(this.bar / 4) % ROOTS.length];
        for (const d of this.droneOsc) d.o.frequency.setTargetAtTime(root * d.mult, t, 1.2);
        // the throat voice breathes in long phrases
        const singing = this.bar % 4 !== 3;
        this.throat.gain.setTargetAtTime(singing ? 0.05 + I * 0.05 : 0, t, singing ? 1.4 : 0.6);
        const h = [10, 12, 9, 15, 12, 16][Math.floor(Math.random() * 6)];
        this.whistle.frequency.setTargetAtTime(73.42 * h, t + 0.5, 0.9);
        this.voice.frequency.setTargetAtTime(root * 2, t, 1.5);
        this.throatFormants[0].frequency.setTargetAtTime(Math.random() < 0.5 ? 350 : 480, t, 1.5);
        // a lament phrase every so often
        if (this.bar % 4 === 1 && Math.random() < 0.45 + I * 0.3) {
          let idx = 4 + Math.floor(Math.random() * 3);
          const notes = [];
          const count = 3 + Math.floor(Math.random() * 3);
          for (let k = 0; k < count; k++) {
            idx = Math.max(0, Math.min(HIJAZ.length - 1, idx + [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)]));
            notes.push([HIJAZ[idx], spb * (8 + Math.floor(Math.random() * 3) * 4)]);
          }
          this.lament(t + spb * 2, notes);
        }
      }
      if (I > 0.12) {
        if (s === 0 || (s === 10 && I > 0.3) || (s === 6 && I > 0.55) || (s === 13 && I > 0.75)) this.taiko(t, 0.45 + I * 0.5);
        if (I > 0.45 && (s === 4 || s === 12)) this.drum(t, 220, 0.18 * I, 0.3);
      }
      this.step++;
      this.nextTime += spb;
    }
  }

  update(dt, { speed = 0, storm = 0, worm = 0, intensity = 0.15 }) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    this.intensity = intensity;
    this.windGain.gain.setTargetAtTime(0.04 + speed * 0.0025 + storm * 0.35, t, 0.3);
    this.windFilter.Q.value = 0.7 + storm;
    this.rumbleGain.gain.setTargetAtTime(worm * 0.55, t, 0.15);
    this.droneFilter.Q.value = 2 + intensity * 4;
    this.schedule();
  }

  // ---------- SFX ----------
  ok() { return this.ctx && this.ctx.state === 'running'; }

  pickup(combo = 0) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    const base = HIJAZ[combo % 7] * 2;
    for (const [k, f] of [[0, base], [0.05, base * 1.5]]) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      this.env(g, t + k, 0.004, 0.12, 0.18);
      o.connect(g);
      g.connect(this.sfx);
      g.connect(this.reverb);
      o.start(t + k);
      o.stop(t + k + 0.25);
    }
  }

  whoosh(from, to, dur, vol = 0.25) {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this.noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.02, vol, dur);
    n.connect(f).connect(g).connect(this.sfx);
    n.start(t, Math.random());
    n.stop(t + dur + 0.1);
  }

  thump() {
    if (!this.ok()) return;
    this.kick(this.ctx.currentTime, 0.55);
    this.drum(this.ctx.currentTime, 140, 0.25, 0.18);
  }

  jump() { this.whoosh(300, 1400, 0.22, 0.22); }
  slide() { this.whoosh(1200, 200, 0.4, 0.28); }
  turn() { this.whoosh(500, 1800, 0.25, 0.18); }

  thud(freq = 70, vol = 0.6) {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(freq * 1.8, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.3);
    this.env(g, t, 0.004, vol, 0.4);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.5);
  }

  land() { this.thud(90, 0.25); }
  stumble() { this.thud(60, 0.7); this.whoosh(800, 200, 0.3, 0.35); }

  crash() {
    if (!this.ok()) return;
    this.thud(45, 1);
    this.whoosh(2000, 120, 0.9, 0.6);
  }

  shieldHit() {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const f of [880, 1244, 1661, 2217]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      this.env(g, t, 0.003, 0.08, 1.2);
      o.connect(g);
      g.connect(this.sfx);
      g.connect(this.reverb);
      o.start(t);
      o.stop(t + 1.4);
    }
  }

  powerup() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    [0, 2, 4, 7].forEach((k, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = HIJAZ[k] * 2;
      this.env(g, t + i * 0.07, 0.005, 0.14, 0.4);
      o.connect(g);
      g.connect(this.sfx);
      g.connect(this.reverb);
      o.start(t + i * 0.07);
      o.stop(t + i * 0.07 + 0.5);
    });
  }

  roar() {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(55, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 2.2);
    const n = this.noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(90, t + 2.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    o.connect(f);
    n.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    g.connect(this.reverb);
    o.start(t); o.stop(t + 2.7);
    n.start(t); n.stop(t + 2.7);
  }

  thunder() {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.2 + Math.random() * 0.6;
    const n = this.noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 160;
    const g = ctx.createGain();
    this.env(g, t, 0.05, 0.8, 2.4);
    n.connect(f).connect(g);
    g.connect(this.sfx);
    g.connect(this.reverb);
    n.start(t);
    n.stop(t + 2.6);
  }

  thopter(on) {
    if (!this.ok()) return;
    const ctx = this.ctx;
    if (on && !this.thopterNode) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 85;
      const am = ctx.createOscillator();
      am.frequency.value = 28;
      const amg = ctx.createGain();
      amg.gain.value = 0.5;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setTargetAtTime(0.12, ctx.currentTime, 0.2);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 700;
      am.connect(amg).connect(g.gain);
      o.connect(f).connect(g).connect(this.sfx);
      o.start();
      am.start();
      this.thopterNode = { o, am, g };
    } else if (!on && this.thopterNode) {
      const n = this.thopterNode;
      n.g.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      n.o.stop(ctx.currentTime + 0.8);
      n.am.stop(ctx.currentTime + 0.8);
      this.thopterNode = null;
    }
  }
}
