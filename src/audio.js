// Fully synthesized cinematic score — no audio files, all original:
// sub drones, a throat-singing style voice with overtone whistles, a wordless vocal lament,
// war drums and distorted "braam" hits — plus a spatial worm, stereo sand wind, footsteps
// by surface, room echo in canyons and ruins, and mix states (pause, prescience, low water).

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
    // master tone: muffles the whole mix when paused, dreamlike in prescience
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 20000;
    this.tone.Q.value = 0.5;
    this.master.connect(this.tone).connect(comp).connect(ctx.destination);
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

    // room: slapback echo + reverb send that opens up in canyons and ruins
    this.room = ctx.createGain();
    this.room.gain.value = 0.12;
    const echo = ctx.createDelay(1);
    echo.delayTime.value = 0.27;
    const fb = ctx.createGain();
    fb.gain.value = 0.3;
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = 'lowpass';
    echoTone.frequency.value = 2400;
    this.room.connect(echo).connect(echoTone).connect(fb).connect(echo);
    echoTone.connect(this.master);
    this.room.connect(this.reverb);
    this.sfx.connect(this.room);

    this.startWind();
    this.startSandHiss();
    this.startFlutter();
    this.startDrone();
    this.startRumble();
    this.startWormVoice();
    this.startTension();
    this.nextTime = ctx.currentTime + 0.1;
    this.beatT = 0;
  }

  /* ---------- space ---------- */

  makePanner(ref = 10, rolloff = 1) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.maxDistance = 2000;
    p.rolloffFactor = rolloff;
    return p;
  }

  setNodePos(node, x, y, z) {
    const t = this.ctx.currentTime;
    if (node.positionX) {
      node.positionX.setTargetAtTime(x, t, 0.03);
      node.positionY.setTargetAtTime(y, t, 0.03);
      node.positionZ.setTargetAtTime(z, t, 0.03);
    } else node.setPosition(x, y, z);
  }

  // listener: { pos, fwd, up } plain x/y/z objects (the camera)
  setListener({ pos, fwd, up }) {
    const L = this.ctx.listener;
    this.listenerPos = pos;
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setValueAtTime(pos.x, t); L.positionY.setValueAtTime(pos.y, t); L.positionZ.setValueAtTime(pos.z, t);
      L.forwardX.setValueAtTime(fwd.x, t); L.forwardY.setValueAtTime(fwd.y, t); L.forwardZ.setValueAtTime(fwd.z, t);
      L.upX.setValueAtTime(up.x, t); L.upY.setValueAtTime(up.y, t); L.upZ.setValueAtTime(up.z, t);
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  // briefly pull the score down under a big sound
  duck(amount = 0.6, hold = 1.4) {
    const t = this.ctx.currentTime;
    this.music.gain.setTargetAtTime(0.55 * (1 - amount), t, 0.05);
    this.music.gain.setTargetAtTime(0.55, t + hold, 0.8);
  }

  /* ---------- ambience ---------- */

  // stereo hiss of sand grains riding the wind, gusting independently left and right
  startSandHiss() {
    const ctx = this.ctx;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    this.hissGain.connect(this.master);
    for (const side of [-1, 1]) {
      const n = this.noiseSrc(true);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3200 + side * 400;
      const g = ctx.createGain();
      g.gain.value = 0.5;
      const gust = ctx.createOscillator();
      gust.frequency.value = side < 0 ? 0.17 : 0.23;
      const gg = ctx.createGain();
      gg.gain.value = 0.4;
      gust.connect(gg).connect(g.gain);
      const pan = ctx.createStereoPanner();
      pan.pan.value = side * 0.8;
      n.connect(hp).connect(g).connect(pan).connect(this.hissGain);
      n.start(0, Math.random() * 1.8);
      gust.start();
    }
  }

  // the cloak snapping in the slipstream; louder the faster Ishra runs
  startFlutter() {
    const ctx = this.ctx;
    const n = this.noiseSrc(true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 320;
    bp.Q.value = 1.1;
    const am = ctx.createGain();
    am.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    lfo.frequency.value = 13;
    const lg = ctx.createGain();
    lg.gain.value = 0.45;
    lfo.connect(lg).connect(am.gain);
    this.flutterLfo = lfo;
    this.flutterGain = ctx.createGain();
    this.flutterGain.gain.value = 0;
    n.connect(bp).connect(am).connect(this.flutterGain).connect(this.sfx);
    n.start(0, Math.random() * 1.8);
    lfo.start();
  }

  // the worm in 3D: grinding sand and a hiss of grains streaming off it, at the head
  startWormVoice() {
    const ctx = this.ctx;
    this.wormPan = this.makePanner(9, 1.1);
    this.wormPan.connect(this.sfx);
    this.wormVoice = ctx.createGain();
    this.wormVoice.gain.value = 0;
    this.wormVoice.connect(this.wormPan);
    const n = this.noiseSrc(true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 240;
    bp.Q.value = 0.9;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.7;
    const lg = ctx.createGain();
    lg.gain.value = 110;
    lfo.connect(lg).connect(bp.frequency);
    n.connect(bp).connect(this.wormVoice);
    const n2 = this.noiseSrc(true);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2600;
    const hg = ctx.createGain();
    hg.gain.value = 0.3;
    n2.connect(hp).connect(hg).connect(this.wormVoice);
    n.start(0, Math.random() * 1.8);
    n2.start(0, Math.random() * 1.8);
    lfo.start();
  }

  // dissonant glassy shimmer that rises with wormsign
  startTension() {
    const ctx = this.ctx;
    this.tension = ctx.createGain();
    this.tension.gain.value = 0;
    this.tension.connect(this.music);
    this.tension.connect(this.reverb);
    const trem = ctx.createOscillator();
    trem.frequency.value = 5.5;
    const tg = ctx.createGain();
    tg.gain.value = 0.35;
    const body = ctx.createGain();
    body.gain.value = 0.65;
    trem.connect(tg).connect(body.gain);
    body.connect(this.tension);
    for (const f of [1174.7, 1244.5, 1661.2, 1760]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 14;
      o.connect(body);
      o.start();
    }
    trem.start();
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
    this.duck(0.45, 1.6);
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

  // state: speed, storm, worm (closeness), intensity, plus optional listener, wormPos, room (0..1),
  // water (0..100), sign (0..100), muffle ('paused' | 'trance' | 'dying' | null)
  update(dt, { speed = 0, storm = 0, worm = 0, intensity = 0.15, listener = null, wormPos = null, room = 0.12, water = 100, sign = 0, muffle = null }) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    this.intensity = intensity;
    this.windGain.gain.setTargetAtTime(0.04 + speed * 0.0025 + storm * 0.35, t, 0.3);
    this.windFilter.Q.value = 0.7 + storm;
    this.hissGain.gain.setTargetAtTime(0.012 + speed * 0.0006 + storm * 0.09, t, 0.4);
    this.flutterGain.gain.setTargetAtTime(Math.min(1, speed / 30) * 0.05, t, 0.2);
    this.flutterLfo.frequency.setTargetAtTime(9 + speed * 0.35, t, 0.3);
    this.rumbleGain.gain.setTargetAtTime(worm * 0.42, t, 0.15);
    this.droneFilter.Q.value = 2 + intensity * 4;
    this.room.gain.setTargetAtTime(room, t, 0.6);
    this.tension.gain.setTargetAtTime(Math.max(0, (sign - 45) / 55) * 0.035, t, 0.4);
    const cut = muffle === 'paused' ? 650 : muffle === 'trance' ? 1700 : muffle === 'dying' ? 1100 : 20000;
    this.tone.frequency.setTargetAtTime(cut, t, cut < 20000 ? 0.12 : 0.4);

    if (listener) this.setListener(listener);
    if (wormPos && worm > 0.02) {
      this.setNodePos(this.wormPan, wormPos.x, wormPos.y, wormPos.z);
      this.wormVoice.gain.setTargetAtTime(0.25 + worm * 0.9, t, 0.15);
      if (worm > 0.45 && Math.random() < dt * 1.6 * worm) this.wormClack();
    } else this.wormVoice.gain.setTargetAtTime(0, t, 0.3);

    // heartbeat when the water runs low: faster as it falls
    if (water < 28 && muffle !== 'paused') {
      this.beatT -= dt;
      if (this.beatT <= 0) {
        const k = 1 - water / 28;
        this.heartbeat(0.22 + k * 0.25);
        this.beatT = 0.95 - k * 0.38;
      }
    }
    this.schedule();
  }

  // ---------- footsteps & worm voice ----------

  // one footfall: a firm gritty tap on stone, a soft crunch on sand. pan: -1 left foot, 1 right
  footstep(surface = 'stone', speed = 20, pan = 0) {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const sp = ctx.createStereoPanner();
    sp.pan.value = pan * 0.22;
    sp.connect(this.sfx);
    const vol = (0.09 + Math.min(1, speed / 30) * 0.05) * (0.85 + Math.random() * 0.3);
    const noise = (type, freq, q, a, peak, dec) => {
      const n = this.noiseSrc();
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      this.env(g, t, a, peak, dec);
      n.connect(f).connect(g).connect(sp);
      n.start(t, Math.random() * 1.6);
      n.stop(t + a + dec + 0.05);
    };
    if (surface === 'sand') {
      noise('bandpass', 650 + Math.random() * 300, 0.8, 0.008, vol * 1.5, 0.13);
      noise('highpass', 5200, 0.7, 0.004, vol * 0.45, 0.07);
    } else {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(150 + Math.random() * 30, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.06);
      this.env(g, t, 0.002, vol * 1.3, 0.07);
      o.connect(g).connect(sp);
      o.start(t);
      o.stop(t + 0.1);
      noise('bandpass', 2300 + Math.random() * 600, 1.4, 0.001, vol, 0.035);
    }
  }

  // a wet clack of the mouth plates, from wherever the worm is
  wormClack() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this.noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900 + Math.random() * 600;
    f.Q.value = 3;
    const g = ctx.createGain();
    this.env(g, t, 0.002, 0.5, 0.07);
    n.connect(f).connect(g).connect(this.wormPan);
    n.start(t, Math.random() * 1.6);
    n.stop(t + 0.12);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110 + Math.random() * 40, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.35);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const og = ctx.createGain();
    this.env(og, t, 0.02, 0.3, 0.35);
    o.connect(lp).connect(og).connect(this.wormPan);
    o.start(t);
    o.stop(t + 0.45);
  }

  // a distant breach, heard from where it happens and arriving at the speed of sound
  breach(pos) {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const lp = this.listenerPos;
    const dist = lp ? Math.hypot(pos.x - lp.x, pos.y - lp.y, pos.z - lp.z) : 200;
    const t = ctx.currentTime + Math.min(1.2, dist / 343);
    const pan = this.makePanner(40, 0.8);
    this.setNodePos(pan, pos.x, pos.y, pos.z);
    pan.connect(this.sfx);
    pan.connect(this.reverb);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(46, t);
    o.frequency.exponentialRampToValueAtTime(24, t + 3);
    const n = this.noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(700, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 3.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1.1, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
    o.connect(f);
    n.connect(f);
    f.connect(g).connect(pan);
    o.start(t); o.stop(t + 4.1);
    n.start(t, Math.random()); n.stop(t + 4.1);
  }

  heartbeat(vol = 0.3) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    for (const [dt, v] of [[0, vol], [0.17, vol * 0.7]]) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.setValueAtTime(62, t + dt);
      o.frequency.exponentialRampToValueAtTime(38, t + dt + 0.14);
      this.env(g, t + dt, 0.006, v, 0.16);
      o.connect(g).connect(this.sfx);
      o.start(t + dt);
      o.stop(t + dt + 0.25);
    }
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

  land(surface = 'stone') {
    this.thud(surface === 'sand' ? 70 : 95, surface === 'sand' ? 0.2 : 0.28);
    this.footstep(surface, 25, 0);
  }
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
    this.duck(0.6, 1.8);
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
