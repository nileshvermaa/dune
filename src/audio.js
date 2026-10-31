// Fully synthesized soundscape: desert wind, a thumper-driven score with a Hijaz-mode
// melody, worm rumble and gameplay SFX. No audio files.

const HIJAZ = [293.66, 311.13, 369.99, 392.0, 440.0, 466.16, 523.25, 587.33, 622.25, 739.99];
const ROOTS = [73.42, 73.42, 58.27, 65.41];

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
    const len = ctx.sampleRate * 3.2;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    const rg = ctx.createGain();
    rg.gain.value = 0.45;
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
    this.droneOsc = [];
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 380;
    this.droneFilter.Q.value = 2;
    const g = ctx.createGain();
    g.gain.value = 0.09;
    this.droneFilter.connect(g);
    g.connect(this.music);
    g.connect(this.reverb);
    for (const [mult, det, type] of [[1, -6, 'sawtooth'], [1, 7, 'sawtooth'], [1.5, 0, 'triangle'], [0.5, 0, 'sine']]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = ROOTS[0] * mult;
      o.detune.value = det;
      o.connect(this.droneFilter);
      o.start();
      this.droneOsc.push({ o, mult });
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 180;
    lfo.connect(lg).connect(this.droneFilter.frequency);
    lfo.start();
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

  note(t, freq, dur, vol = 0.12) {
    const ctx = this.ctx;
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = 'triangle';
    o2.type = 'sine';
    o1.frequency.value = freq;
    o2.frequency.value = freq * 2;
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vg = ctx.createGain();
    vg.gain.value = freq * 0.006;
    vib.connect(vg);
    vg.connect(o1.frequency);
    vg.connect(o2.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.06);
    g.gain.setValueAtTime(vol, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o1.connect(f);
    o2.connect(g2).connect(f);
    f.connect(g);
    g.connect(this.music);
    g.connect(this.reverb);
    for (const o of [o1, o2, vib]) { o.start(t); o.stop(t + dur + 0.4); }
  }

  schedule() {
    const ctx = this.ctx;
    const spb = 60 / 92 / 4; // 16th note
    while (this.nextTime < ctx.currentTime + 0.15) {
      const t = this.nextTime;
      const s = this.step % 16;
      const I = this.intensity;
      if (s === 0) {
        this.bar++;
        const root = ROOTS[Math.floor(this.bar / 2) % ROOTS.length];
        for (const d of this.droneOsc) d.o.frequency.setTargetAtTime(root * d.mult, t, 0.4);
        this.phrase = Math.random() < 0.35 + I * 0.4 ? [] : null;
        this.melIdx = Math.floor(Math.random() * 5);
      }
      if (I > 0.12) {
        if (s === 0 || s === 6 || s === 8 || (I > 0.6 && s === 14)) this.kick(t, 0.6 + I * 0.4);
        if (s === 4 || s === 12) this.drum(t, 180, 0.45 * I + 0.1, 0.25);
        if (I > 0.35 && (s === 10 || (s === 15 && Math.random() < 0.5))) this.drum(t, 320, 0.3 * I, 0.12);
        if (I > 0.5 && s % 2 === 1) this.drum(t, 7000, 0.06 + I * 0.05, 0.05);
      }
      if (this.phrase && s % 2 === 0 && Math.random() < 0.42) {
        this.melIdx = Math.max(0, Math.min(HIJAZ.length - 1, this.melIdx + Math.floor(Math.random() * 5) - 2));
        const dur = spb * (Math.random() < 0.3 ? 6 : 2.5);
        this.note(t, HIJAZ[this.melIdx], dur, 0.07 + I * 0.04);
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
