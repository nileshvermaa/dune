import * as THREE from 'three';
import { clamp } from '../engine/noise.js';
import { initProps, mats, tex, makeOrnithopter } from '../world/props.js';
import { Terrain, SAND_BED } from '../world/terrain.js';
import { Track } from '../world/track.js';
import { Sky, installHeightFog } from '../world/sky.js';
import { Runner } from '../actors/player.js';
import { ChaserWorm, BreachWorm, DevourWorm } from '../actors/worm.js';
import { DustField, ParticlePool, StormWall, SandMound } from '../world/effects.js';
import { AudioEngine } from '../audio/audio.js';
import { Input } from '../engine/input.js';
import { ZONES, zoneAt, distToZone } from '../content/zones.js';
import { BEATS, DEATHS, roman, saying, waypointAt } from '../content/story.js';
import { CHARACTERS, characterById, isUnlocked } from '../content/characters.js';
import { loadPhotoTextures, updatePhotoTextures } from '../engine/materials.js';
import { loadRunnerRig } from '../actors/rig.js';
import { GRAVITY, ROOM } from './constants.js';
import { $, isTouch } from './dom.js';
import { RenderSystem } from './systems/render.js';
import { ControlsSystem } from './systems/controls.js';
import { RunSystem } from './systems/run.js';
import { MakerSystem } from './systems/maker.js';
import { NarrativeSystem } from './systems/narrative.js';
import { HudSystem } from './systems/hud.js';
import { CarriersSystem } from './systems/carriers.js';
import { PresentationSystem } from './systems/presentation.js';

// The Game is the hub: it owns the scene, the actors, the run state (`this.p`), the save and
// the state machine (title → intro → running ⇄ paused → dying → over; title ⇄ chars). Behaviour
// lives in systems (./systems/*.js), each a set of methods installed on Game.prototype below.
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
    // the chosen carrier (falls back to Ishra if the saved choice is still locked)
    const saved = characterById(this.save.selected);
    this.char = isUnlocked(saved, this.save) ? saved : CHARACTERS[0];
    this.runner.applyLook(this.char.look);
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

  // the current carrier's rule changes (see characters.js)
  get mods() { return (this.char || CHARACTERS[0]).mods; }

  loadSave() {
    this.save = { runs: [], best: 0, played: 0 };
    try { Object.assign(this.save, JSON.parse(localStorage.getItem('arrakis.save') || '{}')); } catch { /* ignore */ }
  }

  writeSave() {
    try { localStorage.setItem('arrakis.save', JSON.stringify(this.save)); } catch { /* ignore */ }
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
      abilityCd: 0, shieldCd: 0, airJumped: false,
    };
    this.p.hooks = this.mods.hooks || 0;
    this.p.shieldCd = this.mods.shieldEvery || 0;
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
    // spice is banked across runs (it buys carriers); distance unlocks them too
    const before = CHARACTERS.filter((c) => isUnlocked(c, this.save)).map((c) => c.id);
    this.save.spiceBank = (this.save.spiceBank || 0) + p.spice;
    this.save.bestDist = Math.max(this.save.bestDist || 0, Math.floor(p.runDist));
    for (const c of CHARACTERS) {
      if (!before.includes(c.id) && isUnlocked(c, this.save)) setTimeout(() => this.toast(`${c.name} the ${c.role} will now carry the water`), 2600);
    }
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

Object.assign(Game.prototype, RenderSystem, ControlsSystem, RunSystem, MakerSystem, NarrativeSystem, HudSystem, CarriersSystem, PresentationSystem);
