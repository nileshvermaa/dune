import * as THREE from 'three';
import { mulberry32, lerp } from '../engine/noise.js';
import { zoneAt } from '../content/zones.js';
import * as P from './props.js';
import { SAND_BED } from './terrain.js';
import { LANE_W, HALF_W, DECK_HALF, DIRS, YAWS } from './layout.js';
import { OBSTACLES, EARLY_MIX } from './obstacles.js';
import { speedAt, layoutDifficulty, obstacleSpacing, stoneChance, stoneLength } from '../content/difficulty.js';
import { pickPowerup } from '../content/powerups.js';

// The trail across open desert: straight segments joined by 90° corners the runner must turn
// at, populated with obstacles, spice, power-ups and zone-specific scenery.

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
    this.reseat(line);

    this.populate(seg, first);
    this.buildTrail(seg, first);
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
    const w = early ? EARLY_MIX : zone.weights;
    let total = 0;
    for (const k in w) total += w[k];
    let r = rng() * total;
    for (const k in w) { r -= w[k]; if (r <= 0) return k; }
    return 'rock';
  }

  populate(seg, first) {
    const rng = this.rng;
    const L = seg.length;
    const diff = layoutDifficulty(seg.startDist);
    const events = [];
    // the old road survives only in scattered stretches of paving: the one ground the Maker
    // cannot follow onto. They grow rarer and shorter the deeper into the desert you go.
    seg.rocks = [];
    if (first) seg.rocks.push([-60, 40]);
    else if (L > 80 && rng() < stoneChance(diff)) {
      const len = stoneLength(diff, rng);
      const a = 25 + rng() * Math.max(0, L - 60 - len);
      seg.rocks.push([a, a + len]);
    }
    let s = first ? 70 : 30;
    const endS = L - 26;
    while (s < endS) {
      const early = seg.startDist + s < 300;
      const type = this.pickType(seg.zone, rng, early);
      // sinkholes never open in the old paving
      if (type === 'gap' && this.onRock(seg, s, -6)) { s += 6; continue; }
      events.push(this.placeObstacle(seg, type, s, rng, diff));
      const v = speedAt(seg.startDist + s);
      // reaction time between obstacles tightens slowly as the run goes on
      s += obstacleSpacing(v, diff, rng);
    }
    this.placePickups(seg, events, first);
  }

  addCollider(seg, o) {
    o.active = true;
    seg.obstacles.push(o);
    return o;
  }

  // build one obstacle (see world/obstacles.js) and note how the runner gets past it
  placeObstacle(seg, type, s, rng, diff) {
    const way = OBSTACLES[type].place({ track: this, seg, s, rng, diff });
    return { s, type, free: [-1, 0, 1], blocked: [], ...way };
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
    if (!first && intervals.length && rng() < 0.6) {
      const [a, b] = intervals[Math.floor(rng() * intervals.length)];
      const s = (a + b) / 2;
      const lane = Math.floor(rng() * 3) - 1;
      const type = pickPowerup(rng);
      for (const p of seg.pickups) {
        if (Math.abs(p.s - s) < 3 && Math.abs(p.x - lane * LANE_W) < 0.5) { p.taken = true; p.mesh.visible = false; }
      }
      this.addPickup(seg, type, lane * LANE_W, 1.3, s);
    }
  }

  // on a surviving stretch of the old paving (safe from the Maker)
  onRock(seg, s, pad = 0) {
    if (!seg.rocks) return false;
    for (const [a, b] of seg.rocks) if (s > a + pad && s < b - pad) return true;
    return false;
  }

  inGap(seg, s, pad = 0) {
    for (const [a, b] of seg.gaps) if (s > a + pad && s < b - pad) return true;
    return false;
  }

  // The trail through open desert: no causeway any more. What the segment builds is the old
  // road's surviving paving (safe ground), sinkholes, the turn markers, and the rock face that
  // closes every corner (miss the turn and you run into it).
  buildTrail(seg, first) {
    const L = seg.length;
    const g = seg.group;
    const rng = this.rng;
    const blocks = [];
    const add = (x, y, z, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) => blocks.push({ x, y, z, sx, sy, sz, color, ry, rx, rz });
    const tile = () => {
      const r = rng();
      const base = r < 0.12 ? TILE.weathered : r < 0.2 ? TILE.cream : r < 0.26 ? TILE.red : TILE.base;
      return base.clone().multiplyScalar(0.84 + rng() * 0.2);
    };
    // weathered paving: slabs sunk flush with the sand, ragged and missing toward the margins
    for (const [a, b] of seg.rocks) {
      let s = a;
      while (s < b - 0.05) {
        const l = Math.min(1.3 + rng() * 0.55, b - s);
        const ends = Math.min(s - a, b - s - l);
        let x = -3.9;
        while (x < 3.9) {
          const w = [1.0, 1.35, 1.8][Math.floor(rng() * 3)];
          const edge = Math.abs(x + w / 2) / 3.9;
          // keep the lanes complete; lose slabs at the sides and the broken ends
          const keep = edge < 0.75 || rng() > edge * 0.9 - (ends > 3 ? 0 : 0.3);
          if (keep) {
            const sink = edge > 0.75 ? -0.05 - rng() * 0.08 : 0;
            add(x + w / 2, -0.11 + sink, -(s + l / 2), w - 0.08, 0.24, l - 0.08, tile(), (rng() - 0.5) * 0.04, (rng() - 0.5) * 0.02, (rng() - 0.5) * 0.02);
          }
          x += w;
        }
        s += l;
      }
      // a few toppled kerb stones mark where the stone begins and ends
      for (const end of [a, b]) {
        for (let k = 0; k < 3; k++) {
          add((rng() < 0.5 ? -1 : 1) * (4.3 + rng() * 1.4), 0.12, -(end + (rng() - 0.5) * 2), 0.9 + rng() * 0.6, 0.45, 0.6 + rng() * 0.4, TILE.parapet.clone().multiplyScalar(0.85 + rng() * 0.2), rng() * 3, (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.4);
        }
      }
    }
    // sinkholes: the sand pours away into darkness
    for (const [a, b] of seg.gaps) {
      const pit = new THREE.Mesh(P.geo('sinkhole') || P.makeSinkholeGeometry(), P.mats.sinkhole);
      pit.scale.set(HALF_W + 1.2, 1, (b - a) / 2 + 0.4);
      pit.position.set(0, 0.02, -(a + b) / 2);
      pit.userData.shadow = false;
      g.add(pit);
    }

    // the turn: glowing arrows on the sand, a cairn on the outside, and a rock face ahead
    const arrowGeo = new THREE.PlaneGeometry(3.2, 3.2);
    seg.geos.push(arrowGeo);
    for (const ss of [L - 16, L - 10, L - 4.5]) {
      const arrow = new THREE.Mesh(arrowGeo, P.mats.arrow);
      arrow.position.set(0, 0.05, -ss);
      arrow.rotation.set(-Math.PI / 2, 0, seg.turn < 0 ? Math.PI : 0);
      arrow.renderOrder = 2;
      arrow.userData.shadow = false;
      g.add(arrow);
    }
    const ob = P.makeObelisk();
    ob.position.set(-seg.turn * (DECK_HALF + 2.6), 0, -(L + DECK_HALF + 2.6));
    g.add(ob);
    const cliff = P.makeRock('mesa', Math.floor(rng() * 4), 30, 26, 10);
    cliff.position.set(-seg.turn * 6, -2, -(L + DECK_HALF + 9));
    cliff.rotation.y = (rng() - 0.5) * 0.3;
    cliff.userData.shadow = false;
    g.add(cliff);
    // running past the turning point means running into the rock: fatal
    this.addCollider(seg, { kind: 'cliff', fatal: true, mesh: cliff, s0: L + DECK_HALF + 0.6, s1: L + DECK_HALF + 6, x0: -12, x1: 12, y0: -5, y1: 40 });

    if (blocks.length) {
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
  }

  // Pebbles scattered beyond the trail edges.
  dressSand(seg, first) {
    const rng = this.rng;
    const L = seg.length;
    const piles = [];
    const free = (s) => !this.inGap(seg, s, -2) && (s < L - 13 || s > L + 5);
    for (let s = first ? -55 : 6; s < L - 4; s += 2.5 + rng() * 4) {
      if (!free(s)) continue;
      rng(); // edge drifts read as flat cut-outs on open sand; kept off (rng call keeps layouts stable)
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

  // r > 0 seats the prop on the lowest ground under a footprint of that half-width
  propAt(seg, obj, x, s, yOffset = 0, onBed = false, r = 0) {
    const w = this.localToWorld(seg, x, s, new THREE.Vector3());
    const h = onBed ? SAND_BED : r > 0 ? this.lowestUnder(seg, x, s, r) : this.terrain.heightAt(w.x, w.z);
    obj.position.set(x, h + yOffset, -s);
    // remember how it was seated: later road segments flatten the dunes they pass through
    if (!onBed) (seg.seated || (seg.seated = [])).push({ obj, x, s, r, off: yOffset, wx: w.x, wz: w.z });
    obj.userData.shadow = false;
    obj.traverse((o) => { o.userData.shadow = false; });
    seg.group.add(obj);
    return obj;
  }

  // A new stretch of road carves the dunes within ~70 m: drop earlier props back onto the sand.
  reseat(line) {
    for (const seg of this.segments) {
      if (!seg.seated) continue;
      for (const e of seg.seated) {
        if (e.wx < line.minx - 75 || e.wx > line.maxx + 75 || e.wz < line.minz - 75 || e.wz > line.maxz + 75) continue;
        const h = e.r > 0 ? this.lowestUnder(seg, e.x, e.s, e.r) : this.terrain.heightAt(e.wx, e.wz);
        e.obj.position.y = h + e.off;
      }
    }
  }

  // lowest terrain height across a square footprint, so wide props never overhang a slope
  lowestUnder(seg, x, s, r) {
    const w = new THREE.Vector3();
    let lo = Infinity;
    for (const [dx, ds] of [[0, 0], [-r, -r], [r, -r], [-r, r], [r, r], [0, r], [0, -r], [r, 0], [-r, 0]]) {
      this.localToWorld(seg, x + dx, s + ds, w);
      lo = Math.min(lo, this.terrain.heightAt(w.x, w.z));
    }
    return lo;
  }

  decorate(seg, first) {
    const rng = this.rng;
    const L = seg.length;
    const z = seg.zone.id;
    const s0 = first ? -50 : 0;

    // trail lanterns staked in the sand, alternating sides
    for (let s = first ? -36 : 12, k = 0; s < L - 8; s += 34, k++) {
      if (this.inGap(seg, s, -1.5)) continue;
      const post = P.makeGlowPost();
      post.position.set((k % 2 ? 1 : -1) * 5.2, 0, -s);
      post.scale.setScalar(1.35);
      post.traverse((o) => { o.userData.shadow = false; });
      seg.group.add(post);
    }

    const sideLat = (side, near, far) => side * (side < 0 ? Math.max(near, 22) + rng() * (far - near) : near + rng() * (far - near));
    // big set pieces must stay clear of every stretch of road, including the next one after the
    // corner (not built yet, but it leaves from this segment's end)
    const clear = (x, s, min) => {
      if (L - s < min || s < -40) return false;
      const w = this.localToWorld(seg, x, s, new THREE.Vector3());
      return this.terrain.trackDistance(w.x, w.z) >= min;
    };
    const lat = () => (rng() < 0.5 ? -1 : 1);

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
      // mid-distance sandstone shelves breaking the dune sea, with scree at their feet
      for (let s = s0 + 30; s < L; s += 70 + rng() * 60) {
        if (rng() > (z === 'storm' ? 0.35 : 0.7)) continue;
        const x = lat() * (55 + rng() * 80);
        if (!clear(x, s, 40)) continue;
        const w = 14 + rng() * 22;
        const shelf = this.propAt(seg, P.makeRock('mesa', Math.floor(rng() * 4), w, 6 + rng() * 12, w * (0.5 + rng() * 0.5)), x, s, -2.5, false, w * 0.55);
        shelf.rotation.y = rng() * 6.28;
        for (let k = 0; k < 4; k++) {
          const b = 1.5 + rng() * 3;
          const rock = this.propAt(seg, P.makeRock('boulder', Math.floor(rng() * 4), b, b * 0.7, b), x + (rng() - 0.5) * w * 1.6, s + (rng() - 0.5) * w * 1.6, -b * 0.1, false, b * 0.5);
          rock.rotation.y = rng() * 6.28;
        }
      }
      // rarely: a dark monolith half-buried in the dunes
      if (z === 'desert' && rng() < 0.22) {
        const s = 40 + rng() * Math.max(1, L - 80);
        const x = lat() * (80 + rng() * 110);
        if (clear(x, s, 60)) {
          const m = this.propAt(seg, P.makeMonolith(), x, s, -5);
          m.rotation.set((rng() - 0.5) * 0.3, rng() * 6.28, 0.12 + rng() * 0.25);
        }
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
      // the drowned city: broken walls close by, watchtowers on the skyline
      for (let s = s0 + 10; s < L - 10; s += 26 + rng() * 18) {
        if (rng() > 0.6) continue;
        const x = lat() * (15 + rng() * 22);
        if (!clear(x, s, 12)) continue;
        const wall = this.propAt(seg, P.makeRuinWall(rng), x, s, -0.8, true);
        wall.rotation.y = (rng() < 0.6 ? 0 : Math.PI / 2) + (rng() - 0.5) * 0.4;
      }
      for (let s = s0 + 40; s < L; s += 80 + rng() * 50) {
        if (rng() > 0.7) continue;
        const x = lat() * (70 + rng() * 110);
        if (!clear(x, s, 45)) continue;
        const tw = this.propAt(seg, P.makeRuinTower(rng), x, s, -2);
        tw.rotation.set((rng() - 0.5) * 0.08, rng() * 6.28, (rng() - 0.5) * 0.08);
      }
    } else if (z === 'spice') {
      const hx = lat() * (85 + rng() * 40);
      if (L > 90 && clear(hx, L * 0.5, 55)) {
        const h = P.makeHarvester();
        h.group.rotation.y = rng() * 6.28;
        this.propAt(seg, h.group, hx, L * 0.5, -1);
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
        if (OBSTACLES[a.type]?.animate) OBSTACLES[a.type].animate(a, time, dt);
        else if (a.type === 'harvester') a.update(dt);
        else if (a.type === 'thumper') a.head.position.y = 2.4 + Math.abs(Math.sin(time * 4 + a.phase)) * 0.35;
      }
    }
  }
}
