import * as THREE from 'three';
import { tex } from './props.js';
import { smoothstep } from './noise.js';
import { SAND_BED } from './terrain.js';

// worm heights below were tuned against a sand bed 2.6 m under the old causeway
const BED = SAND_BED + 2.6;

// Sandworm: one continuous armoured tube swept along a spine (rebuilt every frame), and a head
// whose three thick petals close into a blunt prow and open on rows of teeth and a glowing
// throat. Used for the chaser, distant breaches, the ride and the death scene.

const Y = new THREE.Vector3(0, 1, 0);
const RADIAL = 30; // vertices around the body
const RING = 6; // sub-rings per segment (two armour bands of three)
let shared = null;

function getShared() {
  if (shared) return shared;
  // Hide: photo-scanned sandstone colour and rock relief (CC0, see public/textures/CREDITS.md)
  // on UVs that travel with the body, so the texture never swims as the worm moves.
  const hide = new THREE.MeshStandardMaterial({ color: '#d9b48a', vertexColors: true, roughness: 0.86, metalness: 0.03 });
  const loader = new THREE.TextureLoader();
  const load = (file, apply) => loader.load(`/textures/${file}`, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    apply(t);
    hide.needsUpdate = true;
  }, undefined, () => {});
  load('sandstone_diff.webp', (t) => { t.colorSpace = THREE.SRGBColorSpace; hide.map = t; });
  load('rock_nor.webp', (t) => { hide.normalMap = t; hide.normalScale.set(1.6, 1.6); });
  if (tex.sand) { hide.normalMap = tex.sand.normalMap; hide.normalScale.set(1.2, 1.2); }

  const flesh = new THREE.MeshStandardMaterial({ color: '#6a2412', emissive: '#2a0702', roughness: 0.55, side: THREE.BackSide });
  const gum = new THREE.MeshStandardMaterial({ color: '#4a170b', roughness: 0.5 });
  const tooth = new THREE.MeshStandardMaterial({ color: '#efe4cc', emissive: '#2e2418', roughness: 0.22, metalness: 0.05 });

  // throat: unlit, dark at the lips and glowing ember-orange in the depths (HDR for bloom)
  const throatGeo = new THREE.CylinderGeometry(1.02, 0.04, 2.8, 28, 10, true);
  throatGeo.translate(0, -1.4, 0);
  const tc = new Float32Array(throatGeo.attributes.position.count * 3);
  const tp = throatGeo.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const d = THREE.MathUtils.clamp(-tp.getY(i) / 2.8, 0, 1);
    const k = Math.pow(d, 5);
    tc[i * 3] = 0.09 + d * 0.12 + k * 2.4; tc[i * 3 + 1] = 0.02 + d * 0.02 + k * 0.7; tc[i * 3 + 2] = 0.015 + k * 0.12;
  }
  throatGeo.setAttribute('color', new THREE.BufferAttribute(tc, 3));
  const throat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });

  // neck collar below the petals: heavy overlapping armour bands
  const neckProf = [];
  for (let i = 0; i <= 24; i++) {
    const y = -1.2 + (i / 24) * 1.2;
    const band = ((y + 1.2) / 0.4) % 1;
    neckProf.push(new THREE.Vector2(1.0 + (y + 1.2) * 0.07 - (band < 0.18 ? (0.18 - band) * 0.35 : 0), y));
  }
  const neckGeo = new THREE.LatheGeometry(neckProf, RADIAL);
  paintBands(neckGeo, 0.4);

  // petal: one third of a blunt prow, hinged at the rim (y = 0, r = 1.1)
  const petalProf = [[1.1, 0], [1.15, 0.32], [1.1, 0.7], [0.92, 1.08], [0.62, 1.42], [0.3, 1.66], [0.04, 1.76]].map(([r, y]) => new THREE.Vector2(r, y));
  const petals = [];
  for (let k = 0; k < 3; k++) {
    const m = (k * Math.PI * 2) / 3;
    const gap = 0.035;
    const g = new THREE.LatheGeometry(petalProf, 12, m - Math.PI / 3 + gap, (Math.PI * 2) / 3 - gap * 2);
    paintBands(g, 0.36, 0.92);
    g.translate(-Math.sin(m) * 1.1, 0, -Math.cos(m) * 1.1);
    // thick rolled rim along both side edges and over the tip, so the plate reads as heavy
    const edge = (a) => petalProf.map((p) => new THREE.Vector3(Math.sin(a) * p.x - Math.sin(m) * 1.1, p.y, Math.cos(a) * p.x - Math.cos(m) * 1.1));
    const left = edge(m - Math.PI / 3 + gap), right = edge(m + Math.PI / 3 - gap);
    const rim = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([...left, ...right.reverse()]), 48, 0.055, 6, false);
    const rc = new Float32Array(rim.attributes.position.count * 3).fill(0.8);
    rim.setAttribute('color', new THREE.BufferAttribute(rc, 3));
    petals.push({ g, m, rim });
  }
  const toothGeo = new THREE.ConeGeometry(0.028, 0.3, 6);
  toothGeo.translate(0, 0.15, 0);
  shared = { hide, flesh, gum, tooth, throat, throatGeo, neckGeo, petals, petalProf, toothGeo };
  return shared;
}

// vertex colours for lathe parts: darker folds between bands
function paintBands(g, period, base = 1) {
  const p = g.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const band = (((p.getY(i) + 10) / period) % 1);
    const k = base * (band < 0.16 ? 0.55 + band * 2.8 : 1 - (band - 0.16) * 0.12);
    c[i * 3] = k; c[i * 3 + 1] = k * 0.95; c[i * 3 + 2] = k * 0.88;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
}

const _cr = (a, b, c, d, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
};

export class WormModel {
  constructor(count = 40, radius = 3.2, segLen = 2.6) {
    const S = getShared();
    this.count = count;
    this.radius = radius;
    this.segLen = segLen;
    this.group = new THREE.Group();
    this.points = Array.from({ length: count + 1 }, () => new THREE.Vector3());
    this.buildBody(S);

    this.head = new THREE.Group();
    this.headInner = new THREE.Group();
    this.headInner.scale.setScalar(radius);
    this.head.add(this.headInner);
    const neck = new THREE.Mesh(S.neckGeo, S.hide);
    neck.castShadow = true;
    this.headInner.add(neck);
    this.headInner.add(new THREE.Mesh(S.throatGeo, S.throat));
    const lips = new THREE.Mesh(new THREE.TorusGeometry(1.04, 0.07, 8, 40), S.gum);
    lips.rotation.x = Math.PI / 2;
    lips.position.y = 0.02;
    this.headInner.add(lips);

    // rings of teeth down the throat, pointing inward and down
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), dir = new THREE.Vector3();
    const throatRings = [[-0.05, 0.98, 30], [-0.45, 0.84, 26], [-0.85, 0.7, 22], [-1.3, 0.55, 18], [-1.75, 0.4, 14]];
    const tt = new THREE.InstancedMesh(S.toothGeo, S.tooth, throatRings.reduce((a, r) => a + r[2], 0));
    let ti = 0;
    for (const [y, rad, n] of throatRings) {
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + y * 2.3;
        p.set(Math.sin(a) * rad, y, Math.cos(a) * rad);
        dir.set(-Math.sin(a), -0.7, -Math.cos(a)).normalize();
        q.setFromUnitVectors(Y, dir);
        sc.setScalar(0.75 + ((k * 7) % 5) * 0.14);
        tt.setMatrixAt(ti++, mtx.compose(p, q, sc));
      }
    }
    this.headInner.add(tt);

    // petals: hide outside, flesh inside, each lined with teeth that open with it
    this.petals = [];
    for (const { g, m, rim } of S.petals) {
      const pivot = new THREE.Group();
      pivot.position.set(Math.sin(m) * 1.1, 0, Math.cos(m) * 1.1);
      const outer = new THREE.Mesh(g, S.hide);
      outer.castShadow = true;
      pivot.add(outer, new THREE.Mesh(g, S.flesh), new THREE.Mesh(rim, S.hide));
      const rows = [[0.18, 9], [0.32, 8], [0.46, 7], [0.6, 6], [0.74, 4]];
      const teeth = new THREE.InstancedMesh(S.toothGeo, S.tooth, rows.reduce((a, r) => a + r[1], 0));
      let n = 0;
      for (const [t, cnt] of rows) {
        const prof = S.petalProf;
        const f = t * (prof.length - 1), i0 = Math.floor(f), fr = f - i0;
        const r = THREE.MathUtils.lerp(prof[i0].x, prof[i0 + 1].x, fr) * 0.95;
        const y = THREE.MathUtils.lerp(prof[i0].y, prof[i0 + 1].y, fr);
        for (let k = 0; k < cnt; k++) {
          const a = m + ((k + 0.5) / cnt - 0.5) * ((Math.PI * 2) / 3 - 0.2);
          p.set(Math.sin(a) * r - Math.sin(m) * 1.1, y, Math.cos(a) * r - Math.cos(m) * 1.1);
          dir.set(-Math.sin(a), -0.45, -Math.cos(a)).normalize();
          q.setFromUnitVectors(Y, dir);
          sc.setScalar((0.9 + ((k * 5 + cnt) % 4) * 0.12) * (1.15 - t * 0.5));
          teeth.setMatrixAt(n++, mtx.compose(p, q, sc));
        }
      }
      pivot.add(teeth);
      this.headInner.add(pivot);
      this.petals.push({ pivot, axis: new THREE.Vector3(Math.cos(m), 0, -Math.sin(m)) });
    }
    this.group.add(this.head);
    this.setMouth(0);
    this._q = new THREE.Quaternion();
  }

  // continuous tube: (count * RING + 1) rings of RADIAL + 1 vertices (seam duplicated for UVs)
  buildBody(S) {
    const rings = this.count * RING + 1;
    const W = RADIAL + 1;
    const pos = new Float32Array(rings * W * 3);
    const uv = new Float32Array(rings * W * 2);
    const col = new Float32Array(rings * W * 3);
    this.profile = new Float32Array(rings);
    for (let r = 0; r < rings; r++) {
      // armour bands: a deep fold where each band tucks under the one ahead, then a slow swell
      const f = (r % 3) / 3;
      this.profile[r] = f < 0.34 ? 0.93 + f * 0.2 : 1.0 - (f - 0.34) * 0.04;
      for (let j = 0; j < W; j++) {
        const k = r * W + j;
        uv[k * 2] = (j / RADIAL) * 3;
        uv[k * 2 + 1] = (r / RING) * 0.6;
        const fold = f < 0.34 ? 0.62 + f * 1.1 : 1;
        const plate = 0.93 + 0.07 * Math.sin(j * 1.7 + Math.floor(r / RING) * 2.3);
        const v = fold * plate;
        col[k * 3] = v; col[k * 3 + 1] = v * 0.96; col[k * 3 + 2] = v * 0.9;
      }
    }
    const idx = [];
    for (let r = 0; r < rings - 1; r++) {
      for (let j = 0; j < RADIAL; j++) {
        const a = r * W + j, b = a + 1, c = a + W, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    this.body = new THREE.Mesh(g, S.hide);
    this.body.frustumCulled = false;
    this.body.castShadow = true;
    this.group.add(this.body);
    this.rings = rings;
    this.T = Array.from({ length: this.count + 1 }, () => new THREE.Vector3());
    this.N = Array.from({ length: this.count + 1 }, () => new THREE.Vector3());
  }

  setMouth(open) {
    const q = new THREE.Quaternion();
    for (const pt of this.petals) {
      q.setFromAxisAngle(pt.axis, open * 1.35);
      pt.pivot.quaternion.copy(q);
    }
    this.mouth = open;
  }

  // points[0] = head base, points[i] trailing; headDir = direction the mouth faces
  apply(headDir) {
    const pts = this.points, n = this.count;
    this.head.position.copy(pts[0]);
    this.head.quaternion.setFromUnitVectors(Y, headDir);

    // tangents toward the head, normals by parallel transport (no twisting along the body)
    const T = this.T, N = this.N;
    for (let i = 0; i <= n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n, i + 1)];
      T[i].subVectors(a, b).normalize();
    }
    T[0].copy(headDir);
    const ref = Math.abs(T[0].y) > 0.9 ? new THREE.Vector3(1, 0, 0) : Y;
    N[0].crossVectors(T[0], ref).normalize();
    for (let i = 1; i <= n; i++) N[i].copy(N[i - 1]).addScaledVector(T[i], -N[i - 1].dot(T[i])).normalize();

    const pos = this.body.geometry.attributes.position.array;
    const W = RADIAL + 1, R = this.radius;
    const P = new THREE.Vector3(), t = new THREE.Vector3(), nn = new THREE.Vector3(), b = new THREE.Vector3();
    for (let r = 0; r < this.rings; r++) {
      const i = Math.min(n - 1, Math.floor(r / RING)), f = r / RING - i;
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
      P.set(_cr(p0.x, p1.x, p2.x, p3.x, f), _cr(p0.y, p1.y, p2.y, p3.y, f), _cr(p0.z, p1.z, p2.z, p3.z, f));
      t.lerpVectors(T[i], T[i + 1], f).normalize();
      nn.lerpVectors(N[i], N[i + 1], f).normalize();
      b.crossVectors(t, nn);
      const s = r / RING;
      const rad = R * (1 - Math.pow(s / n, 2) * 0.55) * this.profile[r];
      for (let j = 0; j < W; j++) {
        const ang = (j / RADIAL) * Math.PI * 2;
        const ca = Math.cos(ang) * rad, sa = Math.sin(ang) * rad;
        const k = (r * W + j) * 3;
        pos[k] = P.x + nn.x * ca + b.x * sa;
        pos[k + 1] = P.y + nn.y * ca + b.y * sa;
        pos[k + 2] = P.z + nn.z * ca + b.z * sa;
      }
    }
    const g = this.body.geometry;
    g.attributes.position.needsUpdate = true;
    g.computeVertexNormals();
  }
}

// Worm that swims alongside the causeway, closing in when the runner stumbles.
export class ChaserWorm {
  constructor(scene, track) {
    this.track = track;
    this.model = new WormModel(36, 3.0, 2.6);
    scene.add(this.model.group);
    this.side = -1;
    this.offset = 10.5;
    this.time = 0;
    this._dir = new THREE.Vector3();
    this.headPos = new THREE.Vector3();
    this.closeness = 0;
    this.model.group.visible = false;
  }

  // gap: metres the worm is behind; 0 = level with the runner
  update(dt, playerDist, gap, visible) {
    this.time += dt;
    const close = 1 - smoothstep(4, 34, gap);
    this.closeness = close;
    const m = this.model;
    m.group.visible = visible && close > 0.02;
    if (!m.group.visible) return;
    const headDist = playerDist + 16 - gap * 1.3;
    const pts = m.points;
    const sink = (1 - close) * 7;
    for (let i = 0; i <= m.count; i++) {
      const d = headDist - i * m.segLen;
      this.track.sample(d, this.side * (this.offset + Math.sin(this.time * 0.8 + i * 0.2) * 1.2), pts[i]);
      const wave = Math.sin(this.time * 3.2 - i * 0.42);
      pts[i].y = BED - 3.6 + close * 1.3 + wave * 1.8 - sink - Math.max(0, i - 24) * 0.25;
    }
    pts[0].y = BED - 1.0 + close * 3.4 + Math.sin(this.time * 3.2) * 0.6 - sink;
    this._dir.subVectors(pts[0], pts[2]).normalize();
    this._dir.y += 0.15 + close * 0.35;
    this._dir.normalize();
    m.setMouth(0.25 + close * 0.55 + Math.sin(this.time * 6) * 0.1 * close);
    m.apply(this._dir);
    this.headPos.copy(pts[0]);
  }
}

// The ridden worm: surfaced beneath the rider, ploughing alongside the road.
// headDist is the path distance of the head; offset the lateral position.
ChaserWorm.prototype.ride = function ride(dt, headDist, offset) {
  this.time += dt;
  const m = this.model;
  m.group.visible = true;
  const pts = m.points;
  for (let i = 0; i <= m.count; i++) {
    const d = headDist - i * m.segLen;
    this.track.sample(d, offset + Math.sin(this.time * 0.9 + i * 0.22) * 0.5 * (i / m.count), pts[i]);
    pts[i].y = BED - 1.25 + Math.sin(this.time * 2.4 - i * 0.35) * 0.3 - Math.max(0, i - 18) * 0.4;
  }
  pts[0].y += 0.9;
  this._dir.subVectors(pts[0], pts[2]).normalize();
  this._dir.y += 0.12;
  this._dir.normalize();
  m.setMouth(0.4 + Math.sin(this.time * 3) * 0.12);
  m.apply(this._dir);
  this.headPos.copy(pts[0]);
  this.closeness = 0.4;
};

// Height of the worm's back under the rider (segment 3).
ChaserWorm.prototype.backHeight = function backHeight() {
  return this.model.points[3].y + this.model.radius * 0.97;
};

// Massive worm breaching far off in the dunes for spectacle.
export class BreachWorm {
  constructor(scene) {
    this.model = new WormModel(46, 7, 5.5);
    this.model.group.visible = false;
    scene.add(this.model.group);
    this.active = false;
    this.t = 0;
    this.origin = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this._hd = new THREE.Vector3();
  }

  start(origin, dir, height, duration = 7) {
    this.active = true;
    this.t = 0;
    this.origin.copy(origin);
    this.dir.copy(dir).normalize();
    this.height = height;
    this.duration = duration;
    this.length = height * 3.4;
    this.model.group.visible = true;
    this.emitted = [false, false];
  }

  curve(u, out) {
    out.copy(this.origin).addScaledVector(this.dir, u * this.length);
    out.y = this.origin.y + Math.sin(u * Math.PI) * this.height - (u < 0 || u > 1 ? Math.abs(u < 0 ? u : u - 1) * this.height * 2 : 0);
    return out;
  }

  // returns list of ground burst points to spawn particles at
  update(dt) {
    if (!this.active) return null;
    this.t += dt;
    const m = this.model;
    const headU = -0.1 + (this.t / this.duration) * 1.9;
    const step = m.segLen / this.length;
    for (let i = 0; i <= m.count; i++) this.curve(headU - i * step, m.points[i]);
    this.curve(headU + 0.01, this._hd).sub(m.points[0]).normalize();
    m.setMouth(0.45 + Math.sin(this.t * 2) * 0.15);
    m.apply(this._hd);
    if (this.t > this.duration) {
      this.active = false;
      m.group.visible = false;
    }
    const bursts = [];
    if (headU > 0 && !this.emitted[0]) { this.emitted[0] = true; bursts.push(this.curve(0, new THREE.Vector3())); }
    if (headU > 1 && !this.emitted[1]) { this.emitted[1] = true; bursts.push(this.curve(1, new THREE.Vector3())); }
    return bursts;
  }
}

// The death scene: a worm erupts from beneath the runner and swallows them.
export class DevourWorm {
  constructor(scene) {
    this.model = new WormModel(26, 4.2, 2.8);
    this.model.group.visible = false;
    scene.add(this.model.group);
    this.active = false;
    this.base = new THREE.Vector3();
    this.fwd = new THREE.Vector3();
    this._d = new THREE.Vector3();
  }

  start(pos, fwd) {
    this.active = true;
    this.t = 0;
    this.base.copy(pos);
    this.fwd.copy(fwd);
    this.model.group.visible = true;
  }

  stop() {
    this.active = false;
    this.model.group.visible = false;
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const t = this.t;
    const m = this.model;
    // rise (0-0.7s), hang & close (0.7-1.3s), topple forward into the sand (1.3s+)
    const rise = smoothstep(0, 0.7, t);
    const topple = smoothstep(1.2, 2.6, t);
    const headH = -14 + rise * 22 - topple * 18;
    const ang = topple * 2.2;
    const hd = this._d.set(0, Math.cos(ang), 0).addScaledVector(this.fwd, Math.sin(ang));
    m.points[0].copy(this.base).addScaledVector(this.fwd, topple * 10);
    m.points[0].y = this.base.y + headH;
    for (let i = 1; i <= m.count; i++) {
      const p = m.points[i];
      const prev = m.points[i - 1];
      p.copy(prev).addScaledVector(hd, -m.segLen);
      if (p.y < this.base.y - 2) {
        p.copy(prev);
        p.y -= m.segLen;
      }
    }
    m.setMouth(t < 0.9 ? 1 : Math.max(0, 1 - (t - 0.9) * 3));
    m.apply(hd);
  }
}
