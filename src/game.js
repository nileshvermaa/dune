import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { clamp, damp, angleDamp, smoothstep, lerp } from './noise.js';
import { initProps, mats, tex, makeOrnithopter } from './props.js';
import { Terrain, SAND_BED } from './terrain.js';
import { Track, LANE_W, DECK_HALF, YAWS, speedAt } from './track.js';
import { Sky, installHeightFog } from './sky.js';
import { Runner } from './player.js';
import { ChaserWorm, BreachWorm, DevourWorm } from './worm.js';
import { DustField, ParticlePool, StormWall, SandMound } from './effects.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { ZONES, zoneAt, distToZone } from './zones.js';
import { BEATS, DEATHS, INTRO, chapterFor, roman, saying, waypointAt } from './story.js';
import { makeThumper } from './props.js';
import { loadPhotoTextures, updatePhotoTextures } from './materials.js';
import { loadRunnerRig } from './rig.js';

const ZONE_LABELS = ['Erg', 'Wall', 'Sietch', 'Spice', 'Storm'];
const INTRO_SHOT = 4.6; // seconds per story card / camera shot in the opening
// how much the land throws sound back: canyon walls and ruins echo, open sand swallows it
const ROOM = { desert: 0.12, shieldwall: 0.65, ruins: 0.55, spice: 0.2, storm: 0.06 };

const GRAVITY = 40;
const JUMP_V = 13.2;
const SLIDE_TIME = 0.8;
const TRANCE_TIME = 7;
const RIDE_TIME = 14;
const RIDE_OFFSET = -12.5;
const THOPTER_TIME = 7.5;
const FLY_H = 7;
const UP = new THREE.Vector3(0, 1, 0);
const isTouch = matchMedia('(pointer: coarse)').matches;

const MILESTONES = [
  [500, 'The desert notices you'], [1000, 'A true sandwalker'], [2000, 'Fremen pace'],
  [3500, 'The sietch speaks your name'], [5000, 'Rider of the deep desert'], [7500, 'Legend of the dunes'], [10000, 'Beyond the Shield Wall of legend'],
];

const $ = (id) => document.getElementById(id);

// Final display-space grade: gentle S-curve, warm highlights / cool shadows, film grain.
// Heat shimmer around the horizon band on hot, clear days.
const SHIMMER = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAmt: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uAmt; varying vec2 vUv;
    void main() {
      // heat haze only on the far horizon band, well above the runner and the road ahead
      float band = smoothstep(0.5, 0.57, vUv.y) * (1.0 - smoothstep(0.62, 0.7, vUv.y));
      float o = sin(vUv.y * 230.0 + uTime * 4.0) * 0.00035 + sin(vUv.y * 97.0 - uTime * 2.5 + vUv.x * 31.0) * 0.00025;
      gl_FragColor = texture2D(tDiffuse, vUv + vec2(o, o * 0.4) * band * uAmt);
    }`,
};

// Crepuscular rays: march from each pixel toward the sun's screen position, gathering the
// bright sky near the sun, so dunes, ruins and the runner cut shafts through the haze.
const SUNSHAFTS = {
  uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.7) }, uStrength: { value: 0 }, uColor: { value: new THREE.Color(1, 0.8, 0.55) } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uStrength; uniform vec3 uColor; varying vec2 vUv;
    float bright(vec2 uv) {
      vec3 c = texture2D(tDiffuse, uv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      return smoothstep(0.85, 2.0, l) * exp(-length((uv - uSun) * vec2(1.6, 1.0)) * 2.2);
    }
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uStrength <= 0.001) { gl_FragColor = base; return; }
      vec2 step = (vUv - uSun) / 40.0 * 0.9;
      vec2 uv = vUv;
      float decay = 1.0, acc = 0.0;
      float dither = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
      uv -= step * dither;
      for (int i = 0; i < 40; i++) {
        uv -= step;
        acc += bright(uv) * decay;
        decay *= 0.955;
      }
      gl_FragColor = vec4(base.rgb + uColor * acc * (uStrength / 40.0) * 5.0, base.a);
    }`,
};

const GRADE = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uWarm: { value: 1 }, uNight: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uWarm; uniform float uNight; varying vec2 vUv;
    void main() {
      // faint lens fringing toward the frame edges
      vec2 dc = vUv - 0.5;
      float ca = dot(dc, dc) * 0.006;
      vec3 c = vec3(texture2D(tDiffuse, vUv + dc * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - dc * ca).b);
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.28);
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      vec3 mono = l * mix(vec3(1.08, 0.96, 0.8), vec3(0.78, 0.9, 1.08), uNight);
      c = mix(mono, c, mix(0.62, 0.5, uNight));
      c = c * 0.93 + vec3(0.035, 0.03, 0.028);
      c += uWarm * (vec3(0.025, 0.008, -0.02) * smoothstep(0.45, 1.0, l) + vec3(-0.008, 0.0, 0.018) * (1.0 - smoothstep(0.0, 0.35, l)));
      float n = fract(sin(dot(vUv * 1000.0 + fract(uTime) * 91.0, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * 0.022;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export class Game {
  constructor(app) {
    this.app = app;
    installHeightFog();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    app.prepend(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 3000);

    initProps();
    loadPhotoTextures(this.renderer);
    this.terrain = new Terrain(this.scene, []);
    this.track = new Track(this.scene, this.terrain);
    this.sky = new Sky(this.scene);
    this.runner = new Runner();
    this.scene.add(this.runner.root);
    // footfalls come from the animated feet; sand crunches, stone taps
    this.runner.onStep = (side) => this.audio.footstep(this.p.onSand ? 'sand' : 'stone', this.p.speed, side);
    // clip-driven skinned body; the procedural runner stays if it cannot load
    loadRunnerRig().then((gltf) => this.runner.attachRig(gltf)).catch((err) => console.warn('Runner rig unavailable, using procedural body', err));
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex.glow, color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.renderOrder = 3;
    this.scene.add(this.blob);
    this.chaser = new ChaserWorm(this.scene, this.track);
    // worm sand gets its own pool so it never starves the ambient dust
    this.sandPool = new ParticlePool(this.scene, 2400, false);
    this.mound = new SandMound(this.scene, this.terrain.material);
    this.moundK = 0;
    this.breaches = [new BreachWorm(this.scene), new BreachWorm(this.scene)];
    this.devour = new DevourWorm(this.scene);
    this.dust = new DustField(this.scene);
    this.dustPool = new ParticlePool(this.scene, 1800, false);
    this.glowPool = new ParticlePool(this.scene, 900, true);
    this.stormWall = new StormWall(this.scene);
    this.windDir = new THREE.Vector3(-9, 0, 4).normalize();

    this.thopter = makeOrnithopter(0.55);
    this.thopter.group.visible = false;
    this.scene.add(this.thopter.group);
    this.flock = [];
    for (let i = 0; i < 3; i++) {
      const t = makeOrnithopter(1);
      this.scene.add(t.group);
      const f = { t, a: Math.random() * 6.28, r: 70 + i * 30, h: 28 + i * 9, w: 0.12 + Math.random() * 0.08, dir: i % 2 ? 1 : -1 };
      t.group.position.set(Math.cos(f.a) * f.r, f.h, Math.sin(f.a) * f.r);
      this.flock.push(f);
    }

    this.audio = new AudioEngine();
    this.atmo = { ...ZONES[0], tint: [...ZONES[0].tint] };
    this.time = 0;
    this.state = 'title';
    this.breachTimer = 3;
    this.camYaw = 0;
    this.shake = 0;
    this.breachTimer = 4;
    this.v = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), e: new THREE.Vector3() };
    this.playerPos = new THREE.Vector3();
    this.dustColor = new THREE.Color();
    this.colors = {
      sand: new THREE.Color(0.78, 0.58, 0.38),
      sandLight: new THREE.Color(0.95, 0.78, 0.55),
      spice: new THREE.Color(1.4, 0.5, 0.08),
      blue: new THREE.Color(0.4, 0.8, 2.0),
      white: new THREE.Color(2, 2, 2),
    };

    this.loadSave();
    this.setupUI();
    this.input = new Input(app, (a) => this.onAction(a));
    this.quality = this.save.quality || (isTouch ? 'low' : 'high');
    this.applyQuality();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'running') this.pause(); });
    this.resize();

    this.resetWorld(Math.floor(Math.random() * 1e9));
    this.fresh = true;
    this.cinema(true);
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
    setTimeout(() => $('loading').classList.add('done'), 150);
    setTimeout(() => { $('loading').style.display = 'none'; }, 900);
  }

  /* ---------------- persistence & UI ---------------- */

  loadSave() {
    this.save = { runs: [], best: 0, played: 0 };
    try { Object.assign(this.save, JSON.parse(localStorage.getItem('arrakis.save') || '{}')); } catch { /* ignore */ }
  }

  writeSave() {
    try { localStorage.setItem('arrakis.save', JSON.stringify(this.save)); } catch { /* ignore */ }
  }

  setupUI() {
    const ui = (this.ui = {
      hud: $('hud'), score: $('score'), mult: $('mult'), spice: $('spice'), dist: $('dist'),
      wormMeter: $('worm-meter'), wormFill: $('worm-fill'), powerups: $('powerups'),
      turnHint: $('turn-hint'), tip: $('tip'), zoneBanner: $('zone-banner'), zoneText: $('zone-text'),
      toasts: $('toasts'), title: $('title'), pause: $('pause'), over: $('over'), tint: $('tint'), flash: $('flash'),
      narration: $('narration'), waterBar: $('water-bar'), visionFill: $('vision-fill'),
      thumpers: $('inv-thumper-count'), invThumper: $('inv-thumper'), invHooks: $('inv-hooks'), thumperBtn: $('thumper-btn'),
      qte: $('qte'), qteRing: $('qte-ring'), qteKey: $('qte-key'), qteLabel: $('qte-label'), qteDots: $('qte-dots'),
      intro: $('intro'), introCard: $('intro-card'), introKicker: $('intro-kicker'), introLine: $('intro-line'), introDots: $('intro-dots'),
      goal: $('hud-goal'),
      thumperBtnCount: $('thumper-btn-count'), hudChapter: $('hud-chapter'), waterPct: $('water-pct'), visionBar: $('vision-bar'),
      wormPct: $('worm-pct'), danger: $('danger'), stride: $('stride'), strideBars: $('stride-bars'), strideStatus: $('stride-status'),
    });
    ui.waterSegs = Array.from({ length: 10 }, () => $('water-segs').appendChild(document.createElement('i')));
    ui.strideEls = Array.from({ length: 8 }, () => ui.strideBars.appendChild(document.createElement('i')));
    $('journey-labels').innerHTML = ZONE_LABELS.map((l, i) => `<span>${roman(i + 1)} · ${l}</span>`).join('');
    ui.thumperBtn.addEventListener('click', (e) => { e.stopPropagation(); this.onAction('thumper'); });
    ui.thumperBtn.addEventListener('touchend', (e) => e.stopPropagation());
    $('title-saying').textContent = `“${saying()}”`;
    $('play-btn').addEventListener('click', () => this.start());
    $('intro-skip').addEventListener('click', (e) => { e.stopPropagation(); this.endIntro(); });
    $('play-btn-m').addEventListener('click', () => this.start());
    $('again-btn').addEventListener('click', () => this.start());
    $('menu-btn').addEventListener('click', () => this.toTitle());
    $('resume-btn').addEventListener('click', () => this.resume());
    $('quit-btn').addEventListener('click', () => { this.ui.pause.classList.add('hidden'); this.state = 'running'; this.die('crash', true); });
    $('pause-btn').addEventListener('click', (e) => { e.stopPropagation(); this.pause(); });
    const qb = $('quality-btn');
    qb.addEventListener('click', () => {
      this.quality = this.quality === 'high' ? 'low' : 'high';
      this.save.quality = this.quality;
      this.writeSave();
      this.applyQuality(true);
    });
    const sb = $('sound-btn');
    const syncSound = () => { sb.textContent = `Sound · ${this.audio.enabled ? 'On' : 'Off'}`; };
    sb.addEventListener('click', () => { this.audio.init(); this.audio.setEnabled(!this.audio.enabled); syncSound(); });
    syncSound();
    this.refreshTitle();
    ui.last = {};
    // ambient motion for the screens: dust in the pause light, sand sifting on the end screen
    const rnd = (a, b) => a + Math.random() * (b - a);
    $('motes').innerHTML = Array.from({ length: 26 }, () =>
      `<i style="left:${rnd(45, 100)}%;top:${rnd(10, 100)}%;animation-duration:${rnd(7, 15)}s;animation-delay:-${rnd(0, 15)}s;opacity:${rnd(0.3, 0.9)}"></i>`).join('');
    $('sandfall').innerHTML = Array.from({ length: 40 }, () =>
      `<i style="left:${rnd(0, 100)}%;animation-duration:${rnd(2.5, 6)}s;animation-delay:-${rnd(0, 6)}s;height:${rnd(8, 22)}px"></i>`).join('');
    // the title's sayings drift past one after another
    setInterval(() => {
      if (this.state !== 'title') return;
      const el = $('title-saying');
      el.style.opacity = 0;
      setTimeout(() => { el.textContent = `“${saying()}”`; el.style.opacity = 1; }, 800);
    }, 9000);
  }

  refreshTitle() {
    $('best-title').textContent = Math.floor(this.save.best).toLocaleString();
    $('quality-btn').textContent = `Quality · ${this.quality === 'low' ? 'Low' : 'High'}`;
  }

  setText(key, el, value) {
    if (this.ui.last[key] !== value) { this.ui.last[key] = value; el.textContent = value; }
  }

  toast(text) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = text;
    this.ui.toasts.appendChild(d);
    setTimeout(() => d.remove(), 3100);
  }

  banner(text) {
    const b = this.ui.zoneBanner;
    this.ui.zoneText.textContent = text;
    b.classList.remove('hidden');
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => b.classList.add('hidden'), 3400);
  }

  flash(color = '#fff', strength = 0.6) {
    const f = this.ui.flash;
    f.style.transition = 'none';
    f.style.background = color;
    f.style.opacity = strength;
    void f.offsetWidth;
    f.style.transition = 'opacity 0.5s';
    f.style.opacity = 0;
  }

  /* ---------------- quality ---------------- */

  applyQuality(changed = false) {
    const high = this.quality === 'high';
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, high ? 1.75 : 1));
    this.renderer.shadowMap.enabled = high;
    this.sky.setShadows(high);
    this.terrain.radius = high ? 430 : 300;
    this.track.ahead = high ? 650 : 480;
    if (high && !this.composer) {
      const w = window.innerWidth, h = window.innerHeight;
      this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType }));
      // the plain render pass draws until N8AO (loaded on demand: it is large) takes over
      this.renderPass = new RenderPass(this.scene, this.camera);
      this.composer.addPass(this.renderPass);
      this.loadAO(w, h);
      this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.5, 0.9);
      this.composer.addPass(this.bloom);
      this.shimmer = new ShaderPass(SHIMMER);
      this.composer.addPass(this.shimmer);
      this.shafts = new ShaderPass(SUNSHAFTS);
      this.composer.addPass(this.shafts);
      this.composer.addPass(new OutputPass());
      this.grade = new ShaderPass(GRADE);
      this.composer.addPass(this.grade);
      // anti-aliasing: the canvas's own MSAA does not survive a post chain (loaded on demand)
      import('three/addons/postprocessing/SMAAPass.js').then(({ SMAAPass }) => {
        const pr = this.renderer.getPixelRatio();
        this.smaa = new SMAAPass(window.innerWidth * pr, window.innerHeight * pr);
        this.composer.addPass(this.smaa);
      }).catch((err) => console.warn('SMAA unavailable', err));
      this.perf = { avg: 16, slowFor: 0, step: 0 };
    }
    if (changed) {
      this.scene.traverse((o) => {
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; });
      });
      this.resize();
    }
    $('quality-btn').textContent = `Quality · ${high ? 'High' : 'Low'}`;
    this.app.classList.toggle('css-grade', !high);
  }

  // N8AO renders the scene and adds contact shadows where props meet the sand
  loadAO(w, h) {
    import('n8ao').then(({ N8AOPass }) => {
      if (this.aoOff || !this.composer) return;
      const ao = new N8AOPass(this.scene, this.camera, w, h);
      Object.assign(ao.configuration, {
        aoRadius: 4, distanceFalloff: 2, intensity: 5, halfRes: true, depthAwareUpsampling: true,
        gammaCorrection: false, color: new THREE.Color(0.16, 0.08, 0.035),
      });
      ao.setQualityMode('Low');
      this.composer.insertPass(ao, 0);
      this.renderPass.enabled = false;
      this.ao = ao;
      this.resize();
    }).catch((err) => console.warn('Ambient occlusion unavailable', err));
  }

  // aim the rays at the sun's place on screen; strongest low in the sky, gone at night and in storms
  updateSunShafts(dt) {
    if (!this.shafts || !this.shafts.enabled) return;
    const sun = this.sky.uniforms.uSunDir.value;
    const sp = (this._sunScreen || (this._sunScreen = new THREE.Vector3())).copy(sun).multiplyScalar(1000).add(this.camera.position).project(this.camera);
    const inFront = sp.z < 1 ? 1 : 0;
    const onScreen = 1 - smoothstep(0.85, 1.7, Math.max(Math.abs(sp.x), Math.abs(sp.y)));
    const up = smoothstep(-0.04, 0.06, sun.y);
    const low = 1 - smoothstep(0.25, 0.75, sun.y);
    const want = inFront * onScreen * up * (0.7 + 0.9 * low) * (1 - this.atmo.haze * 0.85);
    const u = this.shafts.uniforms;
    u.uSun.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
    u.uStrength.value = damp(u.uStrength.value, want, 3, dt);
    u.uColor.value.copy(this.sky.uniforms.uSunColor.value);
  }

  // If high quality can't hold its frame rate, shed cost in steps: AO, then resolution, then rays.
  governPerformance(rawDt) {
    const pf = this.perf;
    if (!pf || this.quality !== 'high' || pf.hold || this.state !== 'running' || document.hidden || rawDt > 0.25) return;
    pf.avg += (rawDt * 1000 - pf.avg) * 0.05;
    pf.slowFor = pf.avg > 24 ? pf.slowFor + rawDt : Math.max(0, pf.slowFor - rawDt * 0.5);
    if (pf.slowFor < 3 || pf.step >= 3) return;
    pf.step++;
    pf.slowFor = 0;
    if (pf.step === 1) { if (this.ao) this.ao.enabled = false; this.renderPass.enabled = true; this.aoOff = true; }
    else if (pf.step === 2) { this.renderer.setPixelRatio(1); this.resize(); }
    else this.shafts.enabled = false;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
    const px = this.renderer.domElement.height * 0.85;
    this.dust.setScale(px);
    this.dustPool.setScale(px);
    this.glowPool.setScale(px);
    this.sandPool.setScale(px);
  }

  /* ---------------- run lifecycle ---------------- */

  resetWorld(seed) {
    this.track.reset(seed);
    this.terrain.clear();
    this.track.ensure(0);
    this.terrain.buildAll(0, 0);
    this.devour.stop();
    this.dustPool.clear();
    this.sandPool.clear();
    this.moundK = 0;
    this.glowPool.clear();
    const seg = this.track.segments[0];
    this.p = {
      seg, s: 6, lane: 0, laneX: 0, prevLaneX: 0, prevS: 6, y: 0, vy: 0, grounded: true,
      slideT: 0, slideQueued: false, pendingTurn: 0, speed: 0, runDist: 0,
      score: 0, spice: 0, mult: 1, shield: false, trance: 0, fly: 0, invuln: 0,
      stumbleT: 0, wormGap: 45, combo: 0, lastPickup: 0, stepT: 0,
      zoneIndex: 0, milestone: 0, spiceMilestone: 0, tips: 0, tipFor: null, visualYaw: 0, alive: true,
      water: 100, sign: 0, thumpers: 1, hooks: 0, vision: 0, ride: 0, rideOff: 0, lure: 0,
      lastBreak: -10, lastGap: 0, onSand: false, chapter: 0, visits: {}, beats: {},
      strides: [], rides: 0, journal: [],
      silent: 0, seal: 0, rush: 0, qte: null, balanceT: 0, turnWarned: false, wp: 0,
    };
    for (const t of this.planted || []) this.scene.remove(t.group);
    this.planted = [];
    this.runner.root.visible = true;
    this.runner.setShield(false);
    this.camYaw = 0;
  }

  start() {
    this.audio.init();
    if (!this.fresh) this.resetWorld(Math.floor(Math.random() * 1e9));
    this.fresh = false;
    const p = this.p;
    p.s = 6;
    this.save.played = (this.save.played || 0) + 1;
    this.tutorial = this.save.played <= 3;
    this.ui.title.classList.add('hidden');
    this.ui.over.classList.add('hidden');
    this.ui.pause.classList.add('hidden');
    this.thopter.group.visible = false;
    // the first crossing of a visit opens on the story; later runs go straight in
    if (!this.introSeen) return this.startIntro();
    this.beginRun();
  }

  beginRun() {
    this.state = 'running';
    this.cinema(false);
    this.ui.hud.classList.remove('hidden');
    this.chapter(zoneAt(0).zone.id);
    this.cinema(true, 2600);
    this.audio.braam(0.8);
    this.syncInventory();
    this.drawStride();
    this.updateGoal();
    setTimeout(() => this.state === 'running' && this.narrate(BEATS.setOut, 4200), 900);
  }

  /* ---------- the opening: why Ishra runs ---------- */

  startIntro() {
    this.state = 'intro';
    this.introT = 0;
    this.introIdx = -1;
    this.ui.hud.classList.add('hidden');
    this.ui.intro.classList.remove('hidden');
    this.ui.introDots.innerHTML = INTRO.map(() => '<i></i>').join('');
    this.cinema(true);
    this.audio.braam(0.6);
  }

  updateIntro(dt) {
    this.introT += dt;
    const idx = Math.floor(this.introT / INTRO_SHOT);
    if (idx >= INTRO.length) return this.endIntro();
    if (idx !== this.introIdx) {
      this.introIdx = idx;
      const card = this.ui.introCard;
      card.classList.remove('show');
      void card.offsetWidth;
      this.ui.introKicker.textContent = INTRO[idx].kicker;
      this.ui.introLine.textContent = INTRO[idx].line;
      card.classList.add('show');
      [...this.ui.introDots.children].forEach((d, i) => d.classList.toggle('on', i <= idx));
      if (idx === INTRO.length - 1) this.audio.braam(0.7);
    }
  }

  endIntro() {
    if (this.state !== 'intro') return;
    this.introSeen = true;
    this.ui.intro.classList.add('hidden');
    this.ui.introCard.classList.remove('show');
    this.beginRun();
  }

  // the next place the seed-water must reach, and how far off it is
  updateGoal() {
    const p = this.p;
    const w = waypointAt(p.wp || 0);
    const km = Math.max(0, (w.at - p.runDist) / 1000);
    const left = km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
    this.setText('goal', this.ui.goal, `To ${w.name} · ${left}`);
  }

  reachWaypoint() {
    const p = this.p;
    const w = waypointAt(p.wp);
    p.wp++;
    p.water = 100;
    p.score += 1000 * p.mult;
    p.journal.push({ num: '◆', title: w.name.replace(/^the /, ''), line: w.line });
    this.narrate(w.line, 5200);
    this.toast(`Seed-water reached ${w.name}`);
    this.audio.braam(0.9);
    this.audio.powerup();
    this.flash('#9fd8ff', 0.25);
  }

  pause() {
    if (this.state !== 'running') return;
    this.state = 'paused';
    this.renderJournal();
    this.ui.pause.classList.remove('hidden');
    this.audio.thopter(false);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'running';
    this.ui.pause.classList.add('hidden');
    this.last = performance.now();
    if (this.p.fly > 0) this.audio.thopter(true);
  }

  toTitle() {
    this.cinema(true);
    this.resetWorld(Math.floor(Math.random() * 1e9));
    this.fresh = true;
    this.state = 'title';
    this.ui.over.classList.add('hidden');
    this.ui.hud.classList.add('hidden');
    this.ui.title.classList.remove('hidden');
    $('title-saying').textContent = `“${saying()}”`;
    this.refreshTitle();
  }

  onAction(a) {
    const st = this.state;
    if (st === 'title') {
      if (a === 'confirm') this.start();
      return;
    }
    if (st === 'intro') {
      if (a === 'confirm' || a === 'pause') this.endIntro();
      return;
    }
    if (st === 'over') {
      if (a === 'confirm') this.start();
      return;
    }
    if (st === 'paused') {
      if (a === 'pause' || a === 'confirm') this.resume();
      return;
    }
    if (st !== 'running') return;
    const p = this.p;
    if (a === 'pause') return this.pause();
    if (p.qte) return this.qteInput(a);
    if (a === 'thumper') return this.plantThumper();
    if (p.ride > 0) return;
    if (a === 'left' || a === 'right') {
      const dir = a === 'left' ? -1 : 1;
      // approaching a corner, a press toward the bend is the turn (Temple Run style)
      const seg = p.seg;
      if (seg.next && !p.pendingTurn && dir === seg.turn && p.fly <= 0 && this.inTurnWindow()) {
        p.pendingTurn = dir;
        this.audio.whoosh(500, 1500, 0.18, 0.12);
        this.rhythmBreak();
        return;
      }
      const nl = clamp(p.lane + dir, -1, 1);
      if (nl !== p.lane) { p.lane = nl; this.audio.whoosh(600, 1200, 0.12, 0.1); this.rhythmBreak(); }
    } else if (a === 'jump' || a === 'tap') {
      if (p.fly > 0) return;
      if (p.grounded) {
        p.vy = JUMP_V;
        p.grounded = false;
        p.slideT = 0;
        this.audio.jump();
        this.rhythmBreak();
      }
    } else if (a === 'slide') {
      if (p.fly > 0) return;
      if (p.grounded) {
        if (p.slideT <= 0) { this.audio.slide(); this.rhythmBreak(); }
        p.slideT = SLIDE_TIME;
      } else {
        p.vy = Math.min(p.vy, -22);
        p.slideQueued = true;
      }
    }
  }

  // the stretch before a corner where a press toward the bend counts as the turn
  inTurnWindow() {
    const p = this.p;
    const d = p.seg.length - p.s;
    return d < Math.max(15, p.speed * 0.95) && d > -DECK_HALF;
  }

  /* ---------- hooking the Maker: a quick-time sequence when the worm strikes ---------- */

  // how hard the Maker is to hook and hold: rises with distance and with every ride
  rideDifficulty() {
    const p = this.p;
    return clamp(p.runDist / 9000 + p.rides * 0.12, 0, 1);
  }

  startQTE(kind) {
    const p = this.p;
    const d = this.rideDifficulty();
    const n = kind === 'hook' ? 1 + Math.round(d * 3) : 1;
    const dirs = ['left', 'right', 'up', 'down'];
    const steps = Array.from({ length: n }, () => dirs[Math.floor(Math.random() * 4)]);
    const window = kind === 'hook' ? 1.35 - d * 0.65 : 1.1 - d * 0.45;
    p.qte = { kind, steps, idx: 0, t: 0, window, slow: kind === 'hook' ? 0.12 : 0.45 };
    this.renderQTE();
    this.ui.qte.classList.remove('hidden');
    if (kind === 'hook') {
      this.audio.braam(1);
      this.shake = 0.8;
      this.cinema(true);
      this.narrate(BEATS.hookNow, 2600);
    }
  }

  qteInput(a) {
    const p = this.p, q = p.qte;
    const dir = a === 'jump' || a === 'tap' ? 'up' : a === 'slide' ? 'down' : a;
    if (!['left', 'right', 'up', 'down'].includes(dir)) return;
    if (dir !== q.steps[q.idx]) return this.endQTE(false);
    this.audio.pickup(q.idx + 2);
    q.idx++;
    q.t = 0;
    this.flash('#ffd29a', 0.18);
    if (q.idx >= q.steps.length) return this.endQTE(true);
    this.renderQTE();
  }

  updateQTE(realDt) {
    const q = this.p.qte;
    q.t += realDt;
    const left = 1 - q.t / q.window;
    this.ui.qteRing.style.transform = `scale(${0.55 + Math.max(0, left) * 1.25})`;
    this.ui.qteRing.classList.toggle('late', left < 0.3);
    if (left <= 0) this.endQTE(false);
  }

  renderQTE() {
    const q = this.p.qte;
    const glyph = { left: '←', right: '→', up: '↑', down: '↓' };
    this.ui.qteKey.textContent = glyph[q.steps[q.idx]];
    this.ui.qteLabel.textContent = q.kind === 'hook' ? 'Set the hooks' : 'Hold on';
    this.ui.qteDots.innerHTML = q.steps.map((_, i) => `<i class="${i < q.idx ? 'done' : i === q.idx ? 'now' : ''}"></i>`).join('');
  }

  endQTE(ok) {
    const p = this.p, q = p.qte;
    p.qte = null;
    this.ui.qte.classList.add('hidden');
    if (q.kind === 'hook') {
      this.cinema(false);
      if (ok) this.startRide();
      else this.die('worm');
      return;
    }
    // balance check while riding: fail and the Maker shakes you off
    if (ok) { p.balanceT = 4.5 - this.rideDifficulty() * 1.8; return; }
    p.ride = 0;
    p.invuln = 1.8;
    p.water = Math.max(0, p.water - 15);
    this.stumble();
    this.beat('thrown', true);
    this.audio.roar();
  }

  // "Walk without rhythm": on open sand, irregular moves quiet your footsteps —
  // but only if the moves themselves don't fall into a pattern.
  rhythmBreak() {
    const p = this.p;
    if (!p.onSand) return;
    const gap = this.time - p.lastBreak;
    if (gap < 0.22) return;
    const match = p.lastGap > 0 && Math.abs(gap - p.lastGap) / p.lastGap < 0.18;
    if (match) {
      p.sign = Math.min(100, p.sign + 6);
      this.beat('tooRegular', true);
      this.flash('#ff8a2a', 0.12);
    } else {
      p.sign = Math.max(0, p.sign - 19);
    }
    p.strides.push({ gap: Math.min(gap, 1.2), match });
    if (p.strides.length > 8) p.strides.shift();
    this.drawStride();
    p.lastGap = gap;
    p.lastBreak = this.time;
  }

  plantThumper() {
    const p = this.p;
    if (p.thumpers <= 0 || p.ride > 0) return;
    p.thumpers--;
    p.lure = 7;
    p.sign = 0;
    const t = makeThumper();
    t.group.position.copy(this.playerPos);
    t.group.position.y = Math.max(0, p.onSand ? 0.05 : 0);
    t.group.rotation.y = p.visualYaw;
    this.scene.add(t.group);
    this.planted.push({ ...t, life: 10, beatT: 0, pos: t.group.position.clone() });
    // the worm turns toward the false heartbeat, far off the road
    const b = this.breaches.find((x) => !x.active);
    if (b) {
      const side = this.v.a.copy(p.seg.right).multiplyScalar(Math.random() < 0.5 ? -1 : 1);
      const origin = this.v.b.copy(this.playerPos).addScaledVector(side, 160).addScaledVector(p.seg.fwd, -40);
      origin.y = this.terrain.heightAt(origin.x, origin.z) - 4;
      b.start(origin, this.v.c.copy(side).negate(), 26, 6.5);
    }
    this.audio.thump();
    this.beat('thumper');
    this.syncInventory();
  }

  startRide() {
    const p = this.p;
    p.hooks--;
    // rides grow shorter and the Maker fights harder the further you go
    p.ride = RIDE_TIME * (1 - this.rideDifficulty() * 0.45);
    p.balanceT = 3.2;
    p.rides++;
    p.sign = 0;
    p.slideT = 0;
    p.vy = 0;
    this.audio.roar();
    this.shake = 1;
    this.flash('#ffd29a', 0.5);
    this.beat('ride');
    this.cinema(true, 2600);
    this.audio.braam(1);
    this.syncInventory();
    for (let k = 0; k < 2; k++) {
      this.dustPool.emit(this.playerPos, { count: 60, spread: [3, 0.5, 3], vel: [0, 8 + k * 4, 0], velSpread: 5, life: 2, size: 2.4, grow: 3, color: this.colors.sand, gravity: -6, drag: 0.6, alpha: 0.45 });
    }
  }

  beat(key, repeatable = false) {
    const p = this.p;
    if (!repeatable && p.beats[key]) return;
    if (repeatable && p.beats[key] && this.time - p.beats[key] < 6) return;
    p.beats[key] = this.time;
    this.narrate(BEATS[key]);
  }

  cinema(on, ms = 0) {
    clearTimeout(this.cinemaTimer);
    this.app.classList.toggle('cinema', on);
    if (on && ms) this.cinemaTimer = setTimeout(() => this.app.classList.remove('cinema'), ms);
  }

  narrate(text, ms = 4600) {
    const el = this.ui.narration;
    el.textContent = text;
    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(this.narrTimer);
    this.narrTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  chapter(zoneId) {
    const p = this.p;
    p.chapter++;
    const visit = p.visits[zoneId] || 0;
    p.visits[zoneId] = visit + 1;
    const c = chapterFor(zoneId, visit);
    const num = roman(p.chapter);
    p.journal.push({ num, title: c.title, line: c.line });
    this.ui.zoneBanner.querySelector('small').textContent = `Chapter ${num}`;
    this.ui.hudChapter.textContent = `Chapter ${num} · ${c.title}`;
    // progress through the current cycle of five biomes
    const inCycle = ZONES.findIndex((z) => z.id === zoneId) + 1;
    $('zone-dashes').innerHTML = ZONES.map((_, i) => `<i class="${i < inCycle ? 'on' : ''}"></i>`).join('');
    this.banner(c.title);
    if (p.chapter > 1) {
      this.cinema(true, 3600);
      this.audio.braam(0.6);
      this.app.classList.add('chaptering');
      clearTimeout(this.duskTimer);
      this.duskTimer = setTimeout(() => this.app.classList.remove('chaptering'), 3000);
      setTimeout(() => this.state === 'running' && this.narrate(c.line, 5200), 1400);
    }
  }

  syncInventory() {
    const p = this.p;
    this.setText('thumpers', this.ui.thumpers, String(p.thumpers));
    this.setText('thumperBtn', this.ui.thumperBtnCount, `× ${p.thumpers}`);
    this.ui.invThumper.classList.toggle('empty', p.thumpers <= 0);
    this.ui.invHooks.classList.toggle('hidden', p.hooks <= 0);
    this.ui.thumperBtn.classList.toggle('empty', p.thumpers <= 0);
  }

  // Stride trace: one bar per recent move on sand, height = time since the move before it.
  drawStride() {
    const p = this.p, ui = this.ui;
    const list = p.strides;
    ui.strideEls.forEach((el, i) => {
      const s = list[i - (8 - list.length)];
      el.style.display = s ? '' : 'none';
      if (!s) return;
      el.style.height = `${Math.round(clamp(s.gap * 40, 5, 38))}px`;
      el.classList.toggle('match', s.match);
    });
    const last = list[list.length - 1];
    const st = ui.strideStatus;
    st.textContent = !last ? 'Break your stride' : last.match ? 'Last two matched — too regular' : 'Uneven — the sand is quiet';
    st.classList.toggle('good', !!last && !last.match);
  }

  renderJournal() {
    const entries = this.p.journal.slice(-4);
    $('journal-list').innerHTML = entries
      .map((e) => `<li><span class="n">${e.num}</span><div><b>${e.title}</b><p>${e.line}</p></div></li>`)
      .join('');
  }

  executeTurn() {
    const p = this.p;
    const seg = p.seg, next = seg.next;
    if (!next) return;
    const pos = this.track.localToWorld(seg, p.laneX, p.s, this.v.a).sub(seg.end);
    p.s = pos.dot(next.fwd);
    p.prevS = p.s;
    p.laneX = pos.dot(next.right);
    p.prevLaneX = p.laneX;
    p.laneV = 0;
    p.seg = next;
    p.pendingTurn = 0;
    this.audio.turn();
  }

  /* ---------------- per-frame simulation ---------------- */

  updateRun(dt) {
    const p = this.p;
    const gdt = dt * (p.trance > 0 ? 0.8 : 1);
    p.prevLaneX = p.laneX;
    p.prevS = p.s;
    p.speed = speedAt(p.runDist) * (p.stumbleT > 0 ? 0.82 : 1) * (p.fly > 0 ? 1.2 : 1) * (p.ride > 0 ? 1.45 : 1) * (p.rush > 0 ? 1.25 : 1);
    const ds = p.speed * gdt;
    p.s += ds;
    p.runDist += ds;

    p.trance = Math.max(0, p.trance - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.stumbleT = Math.max(0, p.stumbleT - dt);
    p.lure = Math.max(0, p.lure - dt);
    p.silent = Math.max(0, p.silent - dt);
    p.seal = Math.max(0, p.seal - dt);
    p.rush = Math.max(0, p.rush - dt);
    if (p.fly > 0) {
      p.fly -= dt;
      if (p.fly <= 0 && this.track.inGap(p.seg, p.s + 6, -2)) p.fly = 0.3;
      if (p.fly <= 0) { p.fly = 0; p.invuln = 1.2; this.audio.thopter(false); }
    }
    if (p.ride > 0) {
      p.ride -= dt;
      if (p.ride <= 0 && this.track.inGap(p.seg, p.s + 10, -2)) p.ride = 0.4;
      if (p.ride <= 0) { p.ride = 0; p.invuln = 1.8; this.beat('rideEnd', true); this.audio.roar(); }
      // the Maker tries to shake its rider loose
      else if (!p.qte) {
        p.balanceT -= dt;
        if (p.balanceT <= 0) this.startQTE('balance');
      }
    }
    // the ridden worm keeps to the outside of the coming bend: swinging wide round a corner is
    // smooth, while an offset on the inside would fold back on itself and wrench the rider
    const rideSide = p.seg.turn > 0 ? 1 : -1;
    p.rideOff = damp(p.rideOff, p.ride > 0 ? RIDE_OFFSET * rideSide : 0, p.ride > 0 ? 1.15 : 3.2, dt);

    let seg = p.seg;
    // Corners must be turned by hand (a press toward the bend before it); riding the worm or
    // hanging from a thopter, you are carried round. Each lane turns where it lines up with the
    // same lane of the next stretch. Miss the turn and the rock face ahead is waiting.
    if (seg.next) {
      const k = seg.fwd.dot(seg.next.right); // -1 right turn, +1 left turn
      const carried = p.ride > 0 || Math.abs(p.rideOff) > 0.6 || p.fly > 0;
      if ((p.pendingTurn || carried) && p.s >= seg.length + p.lane * LANE_W * k) {
        this.executeTurn();
        seg = p.seg;
      }
    }

    // lane changes ride a critically damped spring: they ease in and settle, no snapping
    const LK = 230, LC = 2 * Math.sqrt(LK);
    const lv = p.laneV || 0;
    p.laneV = lv + ((p.lane * LANE_W - p.laneX) * LK - lv * LC) * gdt;
    p.laneX += p.laneV * gdt;

    const riding = p.ride > 0 || Math.abs(p.rideOff) > 0.6;
    if (p.fly > 0) {
      const target = p.fly < 0.9 ? 0.4 : FLY_H;
      p.y = damp(p.y, target, 3.2, gdt);
      p.vy = 0;
      p.grounded = false;
    } else if (riding) {
      p.y = damp(p.y, p.ride > 0 ? this.chaser.backHeight() : 0.35, 6, gdt);
      p.vy = 0;
      p.grounded = false;
    } else {
      p.vy -= GRAVITY * gdt;
      p.y += p.vy * gdt;
      // mid-hook the Maker is all that matters: no falling, no stumbling
      const hooking = p.qte && p.qte.kind === 'hook';
      if (hooking) p.invuln = Math.max(p.invuln, 0.3);
      const support = hooking || !this.track.inGap(seg, p.s, 0.3);
      if (p.y <= 0 && support && p.y > -0.7) {
        if (!p.grounded && p.vy < -5) {
          this.audio.land(this.p.onSand ? 'sand' : 'stone');
          this.puff(10, 0.6);
        }
        p.y = 0;
        p.vy = 0;
        p.grounded = true;
        if (p.slideQueued) { p.slideQueued = false; p.slideT = SLIDE_TIME; this.audio.slide(); }
      } else if (p.y > 0 || !support) {
        p.grounded = false;
      }
      if (p.y < -1.4) return this.die('fall');
    }
    if (p.slideT > 0) p.slideT -= gdt;

    // water: the stillsuit loses a little every moment, more under the sun
    const drain = (0.85 + 0.7 * (1 - this.sky.night) + this.atmo.haze * 0.5) * (riding || p.fly > 0 ? 0.4 : 1) * (p.seal > 0 ? 0 : 1);
    p.water = Math.max(0, p.water - drain * dt);
    if (p.water < 25) this.beat('lowWater');
    if (p.water <= 0) return this.die('thirst');

    // wormsign: steady footsteps on open sand call the Maker
    // the whole desert is open sand now; only the old paving is safe
    p.onSand = !this.track.onRock(seg, p.s) && !riding && p.fly <= 0;
    if (p.onSand) {
      this.beat('firstSand');
      if (p.shield) this.beat('shieldSand');
      const ease = Math.min(1, 0.45 + p.runDist / 600); // gentle for the first stretch
      let rate = (9 + p.speed * 0.28) * ease * (p.shield ? 1.5 : 1) * (p.trance > 0 ? 0.5 : 1);
      if (p.lure > 0 || p.silent > 0) rate = 0;
      p.sign = Math.min(100, p.sign + rate * gdt);
      if (p.sign > 60 && !p.beats.wormRising) this.audio.braam(0.7);
      if (p.sign > 60) this.beat('wormRising');
      if (p.sign >= 100 && !p.qte) {
        if (p.hooks > 0) this.startQTE('hook');
        else return this.die('worm');
      }
    } else if (!p.qte) {
      p.sign = Math.max(0, p.sign - 35 * gdt);
    }

    if (p.fly <= 0 && !riding) this.collide(seg); // invulnerability is handled per obstacle (the rock face still kills)
    if (this.state !== 'running') return;
    this.pickups(seg, dt);

    p.mult = Math.min(8, 1 + Math.floor(p.runDist / 800)) * (p.trance > 0 ? 2 : 1);
    p.score += ds * 0.5 * p.mult * (p.ride > 0 ? 3 : 1);

    const pathDist = seg.startDist + p.s;
    const z = zoneAt(pathDist);
    if (z.index !== p.zoneIndex) {
      p.zoneIndex = z.index;
      this.chapter(z.zone.id);
    }
    if (p.runDist >= waypointAt(p.wp).at) this.reachWaypoint();
    this.updateGoal();
    if (p.milestone < MILESTONES.length && p.runDist >= MILESTONES[p.milestone][0]) {
      const [m, t] = MILESTONES[p.milestone++];
      this.toast(`${m.toLocaleString()}m — ${t}`);
    }

    // footstep dust
    if (p.grounded) {
      p.stepT -= dt;
      if (p.stepT <= 0) {
        p.stepT = p.slideT > 0 ? 0.03 : 0.11;
        this.puff(p.slideT > 0 ? 3 : 2, 0.35);
      }
    }
    // geysers
    for (const gy of seg.geysers) {
      if (gy.justErupted && Math.abs(gy.s - p.s) < 90) {
        const w = this.track.localToWorld(seg, gy.lane * LANE_W, gy.s, this.v.b);
        this.glowPool.emit(w, { count: 40, spread: [0.6, 0.2, 0.6], vel: [0, 14, 0], velSpread: 3, life: 1.0, size: 0.5, color: this.colors.spice, gravity: -10 });
        this.dustPool.emit(w, { count: 20, spread: [1, 0.2, 1], vel: [0, 6, 0], velSpread: 3, life: 1.6, size: 1.6, grow: 2, color: this.colors.sand, gravity: -2, alpha: 0.6 });
      }
    }
    this.tips(seg);
  }

  puff(n, size) {
    const w = this.playerPos;
    this.dustPool.emit(this.v.d.set(w.x, w.y + 0.1, w.z), {
      count: n, spread: [0.3, 0.05, 0.3], vel: [0, 1.2, 0], velSpread: 1.2, life: 0.8, size, grow: 1.2,
      color: this.colors.sandLight, gravity: -0.5, drag: 2, alpha: 0.55,
    });
  }

  collide(seg) {
    const p = this.p;
    const h = p.slideT > 0 ? 0.8 : 1.75;
    const px0 = p.laneX - 0.35, px1 = p.laneX + 0.35;
    const qx0 = p.prevLaneX - 0.35, qx1 = p.prevLaneX + 0.35;
    // swept along the path between frames, so nothing is tunnelled through at high speed
    const sA = Math.min(p.prevS, p.s) - 0.35, sB = Math.max(p.prevS, p.s) + 0.35;
    for (const o of seg.obstacles) {
      if (!o.active) continue;
      if (sB < o.s0 || sA > o.s1) continue;
      if (p.y + h <= o.y0 || p.y >= o.y1) continue;
      if (px1 <= o.x0 || px0 >= o.x1) continue;
      if (o.fatal) { this.flash('#ffffff', 0.6); return this.die('crash'); }
      if (p.invuln > 0) continue;
      if (p.rush > 0) { this.smash(o, seg); continue; }
      if (o.kind === 'devil') { this.devilHit(o); return; }
      const wasX = !(qx1 <= o.x0 || qx0 >= o.x1);
      if (!wasX) {
        const dir = Math.sign(p.laneX - p.prevLaneX) || 1;
        p.lane = clamp(p.lane - dir, -1, 1);
        p.laneX = p.prevLaneX;
        this.stumble();
      } else {
        this.crash(o, seg);
      }
      return;
    }
  }

  // Spice Rush: obstacles burst apart before the runner
  smash(o, seg) {
    o.active = false;
    o.mesh.visible = false;
    const w = this.track.localToWorld(seg, (o.x0 + o.x1) / 2, (o.s0 + o.s1) / 2, this.v.b);
    w.y += 1;
    this.dustPool.emit(w, { count: 45, spread: [1.2, 1, 1.2], vel: [0, 4, 0], velSpread: 7, life: 1.2, size: 1.2, grow: 1.5, color: this.colors.sand, gravity: -7, alpha: 0.8 });
    this.glowPool.emit(w, { count: 20, spread: [0.6, 0.6, 0.6], vel: [0, 3, 0], velSpread: 6, life: 0.6, size: 0.4, color: this.colors.spice, gravity: 0, drag: 2 });
    this.audio.crash();
    this.shake = Math.max(this.shake, 0.4);
    this.p.score += 50 * this.p.mult;
  }

  // a dust devil: blinding sand, a lurch sideways, and footsteps the Maker cannot miss
  devilHit(o) {
    const p = this.p;
    p.invuln = 0.9;
    p.sign = Math.min(100, p.sign + 28);
    p.water = Math.max(0, p.water - 8);
    const mid = (o.x0 + o.x1) / 2;
    p.lane = clamp(p.lane + (p.laneX >= mid ? 1 : -1), -1, 1);
    this.stumble();
    this.flash('#d9a066', 0.45);
    this.dustPool.emit(this.v.b.copy(this.playerPos).addScaledVector(UP, 1.2), { count: 50, spread: [1.5, 1.2, 1.5], vel: [0, 3, 0], velSpread: 6, life: 1.4, size: 1.6, grow: 2, color: this.colors.sand, gravity: -1, drag: 1, alpha: 0.7 });
  }

  stumble() {
    const p = this.p;
    this.shake = Math.max(this.shake, 0.5);
    this.audio.stumble();
    this.flash('#ff5a1a', 0.25);
    p.stumbleT = 0.7;
    p.water = Math.max(0, p.water - 6);
    if (p.onSand) p.sign = Math.min(100, p.sign + 20);
  }

  breakShield() {
    const p = this.p;
    p.shield = false;
    p.invuln = 1.0;
    this.runner.setShield(false);
    this.audio.shieldHit();
    this.flash('#5fb8ff', 0.4);
    this.glowPool.emit(this.v.c.copy(this.playerPos).addScaledVector(UP, 1), { count: 60, spread: [0.6, 0.8, 0.6], vel: [0, 2, 0], velSpread: 6, life: 0.7, size: 0.35, color: this.colors.blue, gravity: 0, drag: 2 });
  }

  crash(o, seg) {
    const p = this.p;
    if (p.shield) {
      this.breakShield();
      o.active = false;
      o.mesh.visible = false;
      const w = this.track.localToWorld(seg, (o.x0 + o.x1) / 2, (o.s0 + o.s1) / 2, this.v.b);
      w.y += 1;
      this.dustPool.emit(w, { count: 30, spread: [1, 1, 1], vel: [0, 3, 0], velSpread: 5, life: 1.2, size: 1.0, grow: 1, color: this.colors.sand, gravity: -6, alpha: 0.8 });
      return;
    }
    // no instant death on the stones: the impact costs water and breath
    p.water = Math.max(0, p.water - (o.kind === 'geyser' ? 40 : 30));
    this.audio.crash();
    this.flash('#ffffff', 0.35);
    this.shake = 0.9;
    p.stumbleT = 0.9;
    p.invuln = 1.2;
    o.active = false;
    o.mesh.visible = false;
    const w = this.track.localToWorld(seg, (o.x0 + o.x1) / 2, (o.s0 + o.s1) / 2, this.v.b);
    w.y += 1;
    this.dustPool.emit(w, { count: 40, spread: [1, 1, 1], vel: [0, 3, 0], velSpread: 5, life: 1.3, size: 1.1, grow: 1.2, color: this.colors.sand, gravity: -6, alpha: 0.8 });
    if (p.water <= 0) this.die(o.kind === 'geyser' ? 'geyser' : 'crash');
  }

  pickups(seg, dt) {
    const p = this.p;
    const magnet = p.trance > 0 || p.fly > 0 || p.ride > 0;
    const T = this.v.c.set(p.laneX + p.rideOff, p.y + 0.9, -p.s);
    for (const k of seg.pickups) {
      if (k.taken) continue;
      const ds = k.s - p.s;
      if (ds < -3 || ds > (magnet ? 16 : 2.5)) continue;
      const mp = k.mesh.position;
      if (magnet && k.type === 'spice') mp.lerp(T, 1 - Math.exp(-9 * dt));
      if (k.type === 'cache') { if (Math.abs(ds) < 3 && Math.abs(p.rideOff) < 2) this.collect(k, seg); continue; }
      if (magnet && (k.type === 'water')) mp.lerp(T, 1 - Math.exp(-6 * dt));
      if (mp.distanceTo(T) < (k.type === 'spice' ? 1.25 : 1.5)) this.collect(k, seg);
    }
  }

  collect(k, seg) {
    const p = this.p;
    k.taken = true;
    k.mesh.visible = false;
    const w = this.v.b.copy(k.mesh.position).applyMatrix4(seg.group.matrixWorld);
    if (k.type === 'spice') {
      p.spice++;
      p.score += 10 * p.mult;
      p.combo = this.time - p.lastPickup < 0.6 ? p.combo + 1 : 0;
      p.lastPickup = this.time;
      this.audio.pickup(p.combo);
      this.glowPool.emit(w, { count: 8, spread: [0.2, 0.2, 0.2], vel: [0, 2, 0], velSpread: 2.5, life: 0.45, size: 0.25, color: this.colors.spice, gravity: 0, drag: 3 });
      p.vision = Math.min(100, p.vision + 3.5);
      if (p.vision >= 100 && p.trance <= 0) {
        p.vision = 0;
        p.trance = TRANCE_TIME;
        this.beat('vision', true);
      }
      const sm = [50, 100, 250, 500, 1000];
      if (p.spiceMilestone < sm.length && p.spice >= sm[p.spiceMilestone]) this.toast(`${sm[p.spiceMilestone++]} spice harvested`);
      return;
    }
    if (k.type === 'water' || k.type === 'cache') {
      p.water = Math.min(100, p.water + (k.type === 'cache' ? 20 : 8));
      this.audio.pickup(5);
      this.glowPool.emit(w, { count: k.type === 'cache' ? 40 : 14, spread: [0.3, 0.3, 0.3], vel: [0, 2, 0], velSpread: 3, life: 0.6, size: 0.3, color: this.colors.blue, gravity: 0, drag: 3 });
      if (k.type === 'cache') this.beat('cache');
      return;
    }
    this.audio.powerup();
    this.glowPool.emit(w, { count: 40, spread: [0.3, 0.3, 0.3], vel: [0, 2, 0], velSpread: 5, life: 0.8, size: 0.4, color: k.type === 'shield' ? this.colors.blue : this.colors.spice, gravity: 0, drag: 2 });
    if (k.type === 'thumper') {
      p.thumpers = Math.min(3, p.thumpers + 1);
      this.beat('gotThumper');
      this.syncInventory();
    } else if (k.type === 'hooks') {
      p.hooks = 1;
      this.beat('gotHooks');
      this.syncInventory();
    }
    if (k.type === 'shield') {
      p.shield = true;
      this.runner.setShield(true);
      this.toast('Holtzman shield active');
    } else if (k.type === 'trance') {
      p.trance = TRANCE_TIME;
      this.toast('Spice trance — time bends, spice flows to you');
    } else if (k.type === 'silence') {
      p.silent = 10;
      this.toast('Silent Step — the sand forgets your footsteps');
    } else if (k.type === 'seal') {
      p.seal = 15;
      this.toast('Stillsuit sealed — not a drop lost');
    } else if (k.type === 'rush') {
      p.rush = 5;
      this.flash('#ff8a2a', 0.35);
      this.toast('Spice Rush — nothing stands in your way');
    } else if (k.type === 'thopter') {
      p.fly = THOPTER_TIME;
      p.slideT = 0;
      this.audio.thopter(true);
      this.beat('thopter', true);
    }
  }

  tips(seg) {
    const p = this.p;
    const ui = this.ui;
    // the turn arrow: shown for every corner until the turn is committed
    const turning = seg.next && !p.pendingTurn && p.fly <= 0 && p.ride <= 0 && p.seg.length - p.s < Math.max(30, p.speed * 1.6);
    ui.turnHint.classList.toggle('hidden', !turning);
    if (turning) ui.turnHint.classList.toggle('left', seg.turn < 0);
    let tip = null;
    if (turning && this.inTurnWindow()) {
      tip = isTouch ? `Swipe ${seg.turn < 0 ? 'left' : 'right'} to turn` : `${seg.turn < 0 ? '←' : '→'} Turn`;
    } else if (this.tutorial && p.fly <= 0 && p.ride <= 0) {
      const rockAhead = (seg.rocks || []).find(([a]) => a - p.s > 0 && a - p.s < 30);
      if (p.onSand && p.sign > 65 && p.thumpers > 0) {
        tip = isTouch ? 'Tap THUMPER to lure the worm' : 'E — plant a thumper';
      } else if (rockAhead && p.sign > 30) {
        tip = 'Stone ahead — the Maker cannot follow';
      } else if (p.onSand && p.sign > 35) {
        tip = isTouch ? 'Swipe unevenly — break your rhythm' : 'Jump · slide · weave — unevenly';
      } else {
        for (const o of seg.obstacles) {
          const d = o.s0 - p.s;
          if (d < 0 || d > 28 || !o.active || o.fatal) continue;
          if (o.y0 > 1) tip = isTouch ? 'Swipe down to slide' : '↓ Slide';
          else if (o.y1 < 2) tip = isTouch ? 'Swipe up to jump' : '↑ Jump';
          else tip = isTouch ? 'Swipe to dodge' : '← → Dodge';
          break;
        }
        if (!tip) for (const [a] of seg.gaps) if (a - p.s > 0 && a - p.s < 28) { tip = isTouch ? 'Swipe up to leap' : '↑ Leap the sinkhole'; break; }
      }
    }
    if (p.qte) tip = null; // the prompt has the stage
    if (tip) {
      ui.tip.classList.remove('hidden');
      this.setText('tip', ui.tip, tip);
    } else ui.tip.classList.add('hidden');
  }

  die(cause, quiet = false) {
    if (this.state !== 'running') return;
    const p = this.p;
    this.state = 'dying';
    this.deathT = 0;
    this.deathCause = cause;
    p.alive = false;
    this.audio.thopter(false);
    this.thopter.group.visible = false;
    this.ui.turnHint.classList.add('hidden');
    this.ui.tip.classList.add('hidden');
    this.runner.setShield(false);
    if (!quiet) {
      if (cause === 'crash' || cause === 'geyser') { this.audio.crash(); this.flash('#ffffff', 0.5); }
      this.shake = 1;
    }
    this.deathPos = this.playerPos.clone();
    this.cinema(true);
    this.audio.braam(1);
    this.deathFwd = p.seg.fwd.clone();
    if (cause === 'edge') p.vy = 3;
  }

  updateDeath(dt) {
    const p = this.p;
    this.deathT += dt;
    const t = this.deathT;
    if (this.deathCause === 'fall' || this.deathCause === 'edge') {
      p.vy -= GRAVITY * dt;
      p.y = Math.max(SAND_BED - 2.4, p.y + p.vy * dt); // down the throat of the sinkhole
      if (this.deathCause === 'edge') p.s += Math.max(0, 8 - t * 10) * dt;
    } else {
      p.s += Math.max(0, p.speed * (0.25 - t)) * dt;
    }
    if (t > 0.55 && !this.devour.active) {
      const base = this.v.a.copy(this.playerPos);
      base.y = this.deathCause === 'fall' || this.deathCause === 'edge' ? SAND_BED - 1.5 : 0;
      this.devour.start(base, this.deathFwd);
      this.audio.roar();
      this.shake = 1.2;
      for (let k = 0; k < 3; k++) {
        this.dustPool.emit(base, { count: 60, spread: [4, 0.5, 4], vel: [0, 9 + k * 4, 0], velSpread: 6, life: 2.2, size: 2.6, grow: 3, color: this.colors.sand, gravity: -7, drag: 0.6, alpha: 0.4 });
      }
      // shockwave: a ring of sand thrown out across the ground as the Maker erupts
      for (let k = 0; k < 48; k++) {
        const a = (k / 48) * Math.PI * 2;
        this.sandPool.emit(this.v.d.set(base.x + Math.cos(a) * 3, base.y + 0.4, base.z + Math.sin(a) * 3), {
          count: 2, spread: [0.6, 0.2, 0.6], vel: [Math.cos(a) * 16, 2.5, Math.sin(a) * 16], velSpread: 2,
          life: 1.6, size: 2, grow: 5, color: this.colors.sand, gravity: -3, drag: 1.4, alpha: 0.55,
        });
      }
    }
    if (this.devour.active && this.devour.t > 0.5) this.runner.root.visible = false;
    if (t > 3.1) this.gameOver();
  }

  gameOver() {
    const p = this.p;
    this.state = 'over';
    const score = Math.floor(p.score);
    const prevBest = this.save.best || 0;
    const isBest = score > prevBest;
    this.save.best = Math.max(prevBest, score);
    this.save.runs = [...(this.save.runs || []), { score, dist: Math.floor(p.runDist), spice: p.spice, at: Date.now() }]
      .sort((a, b) => b.score - a.score).slice(0, 5);
    this.writeSave();
    const [title, sub] = DEATHS[this.deathCause] || DEATHS.crash;
    $('over-title').textContent = title;
    $('over-cause').textContent = sub;
    $('over-saying').textContent = `“${saying()}”`;
    const w = waypointAt(p.wp || 0);
    const short = Math.max(0, w.at - p.runDist);
    $('over-chapter').textContent = `Chapter ${roman(p.chapter)} · ${short < 1000 ? Math.round(short) + ' m' : (short / 1000).toFixed(1) + ' km'} short of ${w.name}`;
    // the score counts up as it arrives
    const scoreEl = $('over-score');
    scoreEl.textContent = '0';
    const t0 = performance.now() + 700;
    const count = (now) => {
      const k = Math.min(1, Math.max(0, (now - t0) / 1400));
      scoreEl.textContent = Math.round(score * (1 - Math.pow(1 - k, 3))).toLocaleString();
      if (k < 1 && this.state === 'over') requestAnimationFrame(count);
    };
    requestAnimationFrame(count);
    $('over-dist').textContent = Math.floor(p.runDist).toLocaleString();
    $('over-spice').textContent = p.spice.toLocaleString();
    $('over-best').textContent = Math.floor(this.save.best).toLocaleString();
    $('over-rides').textContent = String(p.rides);
    $('new-best').classList.toggle('hidden', !isBest);
    // journey line: where in the cycle of five biomes Ishra fell
    const z = zoneAt(p.runDist);
    const at = ((z.index + z.local / z.zone.length) / ZONES.length) * 100;
    // the journey line draws itself in after the verdict lands
    const fill = $('journey-fill'), mark = $('journey-mark');
    fill.style.transition = mark.style.transition = 'none';
    fill.style.width = '0%';
    mark.style.left = '0%';
    void fill.offsetWidth;
    fill.style.transition = mark.style.transition = '';
    fill.style.width = `${at}%`;
    mark.style.left = `${at}%`;
    [...$('journey-labels').children].forEach((el, i) => { el.className = i < z.index ? 'past' : i === z.index ? 'here' : ''; });
    this.ui.hud.classList.add('hidden');
    this.ui.over.classList.remove('hidden');
    this.ui.tint.style.opacity = 0;
    this.ui.danger.style.opacity = 0;
    this.ui.last.danger = '0.00';
    setTimeout(() => $('again-btn').focus({ preventScroll: true }), 50);
  }

  /* ---------------- world & presentation ---------------- */

  updatePlayerVisual(dt) {
    const p = this.p;
    const seg = p.seg;
    if (Math.abs(p.rideOff) > 0.01) this.track.sample(seg.startDist + p.s, p.laneX + p.rideOff, this.playerPos);
    else this.track.localToWorld(seg, p.laneX, p.s, this.playerPos);
    this.playerPos.y = p.y;
    const r = this.runner.root;
    r.position.copy(this.playerPos);
    // riding, face the way the worm is actually travelling (it swings across the trail);
    // on foot, face down the trail
    let wantYaw = YAWS[seg.dir];
    if (Math.abs(p.rideOff) > 0.6 && this.lastRiderPos && dt > 0) {
      const dx = this.playerPos.x - this.lastRiderPos.x, dz = this.playerPos.z - this.lastRiderPos.z;
      if (dx * dx + dz * dz > 1e-4) wantYaw = Math.atan2(-dx, -dz);
    }
    (this.lastRiderPos || (this.lastRiderPos = new THREE.Vector3())).copy(this.playerPos);
    p.visualYaw = angleDamp(p.visualYaw, wantYaw, Math.abs(p.rideOff) > 0.6 ? 6 : 14, dt);
    r.rotation.y = p.visualYaw;
    r.rotation.z = (p.laneX - p.lane * LANE_W) * 0.08;
    let mode = 'idle';
    if (this.state === 'running') {
      mode = p.ride > 0 ? 'ride' : p.fly > 0 ? 'fly' : p.slideT > 0 ? 'slide' : !p.grounded ? 'jump' : p.stumbleT > 0 ? 'stumble' : 'run';
    } else if (this.state === 'dying' || this.state === 'over') mode = 'dead';
    else if (this.state === 'paused') mode = 'none';
    this.runner.setHooks(p.hooks, p.ride > 0);
    if (mode !== 'none') this.runner.update(dt, { speed: p.speed, mode, vy: p.vy });

    const b = this.blob;
    const overGap = this.track.inGap(seg, p.s, 0.2) || p.s > seg.length + DECK_HALF;
    b.visible = this.runner.root.visible && !overGap && p.y > -0.5 && Math.abs(p.rideOff) < 0.5;
    if (b.visible) {
      const lift = Math.max(0, p.y);
      b.position.set(this.playerPos.x, 0.02, this.playerPos.z);
      const k = (p.slideT > 0 ? 1.6 : 1.1) / (1 + lift * 0.35);
      b.scale.set(k, (p.slideT > 0 ? 2.2 : 1.3) / (1 + lift * 0.35), 1);
      b.rotation.z = p.visualYaw;
      b.material.opacity = 0.55 / (1 + lift * 0.6);
    }

    const th = this.thopter;
    const flying = this.state === 'running' && p.fly > 0;
    if (flying || th.group.visible) {
      th.group.visible = true;
      th.group.position.copy(this.playerPos).addScaledVector(UP, 2.2);
      th.group.rotation.y = p.visualYaw;
      const target = flying ? 1 : 0;
      th.scaleK = damp(th.scaleK ?? 0, target, 6, dt);
      th.group.scale.setScalar(Math.max(0.001, th.scaleK));
      if (!flying && th.scaleK < 0.02) th.group.visible = false;
      th.update(this.time);
    }
  }

  updateAtmosphere(dt) {
    const pathDist = this.p.seg.startDist + this.p.s;
    const z = zoneAt(pathDist).zone;
    const a = this.atmo;
    const r = 0.7;
    a.fogNear = damp(a.fogNear, z.fogNear, r, dt);
    a.fogFar = damp(a.fogFar, z.fogFar, r, dt);
    a.haze = damp(a.haze, z.haze, r, dt);
    a.dust = damp(a.dust, z.dust, r, dt);
    a.wind = damp(a.wind, z.wind, r, dt);
    for (let i = 0; i < 3; i++) a.tint[i] = damp(a.tint[i], z.tint[i], r, dt);
    if (this.state === 'running' && a.haze > 0.6 && Math.random() < dt * 0.18) {
      this.sky.flash = 1;
      this.flash('#e8e4ff', 0.35);
      this.audio.thunder();
    }
  }

  updateThumpers(dt) {
    for (let i = this.planted.length - 1; i >= 0; i--) {
      const t = this.planted[i];
      t.life -= dt;
      t.beatT -= dt;
      t.head.position.y = 2.4 + Math.abs(Math.sin(t.life * 5.7)) * 0.45;
      if (t.beatT <= 0 && t.life > 1) {
        t.beatT = 0.55;
        if (this.state === 'running') this.audio.thump();
        this.dustPool.emit(t.pos, { count: 3, spread: [0.4, 0.05, 0.4], vel: [0, 1.4, 0], velSpread: 1.2, life: 0.9, size: 0.6, grow: 1.5, color: this.colors.sandLight, gravity: -0.5, drag: 2, alpha: 0.5 });
      }
      if (t.life <= 0) {
        this.scene.remove(t.group);
        this.planted.splice(i, 1);
      }
    }
  }

  // Sand plumes where the chaser breaks the surface.
  // The chaser in the sand: the travelling mound, grains boiling off it, curtains pouring off
  // its back where it breaks the surface, and spray thrown from the head as it ploughs.
  wormSand(dt) {
    const ch = this.chaser, m = ch.model;
    const on = m.group.visible ? (this.state === 'running' && this.p.ride > 0 ? 1 : smoothstep(0.03, 0.3, ch.closeness)) : 0;
    this.moundK = damp(this.moundK, on, on > this.moundK ? 3 : 1.5, dt);
    if (!m.group.visible && this.moundK < 0.03) { this.mound.update(m, null, 0); return; }
    this.mound.update(m, (x, z) => this.terrain.heightAt(x, z), this.moundK);
    if (!m.group.visible) return;
    const pts = m.points, R = m.radius, k = Math.max(ch.closeness, 0.35);
    const v = this.v.d;
    for (let i = 1; i < pts.length - 6; i += 2) {
      if (Math.random() > 0.3 * k) continue;
      const q = pts[i];
      const r = R * (1 - Math.pow(i / m.count, 2) * 0.55);
      const top = q.y + r, s = SAND_BED;
      if (top > s + 0.3) {
        // the back is out of the sand: it pours off in curtains
        this.sandPool.emit(v.set(q.x, top - 0.2, q.z), { count: 2, spread: [r * 0.7, 0.15, r * 0.7], vel: [0, 0.6, 0], velSpread: 0.9, life: 1.2, size: 0.8, grow: 2.4, color: this.colors.sandLight, gravity: -9, drag: 0.35, alpha: 0.6 });
      } else if (s - top < r * 1.6) {
        // shallow beneath: grains jump from the crest of the mound
        this.sandPool.emit(v.set(q.x, s + r * 0.45, q.z), { count: 1, spread: [r * 0.9, 0.1, r * 0.9], vel: [0, 2.8, 0], velSpread: 1.6, life: 1.1, size: 1.1, grow: 2.6, color: this.colors.sand, gravity: -7, drag: 0.6, alpha: 0.45 });
      }
    }
    // bow spray: sand thrown forward and aside where the head shoulders through
    const h = pts[0];
    if (h.y > SAND_BED - R * 1.5 && Math.random() < 0.7 * k) {
      const f = this.v.e.subVectors(pts[0], pts[2]).setY(0).normalize();
      for (const side of [-1, 1]) {
        this.sandPool.emit(v.set(h.x + f.z * side * R * 0.9, Math.max(SAND_BED + 0.3, h.y), h.z - f.x * side * R * 0.9), {
          count: 2, spread: [0.8, 0.3, 0.8], vel: [f.x * 7 + f.z * side * 4, 5.5, f.z * 7 - f.x * side * 4], velSpread: 2.2,
          life: 1.4, size: 1.4, grow: 3.2, color: this.colors.sand, gravity: -9, drag: 0.5, alpha: 0.55,
        });
      }
    }
  }

  // sand streaming off a worm arcing through the air, falling back to the dunes
  sandCurtains(model, ground, rate, scale) {
    const pts = model.points, R = model.radius;
    for (let n = 0; n < rate; n++) {
      const i = Math.floor(Math.random() * (pts.length - 2));
      const q = pts[i];
      if (q.y < ground + 2) continue;
      const r = R * (1 - Math.pow(i / model.count, 2) * 0.55);
      this.sandPool.emit(this.v.d.set(q.x, q.y + r * 0.6, q.z), {
        count: 2, spread: [r * 0.6, 0.3, r * 0.6], vel: [0, 0.4, 0], velSpread: 1.2 * scale,
        life: 1.6 + scale * 0.4, size: 1.4 * scale, grow: 4 * scale, color: this.colors.sandLight, gravity: -9.5, drag: 0.25, alpha: 0.5,
      });
    }
  }

  // Wind lifting sand off nearby dune crests.
  crestStreamers() {
    const wd = this.windDir;
    const c = this.camera.position;
    const tries = this.quality === 'high' ? 5 : 2;
    for (let k = 0; k < tries; k++) {
      const a = Math.random() * Math.PI * 2, r = 40 + Math.random() * 130;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      const h = this.terrain.heightAt(x, z);
      if (h < SAND_BED + 4) continue;
      const up = this.terrain.heightAt(x - wd.x * 7, z - wd.z * 7);
      const dn = this.terrain.heightAt(x + wd.x * 7, z + wd.z * 7);
      if (h < up + 0.6 || h < dn + 0.6) continue;
      const w = 5 + this.atmo.wind * 4;
      this.dustPool.emit(this.v.d.set(x, h + 0.4, z), { count: 6, spread: [3, 0.3, 3], vel: [wd.x * w, 1.2, wd.z * w], velSpread: 1.2, life: 2.4, size: 2.4, grow: 4.5, color: this.colors.sandLight, gravity: 0.2, drag: 0.3, alpha: 0.28 });
    }
  }

  updateBreaches(dt) {
    this.breachTimer -= dt;
    if (this.breachTimer <= 0) {
      const b = this.breaches.find((x) => !x.active);
      if (b) {
        // on the title screen, breach where the drifting camera is actually looking
        const fwd = this.state === 'title'
          ? this.camera.getWorldDirection(this.v.a).setY(0).normalize()
          : this.v.a.set(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
        const ang = (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.6);
        const dist = 170 + Math.random() * 130;
        const dir = this.v.b.copy(fwd).applyAxisAngle(UP, ang);
        const origin = this.v.c.copy(this.playerPos).addScaledVector(dir, dist);
        const across = this.v.d.copy(dir).applyAxisAngle(UP, Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1));
        origin.addScaledVector(across, -50);
        origin.y = this.terrain.heightAt(origin.x, origin.z) - 4;
        b.start(origin, across, 32 + Math.random() * 18, 7 + Math.random() * 2);
        this.audio.breach(origin);
      }
      // the Maker shows itself more often on the title screen, to give the menu some life
      this.breachTimer = this.state === 'title' ? 9 + Math.random() * 5 : 16 + Math.random() * 20;
    }
    for (const b of this.breaches) {
      const bursts = b.update(dt);
      if (b.active) this.sandCurtains(b.model, b.origin.y + 4, this.quality === 'high' ? 5 : 2, 2.4);
      if (bursts) {
        for (const pt of bursts) {
          this.dustPool.emit(pt, { count: 90, spread: [10, 2, 10], vel: [0, 14, 0], velSpread: 8, life: 3.5, size: 9, grow: 8, color: this.colors.sand, gravity: -4, drag: 0.4, alpha: 0.7 });
          if (this.state === 'running') this.shake = Math.max(this.shake, 0.15);
        }
      }
    }
  }

  updateCamera(dt) {
    const cam = this.camera;
    const p = this.p;
    const pos = this.playerPos;
    const st = this.state;
    const tp = this.v.a, look = this.v.b;
    let rate = 9;
    if (st === 'running' || st === 'paused') {
      this.camYaw = angleDamp(this.camYaw, YAWS[p.seg.dir], 6.5, dt);
      const fwd = this.v.c.set(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
      const sp = clamp((p.speed - 15) / 19, 0, 1);
      const fly = p.fly > 0 ? 1 : 0;
      const ride = p.ride > 0 ? 1 : 0;
      const back = 7.4 + sp * 1.4 + fly * 3 + ride * 4;
      tp.copy(pos).addScaledVector(fwd, -back);
      tp.y = Math.max(pos.y, 0) * 0.55 + 3.4 + fly * 2.5 + ride * 2.5;
      look.copy(pos).addScaledVector(fwd, 8);
      look.y = Math.max(pos.y, 0) * 0.7 + 1.2;
      cam.fov = damp(cam.fov, 60 + sp * 12 + (p.trance > 0 ? -4 : 0), 3, dt);
      rate = 12;
    } else if (st === 'intro') {
      // the opening shots: the erg from on high, alongside Ishra, close on the face, then round
      // behind to the gameplay view as the run begins
      const seg = p.seg, fwd = seg.fwd, right = seg.right;
      const k = clamp((this.introT % INTRO_SHOT) / INTRO_SHOT, 0, 1);
      const i = Math.max(0, this.introIdx);
      this.camYaw = YAWS[seg.dir];
      if (i === 0) {
        tp.copy(pos).addScaledVector(fwd, 34 - k * 12).addScaledVector(right, 24 - k * 6);
        tp.y = pos.y + 15 - k * 3;
        look.copy(pos).addScaledVector(fwd, -10);
        look.y = pos.y + 2;
      } else if (i === 1) {
        tp.copy(pos).addScaledVector(right, 5.2).addScaledVector(fwd, -1.5 + k * 3);
        tp.y = pos.y + 1.3;
        look.copy(pos).addScaledVector(fwd, 1);
        look.y = pos.y + 1.2;
      } else if (i === 2) {
        tp.copy(pos).addScaledVector(fwd, 3.8 - k * 0.6).addScaledVector(right, 1.0);
        tp.y = pos.y + 1.45;
        look.copy(pos);
        look.y = pos.y + 1.25;
      } else {
        tp.copy(pos).addScaledVector(fwd, -7.4);
        tp.y = pos.y + 3.4;
        look.copy(pos).addScaledVector(fwd, 8);
        look.y = pos.y + 1.2;
      }
      rate = i >= 3 ? 2.2 : 1.4;
      cam.fov = damp(cam.fov, i === 2 ? 38 : i === 0 ? 50 : 55, 2, dt);
    } else if (st === 'dying' || (st === 'over' && this.deathPos)) {
      const c = this.deathPos;
      const a = this.camYaw + (this.deathT || 0) * 0.25;
      tp.set(c.x + Math.sin(a) * 24, Math.max(c.y, 0) + 10, c.z + Math.cos(a) * 24);
      look.copy(c).addScaledVector(UP, 5);
      rate = st === 'dying' ? 3.5 : 1.2;
      cam.fov = damp(cam.fov, 58, 2, dt);
    } else {
      // the title camera drifts: slow orbit, breathing distance and height, a low heroic angle
      const t = this.time * 0.085 + 2.2;
      const rad = 13 + Math.sin(this.time * 0.11) * 3;
      tp.set(pos.x + Math.sin(t) * rad, pos.y + 3.6 + Math.sin(this.time * 0.17) * 1.6, pos.z + Math.cos(t) * rad);
      look.copy(pos).addScaledVector(UP, 1.8);
      rate = 2.5;
      cam.fov = damp(cam.fov, 55, 2, dt);
    }
    // smooth follow on a clean base position; shake is layered on top and never fed back in
    const base = this.camBase || (this.camBase = cam.position.clone());
    base.x = damp(base.x, tp.x, rate, dt);
    base.y = damp(base.y, tp.y, rate, dt);
    base.z = damp(base.z, tp.z, rate, dt);
    if (!this.lookAt) this.lookAt = look.clone();
    this.lookAt.x = damp(this.lookAt.x, look.x, rate * 1.4, dt);
    this.lookAt.y = damp(this.lookAt.y, look.y, rate * 1.4, dt);
    this.lookAt.z = damp(this.lookAt.z, look.z, rate * 1.4, dt);
    // a low rumble only when the worm is genuinely close
    const worm = st === 'running' ? Math.max(0, this.chaser.closeness - 0.55) / 0.45 : 0;
    const sh = this.shake + worm * 0.06;
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const t = this.time;
    cam.position.set(
      base.x + (Math.sin(t * 37.1) + Math.sin(t * 23.3 + 1.7)) * sh * 0.12,
      base.y + (Math.sin(t * 41.7 + 0.6) + Math.sin(t * 19.9 + 2.9)) * sh * 0.12,
      base.z
    );
    cam.lookAt(this.lookAt);
    cam.updateProjectionMatrix();
  }

  updateHUD() {
    const p = this.p;
    const ui = this.ui;
    this.setText('score', ui.score, Math.floor(p.score).toLocaleString());
    this.setText('mult', ui.mult, `×${p.mult}`);
    this.setText('spice', ui.spice, String(p.spice));
    this.setText('dist', ui.dist, Math.floor(p.runDist).toLocaleString());
    const close = p.sign / 100;
    const signPct = Math.round(close * 100);
    ui.wormMeter.classList.toggle('show', p.onSand || close > 0.03);
    ui.wormMeter.classList.toggle('lured', p.lure > 0);
    ui.wormFill.style.width = `${signPct}%`;
    this.setText('wormPct', ui.wormPct, `${signPct}%`);
    const danger = (Math.max(0, signPct - 40) / 60).toFixed(2);
    if (ui.last.danger !== danger) { ui.last.danger = danger; ui.danger.style.opacity = danger; }
    ui.thumperBtn.classList.toggle('show', p.thumpers > 0 && p.ride <= 0 && (signPct >= 40 || p.onSand));
    ui.stride.classList.toggle('hidden', !p.onSand || p.ride > 0);
    const water = Math.round(p.water);
    if (ui.last.water !== water) {
      ui.last.water = water;
      ui.waterPct.textContent = `${water}%`;
      const lit = Math.ceil(water / 10);
      ui.waterSegs.forEach((s, i) => s.classList.toggle('on', i < lit));
    }
    ui.waterBar.classList.toggle('low', p.water < 25);
    const vision = p.trance > 0 ? (p.trance / TRANCE_TIME) * 100 : p.vision;
    ui.visionBar.classList.toggle('show', vision > 0.5);
    ui.visionFill.style.width = `${Math.round(vision)}%`;
    const pu = [];
    if (p.shield) pu.push(['Shield', '#5fb8ff', 1]);
    if (p.trance > 0) pu.push(['Prescience', '#9d7bff', p.trance / TRANCE_TIME]);
    if (p.ride > 0) pu.push(['Sandrider', '#ffb35c', p.ride / RIDE_TIME]);
    if (p.lure > 0) pu.push(['Thumper', '#ff8a2a', p.lure / 7]);
    if (p.fly > 0) pu.push(['Thopter', '#ffc54a', p.fly / THOPTER_TIME]);
    if (p.silent > 0) pu.push(['Silent Step', '#f1e6cc', p.silent / 10]);
    if (p.seal > 0) pu.push(['Sealed', '#5fe0d0', p.seal / 15]);
    if (p.rush > 0) pu.push(['Spice Rush', '#ff8a2a', p.rush / 5]);
    const key = pu.map((x) => x[0] + Math.round(x[2] * 30)).join();
    if (key !== ui.last.pu) {
      ui.last.pu = key;
      ui.powerups.innerHTML = pu.map(([n, c, f]) => `<div class="pu"><span>${n}</span><span class="t" style="color:${c}"><b style="width:${Math.round(f * 100)}%"></b></span></div>`).join('');
    }
    const tint = p.trance > 0 ? 0.2 : 0;
    if (ui.last.tint !== tint) {
      ui.last.tint = tint;
      ui.tint.style.background = '#3a4cff';
      ui.tint.style.opacity = tint;
    }
  }

  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 0.016;
    this.governPerformance(dt);
    dt = Math.min(dt, 0.05);
    // a quick-time prompt runs in real time while the world slows around it
    if (this.state === 'running' && this.p.qte) {
      this.updateQTE(dt);
      if (this.p.qte) dt *= this.p.qte.slow;
    }
    const st = this.state;
    if (st !== 'paused') this.time += dt;
    updatePhotoTextures(dt);
    const p = this.p;

    if (st === 'running') this.updateRun(dt);
    else if (st === 'intro') this.updateIntro(dt);
    else if (st === 'dying') this.updateDeath(dt);
    else if (st === 'over') this.deathT += dt * 0.2;

    if (st !== 'paused') {
      const pathDist = p.seg.startDist + p.s;
      this.track.ensure(pathDist);
      this.updatePlayerVisual(dt);
      this.terrain.update(this.playerPos.x, this.playerPos.z, this.quality === 'high' ? 2 : 1);
      this.track.update(dt, this.time);
      this.updateAtmosphere(dt);
      this.sky.update(dt, this.camera.position, this.atmo, this.time);
      const night = this.sky.night;
      mats.halo.opacity = night * 0.85;
      mats.halo.visible = night > 0.04;
      mats.globe.color.setRGB(1.6 + night * 2.4, 1.1 + night * 1.6, 0.55 + night * 0.8);

      const chaseVisible = st === 'running' || st === 'paused';
      if (st === 'running' && p.ride > 0) this.chaser.ride(dt, pathDist + 3 * this.chaser.model.segLen, p.laneX + p.rideOff);
      else this.chaser.update(dt, pathDist, 40 - p.sign * 0.37, chaseVisible && p.sign > 4 && p.lure <= 0);
      this.updateThumpers(dt);
      this.wormSand(dt);
      this.crestStreamers();
      if (chaseVisible && this.chaser.closeness > 0.25 && Math.random() < 0.7) {
        this.dustPool.emit(this.chaser.headPos, { count: 3, spread: [3, 0.5, 3], vel: [0, 5, 0], velSpread: 3, life: 1.4, size: 2.2, grow: 2.5, color: this.colors.sand, gravity: -4, alpha: 0.6 });
      }
      this.updateBreaches(dt);
      this.devour.update(dt);
      if (this.devour.active && this.devour.t < 2) this.sandCurtains(this.devour.model, this.devour.base.y, 4, 1.3);
      for (const f of this.flock) {
        f.a += f.w * dt * f.dir;
        const c = this.playerPos;
        f.t.group.position.set(c.x + Math.cos(f.a) * f.r, f.h + Math.sin(this.time * 0.5 + f.r) * 3, c.z + Math.sin(f.a) * f.r);
        f.t.group.rotation.y = -f.a + (f.dir > 0 ? Math.PI : 0);
        f.t.update(this.time);
      }
      this.dustPool.update(dt);
      this.glowPool.update(dt);
      this.sandPool.update(dt);
      this.dustColor.copy(this.sky.horizon).lerp(this.colors.sand, 0.4);
      this.dust.update(this.time, this.camera.position, this.atmo.dust, this.atmo.wind, this.dustColor);
      this.stormWall.update(this.time, this.camera.position, this.camYaw, distToZone(pathDist, 'storm'), this.sky.horizon, this.sky.uniforms.uDay.value);
      this.updateCamera(dt);
      if (st === 'running') this.updateHUD();
    }

    const running = st === 'running';
    const cam = this.camera;
    const lf = (this._lf || (this._lf = { fwd: new THREE.Vector3(), up: new THREE.Vector3() }));
    cam.getWorldDirection(lf.fwd);
    lf.up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    this.audio.update(dt, {
      speed: running ? p.speed : 0,
      storm: this.atmo.haze,
      worm: running ? this.chaser.closeness : st === 'dying' ? 0.6 : 0,
      intensity: running ? 0.3 + clamp((p.speed - 15) / 19, 0, 1) * 0.6 : 0.12,
      listener: { pos: cam.position, fwd: lf.fwd, up: lf.up },
      wormPos: (running || st === 'paused') && this.chaser.model.group.visible ? this.chaser.headPos : null,
      room: ROOM[p.seg.zone.id] ?? 0.12,
      water: running ? p.water : 100,
      sign: running ? p.sign : 0,
      muffle: st === 'paused' ? 'paused' : st === 'dying' || st === 'over' ? 'dying' : running && p.trance > 0 ? 'trance' : null,
    });

    if (this.grade) {
      this.grade.uniforms.uTime.value = this.time;
      this.grade.uniforms.uNight.value = this.sky.night;
      this.shimmer.uniforms.uTime.value = this.time;
      this.shimmer.uniforms.uAmt.value = this.sky.uniforms.uDay.value * (1 - this.atmo.haze);
      this.grade.uniforms.uWarm.value = this.p.trance > 0 && this.state === 'running' ? -1 : 1;
      this.updateSunShafts(dt);
    }
    if (this.composer && this.quality === 'high') this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
