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

const TILE = {
  base: new THREE.Color('#c9a17a'),
  weathered: new THREE.Color('#a07a56'),
  cream: new THREE.Color('#d9bd96'),
  red: new THREE.Color('#b98c6c'),
  parapet: new THREE.Color('#b58c63'),
  pilaster: new THREE.Color('#c19870'),
  cap: new THREE.Color('#d4b38a'),
  cornice: new THREE.Color('#cba882'),
  buttress: new THREE.Color('#a9805a'),
};

const DRIFT_TOP = new THREE.Color('#dcae78');
const DRIFT_EDGE = new THREE.Color('#ad7c4f');

let medalRing = null;
let medalDisc = null;
const MEDAL_DISC = () => medalDisc || (medalDisc = new THREE.CylinderGeometry(1.7, 1.7, 0.04, 40));
const MEDAL_RING = () => medalRing || (medalRing = new THREE.RingGeometry(1.45, 1.6, 48));

function smoothstepJS(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
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
    for (const d of seg.disposables) d.dispose();
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
      geos: [], mats: [], disposables: [], group: new THREE.Group(), prev, next: null,
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
    this.dressSand(seg, first);
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
    seg.crossings = [];
    if (!first && seg.startDist > 320 && L > 110) {
      const chance = { desert: 0.7, shieldwall: 0.3, ruins: 0.3, spice: 0.6, storm: 0.45 }[seg.zone.id];
      if (rng() < chance) {
        const len = Math.min(L - 85, 60 + rng() * 55 + diff * 40);
        const a = 38 + rng() * Math.max(0, L - 80 - len);
        seg.crossings.push([a, a + len]);
      }
    }
    let s = first ? 90 : 32;
    const endS = L - 30;
    while (s < endS) {
      const cr = seg.crossings.find(([a, b]) => s > a - 10 && s < b + 8);
      if (cr) { s = cr[1] + 14; continue; }
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
          mesh = P.makeRock('spire', Math.floor(rng() * 4), 0.8, 4.2 + rng() * 2.6, 0.8);
          mesh.position.set(lane * LANE_W, -0.15, -s);
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
    for (const [a, b] of intervals) {
      if (b - a < 14 || rng() > 0.38) continue;
      const s = a + (b - a) * (0.3 + rng() * 0.4);
      const lane = Math.floor(rng() * 3) - 1;
      for (const p of seg.pickups) {
        if (Math.abs(p.s - s) < 2.5 && Math.abs(p.x - lane * LANE_W) < 0.5) { p.taken = true; p.mesh.visible = false; }
      }
      this.addPickup(seg, 'water', lane * LANE_W, 1.1, s);
    }
    this.addPickup(seg, 'cache', 0, 1.2, L - 2.5);
    if (!first && intervals.length && rng() < 0.5) {
      const [a, b] = intervals[Math.floor(rng() * intervals.length)];
      const s = (a + b) / 2;
      const lane = Math.floor(rng() * 3) - 1;
      const r = rng();
      const type = r < 0.28 ? 'shield' : r < 0.62 ? 'thumper' : r < 0.8 ? 'hooks' : 'thopter';
      for (const p of seg.pickups) {
        if (Math.abs(p.s - s) < 3 && Math.abs(p.x - lane * LANE_W) < 0.5) { p.taken = true; p.mesh.visible = false; }
      }
      this.addPickup(seg, type, lane * LANE_W, 1.3, s);
    }
  }

  inCrossing(seg, s, pad = 0) {
    if (!seg.crossings) return false;
    for (const [a, b] of seg.crossings) if (s > a + pad && s < b - pad) return true;
    return false;
  }

  inGap(seg, s, pad = 0) {
    for (const [a, b] of seg.gaps) if (s > a + pad && s < b - pad) return true;
    return false;
  }

  buildDeck(seg, first) {
    const L = seg.length;
    const g = seg.group;
    const rng = this.rng;
    const blocks = [];
    const add = (x, y, z, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) => blocks.push({ x, y, z, sx, sy, sz, color, ry, rx, rz });
    const addMesh = (geom, mat, x, y, z, receive = true) => {
      seg.geos.push(geom);
      const m = new THREE.Mesh(geom, mat);
      m.position.set(x, y, z);
      m.receiveShadow = receive;
      m.userData.shadow = false;
      g.add(m);
      return m;
    };
    const coreMats = [P.mats.wall, P.mats.wall, P.mats.mortar, P.mats.wall, P.mats.wall, P.mats.wall];
    const tile = () => {
      const r = rng();
      const base = r < 0.07 ? TILE.weathered : r < 0.12 ? TILE.cream : r < 0.16 ? TILE.red : TILE.base;
      return base.clone().multiplyScalar(0.86 + rng() * 0.2);
    };
    // running-bond paving slabs, optionally broken off at the far end (gap edges)
    const pave = (a, b, x0, x1, ragged = false) => {
      let s = a;
      while (s < b - 0.05) {
        const l = Math.min(1.3 + rng() * 0.55, b - s);
        let x = x0;
        while (x < x1 - 0.05) {
          let w = [1.0, 1.35, 1.8, 2.2][Math.floor(rng() * 4)];
          if (x1 - x - w < 0.75) w = x1 - x;
          const ll = ragged && s + l >= b - 0.01 ? l * (0.45 + rng() * 0.55) : l;
          add(x + w / 2, -0.13 + (rng() - 0.5) * 0.025, -(s + ll / 2), w - 0.07, 0.26, ll - 0.07, tile(), (rng() - 0.5) * 0.012, (rng() - 0.5) * 0.012, (rng() - 0.5) * 0.012);
          x += w;
        }
        s += l;
      }
    };
    // low parapet with a pilaster every 12m (lanterns sit on every other one)
    const parapet = (side, a, b) => {
      const x = side * 3.79;
      const posts = [];
      for (let p = Math.ceil(a / 12) * 12; p < b; p += 12) if (p > a + 0.4 && p < b - 0.4) posts.push(p);
      let s = a;
      for (const p of [...posts, b + 1]) {
        const stop = Math.min(b, p - 0.36);
        while (s < stop - 0.1) {
          const l = Math.min(1.1 + rng() * 0.6, stop - s);
          add(x, 0.11, -(s + l / 2), 0.42, 0.42, l - 0.04, TILE.parapet.clone().multiplyScalar(0.88 + rng() * 0.16));
          s += l;
        }
        if (p <= b) {
          add(x, 0.3, -p, 0.62, 0.8, 0.62, TILE.pilaster.clone().multiplyScalar(0.92 + rng() * 0.12));
          add(x, 0.76, -p, 0.76, 0.12, 0.76, TILE.cap.clone());
          s = p + 0.36;
        }
      }
    };
    // cornice, plinth and buttresses dressing the causeway walls
    const walls = (a, b) => {
      for (const side of [-1, 1]) {
        for (let s = a; s < b - 0.05; s += 2) {
          const l = Math.min(2, b - s);
          add(side * 4.05, -0.28, -(s + l / 2), 0.3, 0.24, l - 0.02, TILE.cornice.clone().multiplyScalar(0.94 + rng() * 0.1));
          add(side * 4.03, -2.45, -(s + l / 2), 0.26, 0.42, l - 0.02, TILE.buttress.clone());
        }
        for (let s = Math.ceil(a / 6) * 6 + 3; s < b - 0.5; s += 6) {
          add(side * 4.2, -1.75, -s, 0.4, 2.5, 0.85, TILE.buttress.clone().multiplyScalar(0.9 + rng() * 0.15));
          add(side * 4.16, -0.5, -s, 0.5, 0.18, 1.0, TILE.cornice.clone());
        }
      }
    };
    const piece = (a, b, raggedEnd) => {
      const len = b - a;
      if (len <= 0.05) return;
      addMesh(deckGeometry(DECK_HALF * 2, DECK_DEPTH, len), coreMats, 0, -0.1 - DECK_DEPTH / 2, -(a + b) / 2);
      pave(a, b, -3.58, 3.58, raggedEnd);
      this.driftStrip(seg, -4.0, a, 0, 1, -1, 0, len);
      this.driftStrip(seg, 4.0, a, 0, 1, 1, 0, len);
      parapet(-1, a, b);
      parapet(1, a, b);
      walls(a, b);
    };

    let cur = first ? -60 : DECK_HALF;
    const breaks = [...seg.gaps.map((g) => [g[0], g[1], 'gap']), ...(seg.crossings || []).map((c) => [c[0], c[1], 'sand'])].sort((x, y) => x[0] - y[0]);
    for (const [a, b, kind] of breaks) {
      piece(cur, a, true);
      if (kind === 'sand') {
        this.sandRoad(seg, a, b, blocks);
        cur = b;
        continue;
      }
      const pit = addMesh(new THREE.PlaneGeometry(DECK_HALF * 2, b - a), P.mats.dark, 0, SAND_BED + 0.25, -(a + b) / 2, false);
      pit.rotation.x = -Math.PI / 2;
      for (let k = 0; k < 4; k++) {
        add((rng() - 0.5) * 6, SAND_BED + 0.35, -(a + rng() * (b - a)), 0.9 + rng() * 0.8, 0.26, 0.8 + rng() * 0.6, tile(), rng() * 3, (rng() - 0.5) * 0.6, (rng() - 0.5) * 0.6);
      }
      cur = b;
    }
    piece(cur, L - DECK_HALF, false);

    // corner platform: square paving, closed parapets, inlaid medallion
    addMesh(deckGeometry(DECK_HALF * 2, DECK_DEPTH, DECK_HALF * 2), coreMats, 0, -0.1 - DECK_DEPTH / 2, -L);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        add(-3.58 + 0.895 + i * 1.79, -0.13, -(L - 3.58 + 0.895 + j * 1.79), 1.72, 0.26, 1.72, tile());
      }
    }
    for (let x = -3.58; x < 3.5; x += 1.43) add(x + 0.715, 0.11, -(L + 3.79), 1.39, 0.42, 0.42, TILE.parapet.clone().multiplyScalar(0.9 + rng() * 0.15));
    const cs = -seg.turn;
    for (let s = L - 3.58; s < L + 3.5; s += 1.43) add(cs * 3.79, 0.11, -(s + 0.715), 0.42, 0.42, 1.39, TILE.parapet.clone().multiplyScalar(0.9 + rng() * 0.15));
    for (const [x, s] of [[cs * 3.79, L + 3.79], [-cs * 3.79, L + 3.79], [cs * 3.79, L - 3.79]]) {
      add(x, 0.4, -s, 0.7, 1.0, 0.7, TILE.pilaster.clone());
      add(x, 0.96, -s, 0.84, 0.14, 0.84, TILE.cap.clone());
    }
    for (const side of [-1, 1]) add(side * 4.05, -0.28, -L, 0.3, 0.24, 8, TILE.cornice.clone());
    this.driftStrip(seg, -4.4, L + 4.0, 1, 0, 0, 1, 8.8);
    this.driftStrip(seg, cs * 4.0, L - 4.0, 0, 1, cs, 0, 8.4);
    add(0, -0.28, -(L + 4.05), 8.6, 0.24, 0.3, TILE.cornice.clone());
    const medalGeo = MEDAL_DISC();
    const medal = new THREE.Mesh(medalGeo, P.mats.tile);
    medal.position.set(0, 0.008, -L);
    medal.receiveShadow = true;
    medal.userData.shadow = false;
    g.add(medal);
    const ring = new THREE.Mesh(MEDAL_RING(), P.mats.spiceGlow);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.035, -L);
    ring.userData.shadow = false;
    g.add(ring);

    const arrowGeo = new THREE.PlaneGeometry(3.2, 3.2);
    for (const ss of [L - 10, L - 5.5]) {
      const arrow = addMesh(arrowGeo, P.mats.arrow, 0, 0.03, -ss, false);
      arrow.rotation.set(-Math.PI / 2, 0, seg.turn < 0 ? Math.PI : 0);
      arrow.renderOrder = 2;
    }
    const ob = P.makeObelisk();
    ob.position.set(-seg.turn * (DECK_HALF + 2.6), 0, -(L + DECK_HALF + 2.6));
    g.add(ob);

    const im = new THREE.InstancedMesh(P.geo('block'), P.mats.tile, blocks.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    blocks.forEach((b, i) => {
      q.setFromEuler(e.set(b.rx, b.ry, b.rz));
      m4.compose(p.set(b.x, b.y, b.z), q, sc.set(b.sx, b.sy, b.sz));
      im.setMatrixAt(i, m4);
      im.setColorAt(i, b.color);
    });
    im.instanceMatrix.needsUpdate = true;
    im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.receiveShadow = true;
    im.castShadow = true;
    im.userData.shadow = false;
    g.add(im);
    seg.disposables.push(im);
  }

  // Where dunes have buried the road: a walkable sand ridge with a few slabs poking through.
  sandRoad(seg, a, b, blocks) {
    const rng = this.rng;
    const s0 = a - 2, s1 = b + 2;
    const n = Math.max(2, Math.ceil((s1 - s0) / 1.2));
    const xs = [-11, -8.5, -6.5, -5, -3.9, -2, 0, 2, 3.9, 5, 6.5, 8.5, 11];
    const J = xs.length;
    const pos = new Float32Array((n + 1) * J * 3);
    const uv = new Float32Array((n + 1) * J * 2);
    const col = new Float32Array((n + 1) * J * 3);
    const w = new THREE.Vector3();
    const c = new THREE.Color();
    const noise = this.terrain.noise;
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      // sand heaps up over the broken ends of the stone road
      const heap = Math.max(0, 1 - Math.abs(s - a) / 3.5) + Math.max(0, 1 - Math.abs(s - b) / 3.5);
      for (let j = 0; j < J; j++) {
        const x = xs[j];
        this.localToWorld(seg, x, s, w);
        const ax = Math.abs(x);
        const edge = smoothstepJS(3.9, 11, ax);
        const ripple = noise(w.x * 0.3, w.z * 0.3) * 0.05;
        let y = 0.02 + ripple + heap * 0.22 * (1 - edge);
        y = y + (SAND_BED - 0.1 - y) * Math.pow(edge, 1.3);
        const k = i * J + j;
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = -s;
        uv[k * 2] = w.x / 6; uv[k * 2 + 1] = w.z / 6;
        c.copy(DRIFT_TOP).lerp(DRIFT_EDGE, edge * 0.9);
        col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
      }
    }
    const idx = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < J - 1; j++) {
        const p = i * J + j, q = p + 1, r = p + J, t = r + 1;
        idx.push(p, q, r, q, t, r);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    if (g.attributes.normal.getY(Math.floor(J / 2)) < 0) {
      for (let i = 0; i < idx.length; i += 3) { const tmp = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = tmp; }
      g.setIndex(idx);
      g.computeVertexNormals();
    }
    seg.geos.push(g);
    const m = new THREE.Mesh(g, this.terrain.material);
    m.receiveShadow = true;
    m.userData.shadow = false;
    seg.group.add(m);
    // half-buried slabs at the margins hint at the road below
    for (let s = a + 4; s < b - 4; s += 3 + rng() * 6) {
      const side = rng() < 0.5 ? -1 : 1;
      blocks.push({ x: side * (3.3 + rng() * 1.6), y: -0.18, z: -s, sx: 1.2 + rng(), sy: 0.26, sz: 1.0 + rng() * 0.8, color: TILE.weathered.clone().multiplyScalar(0.9 + rng() * 0.2), ry: rng() * 0.6, rx: (rng() - 0.5) * 0.4, rz: (rng() - 0.5) * 0.4 });
    }
  }

  // Wind-blown sand banked against a causeway wall. Start (x0, s0) in segment-local
  // coordinates, running along (ax, as) for len metres and spilling outward along (ox, os).
  driftStrip(seg, x0, s0, ax, as, ox, os, len) {
    const n = Math.max(2, Math.ceil(len / 1.4));
    const J = 7;
    const pos = new Float32Array((n + 1) * J * 3);
    const uv = new Float32Array((n + 1) * J * 2);
    const col = new Float32Array((n + 1) * J * 3);
    const w = new THREE.Vector3();
    const noise = this.terrain.noise;
    const c = new THREE.Color();
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * len;
      const bx = x0 + ax * t, bs = s0 + as * t;
      this.localToWorld(seg, bx, bs, w);
      const n1 = noise(w.x * 0.045, w.z * 0.045) * 0.5 + 0.5;
      const n2 = noise(w.x * 0.11 + 7, w.z * 0.11 - 3) * 0.5 + 0.5;
      const width = 3.5 + n1 * 4.5;
      const top = Math.min(-0.5, SAND_BED + 0.5 + n1 * 1.3 + n2 * 0.6);
      for (let j = 0; j < J; j++) {
        const u = j / (J - 1);
        const d = -0.15 + u * width;
        const x = bx + ox * d, s = bs + os * d;
        const y = SAND_BED - 0.08 + (top - SAND_BED) * Math.pow(1 - u, 1.7) + Math.sin(d * 2.1 + t * 0.7) * 0.04 * (1 - u);
        const k = (i * J + j);
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = -s;
        this.localToWorld(seg, x, s, w);
        uv[k * 2] = w.x / 6; uv[k * 2 + 1] = w.z / 6;
        c.copy(DRIFT_TOP).lerp(DRIFT_EDGE, Math.pow(u, 0.8));
        col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
      }
    }
    const idx = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < J - 1; j++) {
        const a = i * J + j, b = a + 1, cc = a + J, d = cc + 1;
        idx.push(a, cc, b, b, cc, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // flip winding where the strip runs "backwards" so faces point up
    const nrm = g.attributes.normal;
    if (nrm.getY(0) < 0) {
      for (let i = 0; i < idx.length; i += 3) { const tmp = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = tmp; }
      g.setIndex(idx);
      g.computeVertexNormals();
    }
    seg.geos.push(g);
    const m = new THREE.Mesh(g, this.terrain.material);
    m.receiveShadow = true;
    m.userData.shadow = false;
    seg.group.add(m);
  }

  // Sand banked against the parapets, pebbles on the sand bed.
  dressSand(seg, first) {
    const rng = this.rng;
    const L = seg.length;
    const piles = [];
    const free = (s) => !this.inGap(seg, s, -2) && !this.inCrossing(seg, s, -3) && (s < L - 13 || s > L + 5);
    for (let s = first ? -55 : 6; s < L - 4; s += 2.5 + rng() * 4) {
      if (!free(s)) continue;
      if (rng() < 0.4) {
        const side = rng() < 0.5 ? -1 : 1;
        const wdt = 0.45 + rng() * 0.6;
        piles.push([side * (3.62 - wdt * 0.2), -0.04, -s, wdt, 0.07 + rng() * 0.07, 1.2 + rng() * 2.2, (rng() - 0.5) * 0.2]);
      }
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    if (piles.length) {
      const im = new THREE.InstancedMesh(P.geo('sandPile'), P.mats.sandPile, piles.length);
      piles.forEach(([x, y, z, sx, sy, sz, ry], i) => {
        q.setFromEuler(e.set(0, ry, 0));
        im.setMatrixAt(i, m4.compose(p.set(x, y, z), q, sc.set(sx, sy, sz)));
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.receiveShadow = true;
      im.userData.shadow = false;
      seg.group.add(im);
      seg.disposables.push(im);
    }
    const peb = [];
    const w = new THREE.Vector3();
    for (let s = first ? -55 : 0; s < L; s += 3 + rng() * 5) {
      const side = rng() < 0.5 ? -1 : 1;
      const x = side * (11 + rng() * 10);
      this.localToWorld(seg, x, s, w);
      const k = 0.18 + rng() * rng() * 0.9;
      peb.push([x, this.terrain.heightAt(w.x, w.z) + k * 0.15, -s, k * (0.8 + rng() * 0.5), k * (0.5 + rng() * 0.4), k * (0.8 + rng() * 0.5), rng() * 6.28]);
    }
    if (peb.length) {
      const im = new THREE.InstancedMesh(P.rockGeometry('boulder', 1), P.mats.rock, peb.length);
      peb.forEach(([x, y, z, sx, sy, sz, ry], i) => {
        q.setFromEuler(e.set(0, ry, 0));
        im.setMatrixAt(i, m4.compose(p.set(x, y, z), q, sc.set(sx, sy, sz)));
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = true;
      im.receiveShadow = true;
      im.userData.shadow = false;
      seg.group.add(im);
      seg.disposables.push(im);
    }
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

    for (let s = first ? -36 : 12, k = 0; s < L - 8; s += 24, k++) {
      if (this.inGap(seg, s, -1.5) || this.inCrossing(seg, s, -3)) continue;
      const post = P.makeGlowPost();
      post.position.set((k % 2 ? 1 : -1) * 3.79, 0.82, -s);
      post.traverse((o) => { o.userData.shadow = false; });
      seg.group.add(post);
    }

    const sideLat = (side, near, far) => side * (side < 0 ? Math.max(near, 22) + rng() * (far - near) : near + rng() * (far - near));

    if (z === 'desert' || z === 'storm') {
      for (let s = s0; s < L; s += 20) {
        if (rng() < (z === 'storm' ? 0.3 : 0.5)) {
          const side = rng() < 0.5 ? -1 : 1;
          const sc = 2 + rng() * 5;
          const sy = sc * (0.6 + rng() * 0.8);
          this.propAt(seg, P.makeRock('boulder', Math.floor(rng() * 4), sc, sy, sc), sideLat(side, 13, 42), s, sy * 0.15).rotation.y = rng() * 6.28;
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
