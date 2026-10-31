import { clamp, damp } from '../../engine/noise.js';
import { LANE_W } from '../../world/layout.js';
import { speedAt, wormsignRate } from '../../content/difficulty.js';
import { zoneAt } from '../../content/zones.js';
import { waypointAt } from '../../content/story.js';
import { POWERUPS } from '../../content/powerups.js';
import { GRAVITY, SLIDE_TIME, TRANCE_TIME, RIDE_OFFSET, FLY_H, UP, MILESTONES } from '../constants.js';

// The run itself: movement, corners, physics, water, wormsign, collisions and pickups.
// Installed on Game.prototype (see game/Game.js), so `this` is the Game.
export const RunSystem = {
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
  },

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
    p.abilityCd = Math.max(0, p.abilityCd - dt);
    // Zara's shield recharges while she has none
    if (this.mods.shieldEvery && !p.shield) {
      p.shieldCd -= dt;
      if (p.shieldCd <= 0) { p.shield = true; this.runner.setShield(true); p.shieldCd = this.mods.shieldEvery; this.audio.shieldHit(); }
    }
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
        if (p.slideQueued) { p.slideQueued = false; p.slideT = SLIDE_TIME * (this.mods.slide || 1); this.audio.slide(); }
      } else if (p.y > 0 || !support) {
        p.grounded = false;
      }
      if (p.y < -1.4) return this.die('fall');
    }
    if (p.slideT > 0) p.slideT -= gdt;

    // water: the stillsuit loses a little every moment, more under the sun
    const drain = (0.85 + 0.7 * (1 - this.sky.night) + this.atmo.haze * 0.5) * (riding || p.fly > 0 ? 0.4 : 1) * (p.seal > 0 ? 0 : 1) * (this.mods.drain || 1);
    p.water = Math.max(0, p.water - drain * dt);
    if (p.water < 25) this.beat('lowWater');
    if (p.water <= 0) return this.die('thirst');

    // wormsign: steady footsteps on open sand call the Maker
    // the whole desert is open sand now; only the old paving is safe
    p.onSand = !this.track.onRock(seg, p.s) && !riding && p.fly <= 0;
    if (p.onSand) {
      this.beat('firstSand');
      if (p.shield) this.beat('shieldSand');
      let rate = wormsignRate(p.speed, p.runDist) * (p.shield ? 1.5 : 1) * (p.trance > 0 ? 0.5 : 1) * (this.mods.signRate || 1);
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
      // the old stones remember Zara: she drinks from them
      if (this.mods.stoneWater && !riding && p.fly <= 0) p.water = Math.min(100, p.water + this.mods.stoneWater * gdt);
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
  },

  puff(n, size) {
    const w = this.playerPos;
    this.dustPool.emit(this.v.d.set(w.x, w.y + 0.1, w.z), {
      count: n, spread: [0.3, 0.05, 0.3], vel: [0, 1.2, 0], velSpread: 1.2, life: 0.8, size, grow: 1.2,
      color: this.colors.sandLight, gravity: -0.5, drag: 2, alpha: 0.55,
    });
  },

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
  },

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
  },

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
  },

  stumble() {
    const p = this.p;
    this.shake = Math.max(this.shake, 0.5);
    this.audio.stumble();
    this.flash('#ff5a1a', 0.25);
    p.stumbleT = 0.7;
    p.water = Math.max(0, p.water - 6);
    if (p.onSand) p.sign = Math.min(100, p.sign + 20);
  },

  breakShield() {
    const p = this.p;
    p.shield = false;
    p.invuln = 1.0;
    this.runner.setShield(false);
    this.audio.shieldHit();
    this.flash('#5fb8ff', 0.4);
    this.glowPool.emit(this.v.c.copy(this.playerPos).addScaledVector(UP, 1), { count: 60, spread: [0.6, 0.8, 0.6], vel: [0, 2, 0], velSpread: 6, life: 0.7, size: 0.35, color: this.colors.blue, gravity: 0, drag: 2 });
  },

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
    p.water = Math.max(0, p.water - (o.kind === 'geyser' ? 40 : 30) - (this.mods.crashCost || 0));
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
  },

  pickups(seg, dt) {
    const p = this.p;
    const magnet = p.trance > 0 || p.fly > 0 || p.ride > 0 || this.mods.magnet;
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
  },

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
      p.vision = Math.min(100, p.vision + 3.5 * (this.mods.vision || 1));
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
    // everything else is a powerup: see content/powerups.js
    const def = POWERUPS[k.type];
    if (!def) return;
    this.audio.powerup();
    this.glowPool.emit(w, { count: 40, spread: [0.3, 0.3, 0.3], vel: [0, 2, 0], velSpread: 5, life: 0.8, size: 0.4, color: def.glow === 'blue' ? this.colors.blue : this.colors.spice, gravity: 0, drag: 2 });
    def.apply(this);
  },
};
