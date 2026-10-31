import * as THREE from 'three';
import { mulberry32, clamp, lerp } from './noise.js';
import { zoneAt } from './zones.js';
import * as P from './props.js';
import { SAND_BED } from './terrain.js';

// The ancient causeway: straight segments joined by 90° corners, populated with
// obstacles, spice, power-ups and zone-specific scenery.

export const LANE_W = 2.2;
export const HALF_W = 3.6;
export const DECK_HALF = 4.0;
const DECK_DEPTH = 3.4;

export const DIRS = [
  new THREE.Vector3(0, 0, -1),
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(-1, 0, 0),
];
export const YAWS = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

export function speedAt(dist) {
  return 15 + 19 * (1 - Math.exp(-dist / 4200));
}

function deckGeometry(w, h, l) {
  const g = new THREE.BoxGeometry(w, h, l);
  const uv = g.attributes.uv;
  const dims = [[l, h], [l, h], [w, l], [w, l], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / 4, (uv.getY(i) * dims[f][1]) / 4);
    }
  }
  return g;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class Track {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.lines = terrain.lines;
    this.segments = [];
    this.ahead = 650;
    this.reset(1);
  }

  reset(seed) {
    for (const s of this.segments) this.disposeSegment(s);
    this.segments = [];
    this.lines.length = 0;
    this.rng = mulberry32(seed);
    this.nextStart = new THREE.Vector3();
    this.nextDir = 0;
    this.nextDist = 0;
    this.count = 0;
  }

  ensure(dist) {
    let added = 0;
    while (!this.segments.length || this.segments[this.segments.length - 1].endDist < dist + this.ahead) {
      this.addSegment();
      if (++added > 6) break;
    }
    while (this.segments.length > 3 && this.segments[0].endDist < dist - 260) {
      const s = this.segments.shift();
      if (this.segments[0]) this.segments[0].prev = null;
      this.disposeSegment(s);
    }
  }

  disposeSegment(seg) {
    this.scene.remove(seg.group);
    for (const g of seg.geos) g.dispose();
    for (const m of seg.mats) m.dispose();
  }

  segmentAtDist(d) {
    const segs = this.segments;
    if (!segs.length) return null;
    for (let i = 0; i < segs.length; i++) if (d < segs[i].endDist) return segs[i];
    return segs[segs.length - 1];
  }

  // World position at path distance d with a lateral offset; corners are rounded off.
  sample(d, off, out) {
    const seg = this.segmentAtDist(d);
    if (!seg) return false;
    const s = d - seg.startDist;
    out.copy(seg.start).addScaledVector(seg.fwd, s);
    let rx = seg.right.x, rz = seg.right.z;
    const B = 10;
    if (s > seg.length - B && seg.next) {
      const t = Math.min(0.5, (s - (seg.length - B)) / (2 * B));
      rx = lerp(rx, seg.next.right.x, t); rz = lerp(rz, seg.next.right.z, t);
    } else if (s < B && seg.prev) {
      const t = 0.5 + Math.max(0, s) / (2 * B);
      rx = lerp(seg.prev.right.x, rx, t); rz = lerp(seg.prev.right.z, rz, t);
    }
    const l = Math.hypot(rx, rz) || 1;
    out.x += (rx / l) * off;
    out.z += (rz / l) * off;
    return true;
  }

  localToWorld(seg, x, s, out) {
    return out.copy(seg.start).addScaledVector(seg.fwd, s).addScaledVector(seg.right, x);
  }

  addSegment() {
    const rng = this.rng;
    const first = this.count === 0;
    const dir = this.nextDir;
    let L = first ? 260 : dir === 0 ? 100 + rng() * 120 : 70 + rng() * 70;
    L = Math.round(L);
    let nd;
    if (dir === 0) {
      const x = this.nextStart.x;
      const pE = x > 140 ? 0.15 : x < -140 ? 0.85 : 0.5;
      nd = rng() < pE ? 1 : 3;
    } else nd = 0;
    const turn = nd === (dir + 1) % 4 ? 1 : -1;
    const start = this.nextStart.clone();
    const fwd = DIRS[dir], right = DIRS[(dir + 1) % 4];
    const end = start.clone().addScaledVector(fwd, L);
    const prev = this.segments[this.segments.length - 1] || null;
    const seg = {
      index: this.count, start, end, dir, fwd, right, length: L,
      startDist: this.nextDist, endDist: this.nextDist + L,
      turn, nextDir: nd, zone: zoneAt(this.nextDist + L * 0.5).zone,
      obstacles: [], gaps: [], pickups: [], geysers: [], animated: [],
      geos: [], mats: [], group: new THREE.Group(), prev, next: null,
    };
    seg.group.position.copy(start);
    seg.group.rotation.y = YAWS[dir];

    const a = first ? start.clone().addScaledVector(fwd, -60) : start;
    const b = end.clone().addScaledVector(fwd, DECK_HALF);
    const line = {
      ax: a.x, az: a.z, bx: b.x, bz: b.z,
      minx: Math.min(a.x, b.x), maxx: Math.max(a.x, b.x), minz: Math.min(a.z, b.z), maxz: Math.max(a.z, b.z),
    };
    this.lines.push(line);
    this.terrain.markDirty(line.minx - 70, line.minz - 70, line.maxx + 70, line.maxz + 70);

    this.populate(seg, first);
    this.buildDeck(seg, first);
    this.decorate(seg, first);
    seg.group.traverse((o) => {
      if (o.isMesh && o.userData.shadow !== false) o.castShadow = true;
    });
    this.scene.add(seg.group);
    if (prev) prev.next = seg;
    this.segments.push(seg);
    this.count++;
    this.nextStart.copy(end);
    this.nextDir = nd;
    this.nextDist += L;
  }

  pickType(zone, rng, early) {
    const w = early ? { rock: 3, low: 2, arch: 1 } : zone.weights;
    let total = 0;
    for (const k in w) total += w[k];
    let r = rng() * total;
    for (const k in w) { r -= w[k]; if (r <= 0) return k; }
    return 'rock';
  }

  populate(seg, first) {
    const rng = this.rng;
    const L = seg.length;
    const diff = clamp(seg.startDist / 7000, 0, 1);
    const events = [];
    let s = first ? 90 : 32;
    const endS = L - 30;
    while (s < endS) {
      const early = seg.startDist + s < 350;
      const type = this.pickType(seg.zone, rng, early);
      events.push(this.placeObstacle(seg, type, s, rng, diff));
      const v = speedAt(seg.startDist + s);
      s += Math.max(18, v * 1.15) + rng() * 16 * (1.25 - diff);
    }
    this.placePickups(seg, events, first);
  }

  addCollider(seg, o) {
    o.active = true;
    seg.obstacles.push(o);
    return o;
  }

  placeObstacle(seg, type, s, rng, diff) {
    const g = seg.group;
    const ev = { s, type, free: [-1, 0, 1], blocked: [] };
    if (type === 'rock' || type === 'column') {
      const n = rng() < 0.4 + diff * 0.3 ? 2 : 1;
      const lanes = shuffle([-1, 0, 1], rng).slice(0, n);
      ev.blocked = lanes;
      ev.free = [-1, 0, 1].filter((l) => !lanes.includes(l));
      for (const lane of lanes) {
        let mesh;
        if (type === 'rock') {
          mesh = P.makeRock('boulder', Math.floor(rng() * 4), 0.95, 2.4 + rng() * 1.2, 0.95);
          mesh.position.set(lane * LANE_W, 1.1, -s);
          mesh.rotation.y = rng() * 6.28;
        } else {
          mesh = P.makeColumn(4.5 + rng() * 2.5, rng() < 0.35);
          mesh.scale.setScalar(0.85);
          mesh.position.set(lane * LANE_W, 0, -s);
        }
        g.add(mesh);
        this.addCollider(seg, { kind: type, mesh, s0: s - 0.75, s1: s + 0.75, x0: lane * LANE_W - 0.85, x1: lane * LANE_W + 0.85, y0: 0, y1: 20 });
      }
    } else if (type === 'low' || type === 'pipe') {
      const mesh = type === 'pipe' ? P.makePipe() : P.makeRubbleWall(rng);
      mesh.position.z = -s;
      g.add(mesh);
      this.addCollider(seg, { kind: type, mesh, s0: s - 0.45, s1: s + 0.45, x0: -HALF_W, x1: HALF_W, y0: 0, y1: 0.95 });
      ev.jump = true;
    } else if (type === 'arch') {
      const z = seg.zone.id;
      const mesh = z === 'ruins' || z === 'shieldwall' ? P.makeLintel(false) : z === 'spice' ? P.makeLintel(true) : P.makeBoneArch(true);
      mesh.position.z = -s;
      g.add(mesh);
      this.addCollider(seg, { kind: type, mesh, s0: s - 0.55, s1: s + 0.55, x0: -HALF_W, x1: HALF_W, y0: 1.18, y1: 12 });
      ev.slide = true;
    } else if (type === 'gap') {
      const len = 4.2 + diff * 0.8;
      seg.gaps.push([s - len / 2, s + len / 2]);
      ev.jump = true;
      ev.gap = true;
    } else if (type === 'geyser') {
      const n = rng() < 0.5 ? 2 : 1;
      const lanes = shuffle([-1, 0, 1], rng).slice(0, n);
      ev.blocked = lanes;
      ev.free = [-1, 0, 1].filter((l) => !lanes.includes(l));
      for (const lane of lanes) {
        const gy = P.makeGeyser();
        seg.mats.push(gy.disc.material);
        gy.group.position.set(lane * LANE_W, 0, -s);
        g.add(gy.group);
        const col = this.addCollider(seg, { kind: 'geyser', mesh: gy.group, s0: s - 0.9, s1: s + 0.9, x0: lane * LANE_W - 0.9, x1: lane * LANE_W + 0.9, y0: 0, y1: 20 });
        col.active = false;
        seg.geysers.push({ ...gy, collider: col, phase: rng() * 3, period: 2.8, lane, s, erupting: false });
      }
    }
    return ev;
  }

  addPickup(seg, type, x, y, s) {
    const mesh = type === 'spice' ? P.makeSpiceOrb() : P.makePowerup(type);
    mesh.position.set(x, y, -s);
    mesh.traverse((o) => { o.userData.shadow = false; });
    seg.group.add(mesh);
    const p = { type, x, y, s, mesh, taken: false, baseY: y };
    seg.pickups.push(p);
    return p;
  }

  placePickups(seg, events, first) {
    const rng = this.rng;
    const L = seg.length;
    let prev = first ? 25 : 8;
    const intervals = [];
    for (let i = 0; i <= events.length; i++) {
      const ev = events[i];
      const next = ev ? ev.s : L - 10;
      const a = prev + (i === 0 ? 0 : 5), b = next - 6;
      if (b - a > 12) {
        intervals.push([a, b]);
        if (rng() < 0.78) {
          const lanes = ev ? ev.free : [-1, 0, 1];
          const lane = lanes[Math.floor(rng() * lanes.length)];
          for (let ss = a; ss <= b; ss += 2.6) this.addPickup(seg, 'spice', lane * LANE_W, 1.0, ss);
        }
      }
      if (ev) {
        if (ev.jump && rng() < 0.75) {
          const lane = Math.floor(rng() * 3) - 1;
          for (let k = -3; k <= 3; k++) {
            const y = 1.0 + 1.7 * (1 - (k / 3.6) ** 2);
            this.addPickup(seg, 'spice', lane * LANE_W, y, ev.s + k * 1.9);
          }
        } else if (ev.slide && rng() < 0.65) {
          const lane = Math.floor(rng() * 3) - 1;
          for (let k = -2; k <= 2; k++) this.addPickup(seg, 'spice', lane * LANE_W, 0.45, ev.s + k * 1.6);
        } else if (ev.blocked.length && ev.free.length && rng() < 0.6) {
          const lane = ev.free[Math.floor(rng() * ev.free.length)];
          for (let k = -2; k <= 2; k++) this.addPickup(seg, 'spice', lane * LANE_W, 1.0, ev.s + k * 2.4);
        }
      }
      prev = next;
    }
    if (!first && intervals.length && rng() < 0.42) {
      const [a, b] = intervals[Math.floor(rng() * intervals.length)];
      const s = (a + b) / 2;
      const lane = Math.floor(rng() * 3) - 1;
      const r = rng();
      const type = r < 0.4 ? 'shield' : r < 0.72 ? 'trance' : 'thopter';
      for (const p of seg.pickups) {
        if (Math.abs(p.s - s) < 3 && Math.abs(p.x - lane * LANE_W) < 0.5) { p.taken = true; p.mesh.visible = false; }
      }
      this.addPickup(seg, type, lane * LANE_W, 1.3, s);
    }
  }

  inGap(seg, s, pad = 0) {
    for (const [a, b] of seg.gaps) if (s > a + pad && s < b - pad) return true;
    return false;
  }

  buildDeck(seg, first) {
    const L = seg.length;
    const g = seg.group;
    const addMesh = (geom, mat, x, y, z, receive = true) => {
      seg.geos.push(geom);
      const m = new THREE.Mesh(geom, mat);
      m.position.set(x, y, z);
      m.receiveShadow = receive;
      m.userData.shadow = false;
      g.add(m);
      return m;
    };
    const piece = (a, b) => {
      const len = b - a;
      if (len <= 0.05) return;
      addMesh(deckGeometry(DECK_HALF * 2, DECK_DEPTH, len), P.mats.stone, 0, -DECK_DEPTH / 2, -(a + b) / 2);
      for (const sx of [-1, 1]) addMesh(deckGeometry(0.35, 0.3, len), P.mats.stoneDark, sx * (DECK_HALF - 0.175), 0.15, -(a + b) / 2);
    };
    let cur = first ? -60 : DECK_HALF;
    const gaps = seg.gaps.slice().sort((x, y) => x[0] - y[0]);
    for (const [a, b] of gaps) {
      piece(cur, a);
      const pit = addMesh(new THREE.PlaneGeometry(DECK_HALF * 2, b - a), P.mats.dark, 0, SAND_BED + 0.25, -(a + b) / 2, false);
      pit.rotation.x = -Math.PI / 2;
      for (const ss of [a + 0.4, b - 0.4]) {
        const r = P.makeRock('boulder', Math.floor(this.rng() * 4), 0.6, 0.35, 0.5);
        r.position.set((this.rng() - 0.5) * 6, 0.05, -ss);
        r.userData.shadow = false;
        g.add(r);
      }
      cur = b;
    }
    piece(cur, L - DECK_HALF);

    // corner platform
    addMesh(deckGeometry(DECK_HALF * 2, DECK_DEPTH, DECK_HALF * 2), P.mats.stone, 0, -DECK_DEPTH / 2, -L);
    addMesh(deckGeometry(DECK_HALF * 2, 0.3, 0.35), P.mats.stoneDark, 0, 0.15, -(L + DECK_HALF - 0.175));
    addMesh(deckGeometry(0.35, 0.3, DECK_HALF * 2), P.mats.stoneDark, -seg.turn * (DECK_HALF - 0.175), 0.15, -L);
    const arrowGeo = new THREE.PlaneGeometry(3.4, 3.4);
    for (const ss of [L - 9, L - 1]) {
      const arrow = addMesh(arrowGeo, P.mats.arrow, 0, 0.03, -ss, false);
      arrow.rotation.set(-Math.PI / 2, 0, seg.turn < 0 ? Math.PI : 0);
      arrow.renderOrder = 2;
    }
    const ob = P.makeObelisk();
    ob.position.set(-seg.turn * (DECK_HALF + 2.6), 0, -(L + DECK_HALF + 2.6));
    g.add(ob);
  }

  propAt(seg, obj, x, s, yOffset = 0, onBed = false) {
    const w = this.localToWorld(seg, x, s, new THREE.Vector3());
    const h = onBed ? SAND_BED : this.terrain.heightAt(w.x, w.z);
    obj.position.set(x, h + yOffset, -s);
    obj.userData.shadow = false;
    obj.traverse((o) => { o.userData.shadow = false; });
    seg.group.add(obj);
    return obj;
  }

  decorate(seg, first) {
    const rng = this.rng;
    const L = seg.length;
    const z = seg.zone.id;
    const s0 = first ? -50 : 0;

    for (let s = s0 + 12, k = 0; s < L - 8; s += 24, k++) {
      if (this.inGap(seg, s, -1.5)) continue;
      const post = P.makeGlowPost();
      post.position.set((k % 2 ? 1 : -1) * (DECK_HALF - 0.2), 0, -s);
      post.traverse((o) => { o.userData.shadow = false; });
      seg.group.add(post);
    }

    const sideLat = (side, near, far) => side * (side < 0 ? Math.max(near, 22) + rng() * (far - near) : near + rng() * (far - near));

    if (z === 'desert' || z === 'storm') {
      for (let s = s0; s < L; s += 20) {
        if (rng() < (z === 'storm' ? 0.3 : 0.5)) {
          const side = rng() < 0.5 ? -1 : 1;
          const sc = 2 + rng() * 5;
          this.propAt(seg, P.makeRock('boulder', Math.floor(rng() * 4), sc, sc * (0.6 + rng() * 0.8), sc), sideLat(side, 13, 42), s, sc * 0.2);
        }
        if (rng() < 0.05) {
          const t = P.makeThumper();
          this.propAt(seg, t.group, 7 + rng() * 4, s, 0, true);
          seg.animated.push({ type: 'thumper', head: t.head, phase: rng() * 6 });
        }
        if (rng() < 0.03) this.propAt(seg, P.makeWreck(rng), sideLat(rng() < 0.5 ? -1 : 1, 18, 40), s, 0.5);
      }
    } else if (z === 'shieldwall') {
      for (let s = s0; s < L; s += 15) {
        for (const side of [-1, 1]) {
          if (rng() < 0.15) continue;
          const w = 7 + rng() * 6;
          const kind = rng() < 0.5 ? 'spire' : 'boulder';
          const rock = P.makeRock(kind, Math.floor(rng() * 4), w, 16 + rng() * 26, w);
          rock.rotation.y = rng() * 6.28;
          this.propAt(seg, rock, side * (side < 0 ? 27 + rng() * 8 : 20 + rng() * 8), s, -1);
        }
      }
    } else if (z === 'ruins') {
      for (let s = s0 + 6; s < L - 6; s += 18) {
        for (const side of [-1, 1]) {
          if (rng() < 0.2) continue;
          const col = P.makeColumn(7 + rng() * 5, rng() < 0.35);
          this.propAt(seg, col, side * 7.2, s, 0, true);
        }
        if (rng() < 0.25) {
          const fallen = P.makeColumn(6, true);
          fallen.rotation.z = Math.PI / 2;
          fallen.rotation.y = rng() * 6.28;
          this.propAt(seg, fallen, (rng() < 0.5 ? -1 : 1) * (11 + rng() * 9), s, 0.6, true);
        }
      }
      for (let s = s0 + 30; s < L - 20; s += 70 + rng() * 30) {
        if (this.inGap(seg, s, -3)) continue;
        this.propAt(seg, P.makeBigArch(15, 10), 0, s, 0, true);
      }
    } else if (z === 'spice') {
      if (L > 90) {
        const h = P.makeHarvester();
        h.group.rotation.y = rng() * 6.28;
        this.propAt(seg, h.group, (rng() < 0.5 ? -1 : 1) * (85 + rng() * 40), L * 0.5, -1);
        seg.animated.push({ type: 'harvester', update: h.update });
      }
      for (let s = s0; s < L; s += 9) {
        if (rng() < 0.6) {
          const patch = new THREE.Mesh(seg.patchGeo || (seg.patchGeo = new THREE.PlaneGeometry(1, 1)), P.mats.spicePatch);
          if (!seg.geos.includes(seg.patchGeo)) seg.geos.push(seg.patchGeo);
          patch.rotation.x = -Math.PI / 2;
          patch.scale.setScalar(4 + rng() * 9);
          this.propAt(seg, patch, (rng() < 0.5 ? -1 : 1) * (6 + rng() * 14), s, 0.06, true);
        }
      }
    }
  }

  update(dt, time) {
    for (const seg of this.segments) {
      for (const p of seg.pickups) {
        if (p.taken) continue;
        const core = p.mesh.userData.core;
        core.rotation.y += dt * 2.5;
        if (p.type !== 'spice') {
          p.mesh.position.y = p.baseY + Math.sin(time * 3 + p.s) * 0.15;
          if (p.mesh.userData.thopter) p.mesh.userData.thopter.update(time);
        }
      }
      for (const gy of seg.geysers) {
        const t = (time + gy.phase) % gy.period;
        const warn = t > 1.0 && t < 1.7;
        const active = t >= 1.7 && t < 2.6;
        gy.disc.material.emissiveIntensity = active ? 4 : warn ? 0.6 + (t - 1.0) * 4 : 0.35;
        gy.collider.active = active;
        gy.col.visible = active || warn;
        const k = active ? Math.min(1, (t - 1.7) * 6) * (1 - Math.max(0, (t - 2.4) * 5)) : warn ? 0.05 : 0;
        gy.col.scale.set(1, Math.max(0.01, k * 9), 1);
        gy.col.material.opacity = 0.5;
        gy.erupting = active;
        gy.justErupted = active && !gy.wasActive;
        gy.wasActive = active;
      }
      for (const a of seg.animated) {
        if (a.type === 'harvester') a.update(dt);
        else if (a.type === 'thumper') a.head.position.y = 2.4 + Math.abs(Math.sin(time * 4 + a.phase)) * 0.35;
      }
    }
  }
}
