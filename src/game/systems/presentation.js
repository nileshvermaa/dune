import * as THREE from 'three';
import { clamp, damp, angleDamp } from '../../engine/noise.js';
import { SAND_BED } from '../../world/terrain.js';
import { LANE_W, DECK_HALF, YAWS } from '../../world/layout.js';
import { zoneAt } from '../../content/zones.js';
import { UP, INTRO_SHOT } from '../constants.js';

// What the camera sees: the runner on the path, the atmosphere, wind-blown sand and the camera.
// Installed on Game.prototype (see game/Game.js), so `this` is the Game.
export const PresentationSystem = {
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
  },

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
  },

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
  },

  updateCamera(dt) {
    const cam = this.camera;
    const p = this.p;
    const pos = this.playerPos;
    const st = this.state;
    const tp = this.v.a, look = this.v.b;
    let rate;
    if (st === 'running' || st === 'paused') {
      this.camYaw = angleDamp(this.camYaw, YAWS[p.seg.dir], 6.5, dt);
      const fwd = this.v.c.set(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
      const sp = clamp((p.speed - 15) / 19, 0, 1);
      const fly = p.fly > 0 ? 1 : 0;
      const ride = p.ride > 0 ? 1 : 0;
      // phones held upright see a narrow slice: widen the view and lift the camera so the lanes
      // either side and the trail ahead stay in frame, with the runner in the lower third
      const tall = clamp((1.1 - cam.aspect) / 0.6, 0, 1);
      const back = 7.4 + sp * 1.4 + fly * 3 + ride * 4 - tall * 1.6;
      tp.copy(pos).addScaledVector(fwd, -back);
      tp.y = Math.max(pos.y, 0) * 0.55 + 3.4 + fly * 2.5 + ride * 2.5 + tall * 1.1;
      look.copy(pos).addScaledVector(fwd, 8 + tall * 4);
      look.y = Math.max(pos.y, 0) * 0.7 + 1.2 - tall * 0.4;
      cam.fov = damp(cam.fov, 60 + sp * 12 + tall * 16 + (p.trance > 0 ? -4 : 0), 3, dt);
      rate = 12;
    } else if (st === 'chars') {
      // the carrier on show: a slow turn around them at full height, above the cards
      const t = this.time * 0.25;
      tp.set(pos.x + Math.sin(t) * 5.4, pos.y + 1.0, pos.z + Math.cos(t) * 5.4);
      look.copy(pos);
      look.y = pos.y + 0.05;
      rate = 3;
      cam.fov = damp(cam.fov, 42, 3, dt);
    } else if (st === 'intro') {
      // the opening shots: the erg from on high, alongside Ishra, close on the face, then round
      // behind to the gameplay view as the run begins
      const seg = p.seg, fwd = seg.fwd, right = seg.right;
      const k = clamp((this.introT % INTRO_SHOT) / INTRO_SHOT, 0, 1);
      const i = Math.max(0, this.introIdx);
      const tall = this.introTall ?? clamp((1.0 - cam.aspect) / 0.5, 0, 1);
      this.camYaw = YAWS[seg.dir];
      if (i === 0) {
        tp.copy(pos).addScaledVector(fwd, 34 - k * 12).addScaledVector(right, 24 - k * 6 - tall * 4);
        tp.y = pos.y + 15 - k * 3;
        look.copy(pos).addScaledVector(fwd, -10).addScaledVector(right, tall * 2);
        look.y = pos.y + 2;
      } else if (i === 1) {
        tp.copy(pos).addScaledVector(right, 5.2 - tall * 2.4).addScaledVector(fwd, -1.5 + k * 3);
        tp.y = pos.y + 1.3;
        look.copy(pos).addScaledVector(fwd, 1).addScaledVector(right, -tall * 0.6);
        look.y = pos.y + 1.2;
      } else if (i === 2) {
        tp.copy(pos).addScaledVector(fwd, 3.8 - k * 0.6).addScaledVector(right, 1.0 - tall * 0.7);
        tp.y = pos.y + 1.45;
        look.copy(pos);
        look.y = pos.y + 1.25;
      } else {
        tp.copy(pos).addScaledVector(fwd, -7.4 - tall * 1.2);
        tp.y = pos.y + 3.4;
        look.copy(pos).addScaledVector(fwd, 8);
        look.y = pos.y + 1.2;
      }
      rate = i >= 3 ? 2.2 : 1.4;
      const baseFov = i === 2 ? 38 : i === 0 ? 50 : 55;
      cam.fov = damp(cam.fov, baseFov + tall * 16, 2, dt);
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
  },
};
