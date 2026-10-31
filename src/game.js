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
import { DustField, ParticlePool } from './effects.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { ZONES, zoneAt } from './zones.js';

const GRAVITY = 40;
const JUMP_V = 13.2;
const SLIDE_TIME = 0.8;
const TRANCE_TIME = 8;
const THOPTER_TIME = 7.5;
const FLY_H = 7;
const UP = new THREE.Vector3(0, 1, 0);
const isTouch = matchMedia('(pointer: coarse)').matches;

const DEATHS = {
  crash: ['Shattered on the rocks', 'The desert does not forgive'],
  geyser: ['Consumed by a spice blow', 'The melange erupts without warning'],
  fall: ['Swallowed by the sands', 'The causeway gave way beneath you'],
  edge: ['Lost off the causeway', 'Every corner must be turned'],
  worm: ['Taken by the Maker', 'Wormsign was too close'],
};

const MILESTONES = [
  [500, 'The desert notices you'], [1000, 'A true sandwalker'], [2000, 'Fremen pace'],
  [3500, 'The sietch speaks your name'], [5000, 'Rider of the deep desert'], [7500, 'Legend of the dunes'], [10000, 'Beyond the Shield Wall of legend'],
];

const $ = (id) => document.getElementById(id);

// Final display-space grade: gentle S-curve, warm highlights / cool shadows, film grain.
const GRADE = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uWarm: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uWarm; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.3);
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, 1.1);
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
    this.terrain = new Terrain(this.scene, []);
    this.track = new Track(this.scene, this.terrain);
    this.sky = new Sky(this.scene);
    this.runner = new Runner();
    this.scene.add(this.runner.root);
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex.glow, color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.renderOrder = 3;
    this.scene.add(this.blob);
    this.chaser = new ChaserWorm(this.scene, this.track);
    this.breaches = [new BreachWorm(this.scene), new BreachWorm(this.scene)];
    this.devour = new DevourWorm(this.scene);
    this.dust = new DustField(this.scene);
    this.dustPool = new ParticlePool(this.scene, 1800, false);
    this.glowPool = new ParticlePool(this.scene, 900, true);

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
    this.camYaw = 0;
    this.shake = 0;
    this.breachTimer = 4;
    this.v = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3() };
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
    });
    $('play-btn').addEventListener('click', () => this.start());
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
    const syncSound = () => { sb.textContent = `Sound: ${this.audio.enabled ? 'On' : 'Off'}`; };
    sb.addEventListener('click', () => { this.audio.init(); this.audio.setEnabled(!this.audio.enabled); syncSound(); });
    syncSound();
    this.refreshTitle();
    ui.last = {};
  }

  refreshTitle() {
    $('best-title').textContent = Math.floor(this.save.best).toLocaleString();
    const list = $('runs-list');
    list.innerHTML = '';
    for (const r of (this.save.runs || []).slice(0, 5)) {
      const li = document.createElement('li');
      li.textContent = `${Math.floor(r.score).toLocaleString()} · ${Math.floor(r.dist)}m`;
      list.appendChild(li);
    }
    $('quality-btn').textContent = `Quality: ${this.quality === 'low' ? 'Low' : 'High'}`;
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
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.5, 0.9);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
      this.grade = new ShaderPass(GRADE);
      this.composer.addPass(this.grade);
    }
    if (changed) {
      this.scene.traverse((o) => {
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; });
      });
      this.resize();
    }
    $('quality-btn').textContent = `Quality: ${high ? 'High' : 'Low'}`;
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
  }

  /* ---------------- run lifecycle ---------------- */

  resetWorld(seed) {
    this.track.reset(seed);
    this.terrain.clear();
    this.track.ensure(0);
    this.terrain.buildAll(0, 0);
    this.devour.stop();
    this.dustPool.clear();
    this.glowPool.clear();
    const seg = this.track.segments[0];
    this.p = {
      seg, s: 6, lane: 0, laneX: 0, prevLaneX: 0, prevS: 6, y: 0, vy: 0, grounded: true,
      slideT: 0, slideQueued: false, pendingTurn: 0, speed: 0, runDist: 0,
      score: 0, spice: 0, mult: 1, shield: false, trance: 0, fly: 0, invuln: 0,
      stumbleT: 0, wormGap: 45, combo: 0, lastPickup: 0, stepT: 0,
      zoneIndex: 0, milestone: 0, spiceMilestone: 0, tips: 0, tipFor: null, visualYaw: 0, alive: true,
    };
    this.runner.root.visible = true;
    this.runner.setShield(false);
    this.camYaw = 0;
  }

  start() {
    this.audio.init();
    if (!this.fresh) this.resetWorld(Math.floor(Math.random() * 1e9));
    this.fresh = false;
    const p = this.p;
    p.wormGap = 3;
    p.s = 6;
    this.state = 'running';
    this.save.played = (this.save.played || 0) + 1;
    this.tutorial = this.save.played <= 3;
    this.ui.title.classList.add('hidden');
    this.ui.over.classList.add('hidden');
    this.ui.pause.classList.add('hidden');
    this.ui.hud.classList.remove('hidden');
    this.banner(zoneAt(0).zone.name);
    this.audio.roar();
    this.shake = 0.6;
    this.thopter.group.visible = false;
  }

  pause() {
    if (this.state !== 'running') return;
    this.state = 'paused';
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
    this.resetWorld(Math.floor(Math.random() * 1e9));
    this.fresh = true;
    this.state = 'title';
    this.ui.over.classList.add('hidden');
    this.ui.hud.classList.add('hidden');
    this.ui.title.classList.remove('hidden');
    this.refreshTitle();
  }

  onAction(a) {
    const st = this.state;
    if (st === 'title') {
      if (a === 'confirm') this.start();
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
    if (a === 'left' || a === 'right') {
      const dir = a === 'left' ? -1 : 1;
      const seg = p.seg;
      const inWindow = p.s > seg.length - 26 && p.s < seg.length + DECK_HALF;
      if (inWindow && dir === seg.turn) {
        p.pendingTurn = dir;
        if (p.s >= seg.length - 1.2) this.executeTurn();
        return;
      }
      const nl = clamp(p.lane + dir, -1, 1);
      if (nl !== p.lane) { p.lane = nl; this.audio.whoosh(600, 1200, 0.12, 0.1); }
    } else if (a === 'jump' || a === 'tap') {
      if (p.fly > 0) return;
      if (p.grounded) {
        p.vy = JUMP_V;
        p.grounded = false;
        p.slideT = 0;
        this.audio.jump();
      }
    } else if (a === 'slide') {
      if (p.fly > 0) return;
      if (p.grounded) {
        if (p.slideT <= 0) this.audio.slide();
        p.slideT = SLIDE_TIME;
      } else {
        p.vy = Math.min(p.vy, -22);
        p.slideQueued = true;
      }
    }
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
    p.lane = clamp(Math.round(p.laneX / LANE_W), -1, 1);
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
    p.speed = speedAt(p.runDist) * (p.stumbleT > 0 ? 0.82 : 1) * (p.fly > 0 ? 1.2 : 1);
    const ds = p.speed * gdt;
    p.s += ds;
    p.runDist += ds;

    p.trance = Math.max(0, p.trance - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.stumbleT = Math.max(0, p.stumbleT - dt);
    if (p.fly > 0) {
      p.fly -= dt;
      if (p.fly <= 0 && this.track.inGap(p.seg, p.s + 6, -2)) p.fly = 0.3;
      if (p.fly <= 0) { p.fly = 0; p.invuln = 1.2; this.audio.thopter(false); }
    }

    let seg = p.seg;
    if (p.fly > 0 && p.s >= seg.length - 2) p.pendingTurn = seg.turn;
    if (p.pendingTurn && p.s >= seg.length - 1.2) {
      this.executeTurn();
      seg = p.seg;
    } else if (p.s > seg.length + DECK_HALF - 0.4) {
      return this.die('edge');
    }

    p.laneX = damp(p.laneX, p.lane * LANE_W, 15, gdt);

    if (p.fly > 0) {
      const target = p.fly < 0.9 ? 0.4 : FLY_H;
      p.y = damp(p.y, target, 3.2, gdt);
      p.vy = 0;
      p.grounded = false;
    } else {
      p.vy -= GRAVITY * gdt;
      p.y += p.vy * gdt;
      const support = !this.track.inGap(seg, p.s, 0.3);
      if (p.y <= 0 && support && p.y > -0.7) {
        if (!p.grounded && p.vy < -5) {
          this.audio.land();
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

    if (p.invuln <= 0 && p.fly <= 0) this.collide(seg);
    if (this.state !== 'running') return;
    this.pickups(seg, dt);

    p.wormGap = Math.min(45, p.wormGap + gdt * (p.wormGap < 14 ? 1.5 : 3.2));

    p.mult = Math.min(8, 1 + Math.floor(p.runDist / 800)) * (p.trance > 0 ? 2 : 1);
    p.score += ds * 0.5 * p.mult;

    const pathDist = seg.startDist + p.s;
    const z = zoneAt(pathDist);
    if (z.index !== p.zoneIndex) {
      p.zoneIndex = z.index;
      this.banner(z.zone.name);
    }
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
    for (const o of seg.obstacles) {
      if (!o.active) continue;
      if (p.s + 0.35 < o.s0 || p.s - 0.35 > o.s1) continue;
      if (p.y + h <= o.y0 || p.y >= o.y1) continue;
      if (px1 <= o.x0 || px0 >= o.x1) continue;
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

  stumble() {
    const p = this.p;
    this.shake = Math.max(this.shake, 0.5);
    this.audio.stumble();
    this.flash('#ff5a1a', 0.25);
    if (p.wormGap < 18) {
      if (p.shield) { this.breakShield(); p.wormGap = 10; return; }
      return this.die('worm');
    }
    p.wormGap = 5;
    p.stumbleT = 0.7;
    this.audio.roar();
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
    this.die(o.kind === 'geyser' ? 'geyser' : 'crash');
  }

  pickups(seg, dt) {
    const p = this.p;
    const magnet = p.trance > 0 || p.fly > 0;
    const T = this.v.c.set(p.laneX, p.y + 0.9, -p.s);
    for (const k of seg.pickups) {
      if (k.taken) continue;
      const ds = k.s - p.s;
      if (ds < -3 || ds > (magnet ? 16 : 2.5)) continue;
      const mp = k.mesh.position;
      if (magnet && k.type === 'spice') mp.lerp(T, 1 - Math.exp(-9 * dt));
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
      const sm = [50, 100, 250, 500, 1000];
      if (p.spiceMilestone < sm.length && p.spice >= sm[p.spiceMilestone]) this.toast(`${sm[p.spiceMilestone++]} spice harvested`);
      return;
    }
    this.audio.powerup();
    this.glowPool.emit(w, { count: 40, spread: [0.3, 0.3, 0.3], vel: [0, 2, 0], velSpread: 5, life: 0.8, size: 0.4, color: k.type === 'shield' ? this.colors.blue : this.colors.spice, gravity: 0, drag: 2 });
    if (k.type === 'shield') {
      p.shield = true;
      this.runner.setShield(true);
      this.toast('Holtzman shield active');
    } else if (k.type === 'trance') {
      p.trance = TRANCE_TIME;
      this.toast('Spice trance — time bends, spice flows to you');
    } else if (k.type === 'thopter') {
      p.fly = THOPTER_TIME;
      p.slideT = 0;
      this.audio.thopter(true);
      this.toast('Ornithopter lift!');
    }
  }

  tips(seg) {
    const p = this.p;
    const ui = this.ui;
    let tip = null;
    const L = seg.length;
    if (p.s > L - 26 && p.s < L + DECK_HALF && p.fly <= 0) {
      ui.turnHint.classList.remove('hidden');
      ui.turnHint.classList.toggle('left', seg.turn < 0);
      if (this.tutorial) tip = isTouch ? `Swipe ${seg.turn < 0 ? 'left' : 'right'} to turn` : `Press ${seg.turn < 0 ? '←' : '→'} to turn`;
    } else ui.turnHint.classList.add('hidden');
    if (this.tutorial && !tip && p.fly <= 0) {
      for (const o of seg.obstacles) {
        const d = o.s0 - p.s;
        if (d < 0 || d > 28) continue;
        if (o.y0 > 1) tip = isTouch ? 'Swipe down to slide' : '↓ Slide';
        else if (o.y1 < 2) tip = isTouch ? 'Swipe up to jump' : '↑ Jump';
        else tip = isTouch ? 'Swipe to dodge' : '← → Dodge';
        break;
      }
      if (!tip) for (const [a] of seg.gaps) if (a - p.s > 0 && a - p.s < 28) { tip = isTouch ? 'Swipe up to leap' : '↑ Leap the gap'; break; }
    }
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
    this.deathFwd = p.seg.fwd.clone();
    if (cause === 'edge') p.vy = 3;
  }

  updateDeath(dt) {
    const p = this.p;
    this.deathT += dt;
    const t = this.deathT;
    if (this.deathCause === 'fall' || this.deathCause === 'edge') {
      p.vy -= GRAVITY * dt;
      p.y = Math.max(SAND_BED + 0.2, p.y + p.vy * dt);
      if (this.deathCause === 'edge') p.s += Math.max(0, 8 - t * 10) * dt;
    } else {
      p.s += Math.max(0, p.speed * (0.25 - t)) * dt;
    }
    if (t > 0.55 && !this.devour.active) {
      const base = this.v.a.copy(this.playerPos);
      base.y = this.deathCause === 'fall' || this.deathCause === 'edge' ? SAND_BED : 0;
      this.devour.start(base, this.deathFwd);
      this.audio.roar();
      this.shake = 1.2;
      for (let k = 0; k < 3; k++) {
        this.dustPool.emit(base, { count: 60, spread: [4, 0.5, 4], vel: [0, 9 + k * 4, 0], velSpread: 6, life: 2.2, size: 2.6, grow: 3, color: this.colors.sand, gravity: -7, drag: 0.6, alpha: 0.4 });
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
    $('over-score').textContent = score.toLocaleString();
    $('over-dist').textContent = Math.floor(p.runDist).toLocaleString();
    $('over-spice').textContent = p.spice.toLocaleString();
    $('over-best').textContent = Math.floor(this.save.best).toLocaleString();
    $('new-best').classList.toggle('hidden', !isBest);
    this.ui.hud.classList.add('hidden');
    this.ui.over.classList.remove('hidden');
    this.ui.tint.style.opacity = 0;
    setTimeout(() => $('again-btn').focus({ preventScroll: true }), 50);
  }

  /* ---------------- world & presentation ---------------- */

  updatePlayerVisual(dt) {
    const p = this.p;
    const seg = p.seg;
    this.track.localToWorld(seg, p.laneX, p.s, this.playerPos);
    this.playerPos.y = p.y;
    const r = this.runner.root;
    r.position.copy(this.playerPos);
    p.visualYaw = angleDamp(p.visualYaw, YAWS[seg.dir], 14, dt);
    r.rotation.y = p.visualYaw;
    r.rotation.z = (p.laneX - p.lane * LANE_W) * 0.08;
    let mode = 'idle';
    if (this.state === 'running') {
      mode = p.fly > 0 ? 'fly' : p.slideT > 0 ? 'slide' : !p.grounded ? 'jump' : p.stumbleT > 0 ? 'stumble' : 'run';
    } else if (this.state === 'dying' || this.state === 'over') mode = 'dead';
    else if (this.state === 'paused') mode = 'none';
    if (mode !== 'none') this.runner.update(dt, { speed: p.speed, mode, vy: p.vy });

    const b = this.blob;
    const overGap = this.track.inGap(seg, p.s, 0.2) || p.s > seg.length + DECK_HALF;
    b.visible = this.runner.root.visible && !overGap && p.y > -0.5;
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

  updateBreaches(dt) {
    this.breachTimer -= dt;
    if (this.breachTimer <= 0) {
      const b = this.breaches.find((x) => !x.active);
      if (b) {
        const fwd = this.v.a.set(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
        const ang = (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.6);
        const dist = 170 + Math.random() * 130;
        const dir = this.v.b.copy(fwd).applyAxisAngle(UP, ang);
        const origin = this.v.c.copy(this.playerPos).addScaledVector(dir, dist);
        const across = this.v.d.copy(dir).applyAxisAngle(UP, Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1));
        origin.addScaledVector(across, -50);
        origin.y = this.terrain.heightAt(origin.x, origin.z) - 4;
        b.start(origin, across, 32 + Math.random() * 18, 7 + Math.random() * 2);
      }
      this.breachTimer = 16 + Math.random() * 20;
    }
    for (const b of this.breaches) {
      const bursts = b.update(dt);
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
      const back = 7.4 + sp * 1.4 + fly * 3;
      tp.copy(pos).addScaledVector(fwd, -back);
      tp.y = Math.max(pos.y, 0) * 0.55 + 3.4 + fly * 2.5;
      look.copy(pos).addScaledVector(fwd, 8);
      look.y = Math.max(pos.y, 0) * 0.7 + 1.2;
      cam.fov = damp(cam.fov, 60 + sp * 12 + (p.trance > 0 ? -4 : 0), 3, dt);
      rate = 12;
    } else if (st === 'dying' || (st === 'over' && this.deathPos)) {
      const c = this.deathPos;
      const a = this.camYaw + (this.deathT || 0) * 0.25;
      tp.set(c.x + Math.sin(a) * 24, Math.max(c.y, 0) + 10, c.z + Math.cos(a) * 24);
      look.copy(c).addScaledVector(UP, 5);
      rate = st === 'dying' ? 3.5 : 1.2;
      cam.fov = damp(cam.fov, 58, 2, dt);
    } else {
      const t = this.time * 0.07 + 2.2;
      tp.set(pos.x + Math.sin(t) * 13, pos.y + 4.2 + Math.sin(this.time * 0.2) * 0.8, pos.z + Math.cos(t) * 13);
      look.copy(pos).addScaledVector(UP, 1.8);
      rate = 2.5;
      cam.fov = damp(cam.fov, 55, 2, dt);
    }
    cam.position.x = damp(cam.position.x, tp.x, rate, dt);
    cam.position.y = damp(cam.position.y, tp.y, rate, dt);
    cam.position.z = damp(cam.position.z, tp.z, rate, dt);
    if (!this.lookAt) this.lookAt = look.clone();
    this.lookAt.x = damp(this.lookAt.x, look.x, rate * 1.4, dt);
    this.lookAt.y = damp(this.lookAt.y, look.y, rate * 1.4, dt);
    this.lookAt.z = damp(this.lookAt.z, look.z, rate * 1.4, dt);
    const worm = st === 'running' ? this.chaser.closeness : 0;
    const sh = this.shake + worm * 0.12;
    this.shake = Math.max(0, this.shake - dt * 1.6);
    cam.position.x += (Math.random() - 0.5) * sh * 0.5;
    cam.position.y += (Math.random() - 0.5) * sh * 0.5;
    cam.lookAt(this.lookAt);
    cam.updateProjectionMatrix();
  }

  updateHUD() {
    const p = this.p;
    const ui = this.ui;
    this.setText('score', ui.score, Math.floor(p.score).toLocaleString());
    this.setText('mult', ui.mult, `x${p.mult}`);
    this.setText('spice', ui.spice, String(p.spice));
    this.setText('dist', ui.dist, Math.floor(p.runDist).toLocaleString());
    const close = 1 - smoothstep(4, 30, p.wormGap);
    ui.wormMeter.classList.toggle('show', close > 0.04);
    ui.wormFill.style.width = `${Math.round(close * 100)}%`;
    const pu = [];
    if (p.shield) pu.push(['Shield', '#5fb8ff', 1]);
    if (p.trance > 0) pu.push(['Trance', '#9d7bff', p.trance / TRANCE_TIME]);
    if (p.fly > 0) pu.push(['Thopter', '#ffc54a', p.fly / THOPTER_TIME]);
    const key = pu.map((x) => x[0] + Math.round(x[2] * 30)).join();
    if (key !== ui.last.pu) {
      ui.last.pu = key;
      ui.powerups.innerHTML = pu.map(([n, c, f]) => `<div class="pu" style="color:${c}"><i style="background:${c};box-shadow:0 0 10px ${c}"></i><span style="color:var(--sand)">${n}</span><span class="t"><b style="width:${Math.round(f * 100)}%"></b></span></div>`).join('');
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
    dt = Math.min(dt, 0.05);
    const st = this.state;
    if (st !== 'paused') this.time += dt;
    const p = this.p;

    if (st === 'running') this.updateRun(dt);
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
      this.chaser.update(dt, pathDist, p.wormGap, chaseVisible);
      if (chaseVisible && this.chaser.closeness > 0.25 && Math.random() < 0.7) {
        this.dustPool.emit(this.chaser.headPos, { count: 3, spread: [3, 0.5, 3], vel: [0, 5, 0], velSpread: 3, life: 1.4, size: 2.2, grow: 2.5, color: this.colors.sand, gravity: -4, alpha: 0.6 });
      }
      this.updateBreaches(dt);
      this.devour.update(dt);
      for (const f of this.flock) {
        f.a += f.w * dt * f.dir;
        const c = this.playerPos;
        f.t.group.position.set(c.x + Math.cos(f.a) * f.r, f.h + Math.sin(this.time * 0.5 + f.r) * 3, c.z + Math.sin(f.a) * f.r);
        f.t.group.rotation.y = -f.a + (f.dir > 0 ? Math.PI : 0);
        f.t.update(this.time);
      }
      this.dustPool.update(dt);
      this.glowPool.update(dt);
      this.dustColor.copy(this.sky.horizon).lerp(this.colors.sand, 0.4);
      this.dust.update(this.time, this.camera.position, this.atmo.dust, this.atmo.wind, this.dustColor);
      this.updateCamera(dt);
      if (st === 'running') this.updateHUD();
    }

    const running = st === 'running';
    this.audio.update(dt, {
      speed: running ? p.speed : 0,
      storm: this.atmo.haze,
      worm: running ? this.chaser.closeness : st === 'dying' ? 0.6 : 0,
      intensity: running ? 0.3 + clamp((p.speed - 15) / 19, 0, 1) * 0.6 : 0.12,
    });

    if (this.grade) {
      this.grade.uniforms.uTime.value = this.time;
      this.grade.uniforms.uWarm.value = this.p.trance > 0 && this.state === 'running' ? -1 : 1;
    }
    if (this.composer && this.quality === 'high') this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
