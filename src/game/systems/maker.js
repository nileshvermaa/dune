import { damp, smoothstep } from '../../engine/noise.js';
import { makeThumper } from '../../world/props.js';
import { SAND_BED } from '../../world/terrain.js';
import { BEATS } from '../../content/story.js';
import { rideDifficulty, promptFor, rideLength, balanceInterval, BREAK_RELIEF, BREAK_STRAIGHT } from '../../content/difficulty.js';
import { UP } from '../constants.js';

// The Maker: rhythm and wormsign, thumpers, hooking and riding, and the worm in the sand.
// Installed on Game.prototype (see game/Game.js), so `this` is the Game.
export const MakerSystem = {
  // how hard the Maker is to hook and hold: rises with distance and with every ride
  rideDifficulty() {
    const p = this.p;
    return rideDifficulty(p.runDist, p.rides);
  },

  startQTE(kind) {
    const p = this.p;
    const d = this.rideDifficulty();
    const prompt = promptFor(kind, d);
    const n = kind === 'hook' ? Math.max(1, prompt.steps + (this.mods.hookSteps || 0)) : prompt.steps;
    const dirs = ['left', 'right', 'up', 'down'];
    const steps = Array.from({ length: n }, () => dirs[Math.floor(Math.random() * 4)]);
    const window = prompt.window * (this.mods.hookWindow || 1);
    p.qte = { kind, steps, idx: 0, t: 0, window, slow: kind === 'hook' ? 0.12 : 0.45 };
    this.renderQTE();
    this.ui.qte.classList.remove('hidden');
    if (kind === 'hook') {
      this.audio.braam(1);
      this.shake = 0.8;
      this.cinema(true);
      this.narrate(BEATS.hookNow, 2600);
    }
  },

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
  },

  updateQTE(realDt) {
    const q = this.p.qte;
    q.t += realDt;
    const left = 1 - q.t / q.window;
    this.ui.qteRing.style.transform = `scale(${0.55 + Math.max(0, left) * 1.25})`;
    this.ui.qteRing.classList.toggle('late', left < 0.3);
    if (left <= 0) this.endQTE(false);
  },

  renderQTE() {
    const q = this.p.qte;
    const glyph = { left: '←', right: '→', up: '↑', down: '↓' };
    this.ui.qteKey.textContent = glyph[q.steps[q.idx]];
    this.ui.qteLabel.textContent = q.kind === 'hook' ? 'Set the hooks' : 'Hold on';
    this.ui.qteDots.innerHTML = q.steps.map((_, i) => `<i class="${i < q.idx ? 'done' : i === q.idx ? 'now' : ''}"></i>`).join('');
  },

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
    if (ok) { p.balanceT = balanceInterval(this.rideDifficulty()); return; }
    p.ride = 0;
    p.invuln = 1.8;
    p.water = Math.max(0, p.water - 15);
    this.stumble();
    this.beat('thrown', true);
    this.audio.roar();
  },

  // "Walk without rhythm": on open sand, irregular moves quiet your footsteps —
  // but only if the moves themselves don't fall into a pattern.
  // a move on open sand: kind is 'lane', 'turn', 'jump' or 'slide' (content/difficulty.js says how
  // much each sheds). Moves timed like a metronome (three equal gaps running) shed nothing.
  rhythmBreak(kind = 'jump') {
    const p = this.p;
    if (!p.onSand) return;
    p.straight *= BREAK_STRAIGHT[kind];
    const gap = this.time - p.lastBreak;
    if (gap < 0.22) return;
    const near = (g) => g > 0 && Math.abs(gap - g) / g < 0.12;
    const match = near(p.lastGap) && near(p.prevGap);
    if (match) {
      this.beat('tooRegular', true);
      this.flash('#ff8a2a', 0.12);
    } else {
      p.sign = Math.max(0, p.sign - BREAK_RELIEF[kind] - (this.mods.breakBonus || 0));
    }
    p.strides.push({ gap: Math.min(gap, 1.2), match });
    if (p.strides.length > 8) p.strides.shift();
    this.drawStride();
    p.prevGap = p.lastGap;
    p.lastGap = gap;
    p.lastBreak = this.time;
  },

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
  },

  startRide() {
    const p = this.p;
    p.hooks--;
    // rides grow shorter and the Maker fights harder the further you go
    p.ride = rideLength(this.rideDifficulty()) * (this.mods.rideTime || 1);
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
  },

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
  },

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
  },

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
  },

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
  },
};
