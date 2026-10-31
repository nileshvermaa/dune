import * as THREE from 'three';
import { tex } from './props.js';
import { smoothstep } from './noise.js';

// Sandworm model: instanced ringed body segments + a head with a three-petal mouth
// and rings of crystal teeth. Used for the chaser, distant breaches and the death scene.

const Y = new THREE.Vector3(0, 1, 0);
let shared = null;

function paint(g, fn) {
  const p = g.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = fn(p.getX(i), p.getY(i), p.getZ(i));
    c[i * 3] = k; c[i * 3 + 1] = k * 0.96; c[i * 3 + 2] = k * 0.9;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
}

function getShared() {
  if (shared) return shared;
  const prof = [];
  const pts = [[0.9, -0.5], [0.97, -0.38], [1.0, -0.15], [1.01, 0.1], [0.98, 0.34], [0.9, 0.5]];
  for (const [r, y] of pts) prof.push(new THREE.Vector2(r, y));
  const segGeo = new THREE.LatheGeometry(prof, 28);
  paint(segGeo, (x, y, z) => {
    const groove = 1 - Math.min(1, Math.abs(Math.abs(y) - 0.5) * 6);
    const plate = 0.88 + 0.12 * Math.sin(Math.atan2(x, z) * 9 + y * 3);
    return (1 - groove * 0.5) * plate;
  });
  const bodyMat = new THREE.MeshStandardMaterial({
    color: '#c09a72', vertexColors: true, roughness: 0.78, metalness: 0.05,
    normalMap: tex.sand.normalMap, normalScale: new THREE.Vector2(1.2, 1.2),
  });
  const headProf = [[0.98, -1.0], [1.04, -0.3], [1.1, 0.4], [1.16, 0.85], [1.12, 0.92]].map(([r, y]) => new THREE.Vector2(r, y));
  const headGeo = new THREE.LatheGeometry(headProf, 32);
  paint(headGeo, (x, y) => 0.85 + 0.15 * Math.sin(y * 14));
  const petalGeos = [];
  for (let k = 0; k < 3; k++) {
    const g = new THREE.ConeGeometry(1.14, 1.7, 14, 3, true, (k * Math.PI * 2) / 3 + 0.03, (Math.PI * 2) / 3 - 0.06);
    g.translate(0, 0.85, 0);
    const m = (k * Math.PI * 2) / 3 + Math.PI / 3;
    g.translate(-Math.sin(m) * 1.14, 0, -Math.cos(m) * 1.14);
    petalGeos.push({ g, m });
  }
  const petalMat = new THREE.MeshStandardMaterial({ color: '#a07a56', emissive: '#3a1606', roughness: 0.8, side: THREE.DoubleSide });
  const throatMat = new THREE.MeshStandardMaterial({ color: '#1a0804', emissive: new THREE.Color(1.6, 0.45, 0.08), emissiveIntensity: 0.55, side: THREE.BackSide, roughness: 1 });
  const throatGeo = new THREE.CylinderGeometry(1.0, 0.45, 1.9, 22, 1, true);
  const toothGeo = new THREE.ConeGeometry(0.055, 0.42, 5);
  const toothMat = new THREE.MeshStandardMaterial({ color: '#efe6d4', emissive: '#40342a', roughness: 0.25, metalness: 0.1 });
  shared = { segGeo, bodyMat, headGeo, petalGeos, petalMat, throatMat, throatGeo, toothGeo, toothMat };
  return shared;
}

export class WormModel {
  constructor(count = 40, radius = 3.2, segLen = 2.6) {
    const S = getShared();
    this.count = count;
    this.radius = radius;
    this.segLen = segLen;
    this.group = new THREE.Group();
    this.body = new THREE.InstancedMesh(S.segGeo, S.bodyMat, count);
    this.body.frustumCulled = false;
    this.body.castShadow = true;
    this.group.add(this.body);

    this.head = new THREE.Group();
    this.headInner = new THREE.Group();
    this.headInner.scale.setScalar(radius);
    this.head.add(this.headInner);
    const hm = new THREE.Mesh(S.headGeo, S.bodyMat);
    hm.castShadow = true;
    this.headInner.add(hm);
    const throat = new THREE.Mesh(S.throatGeo, S.throatMat);
    throat.position.y = -0.05;
    this.headInner.add(throat);
    this.petals = [];
    for (const { g, m } of S.petalGeos) {
      const pivot = new THREE.Group();
      pivot.position.set(Math.sin(m) * 1.14, 0.9, Math.cos(m) * 1.14);
      const p = new THREE.Mesh(g, S.petalMat);
      p.castShadow = true;
      pivot.add(p);
      this.headInner.add(pivot);
      this.petals.push({ pivot, axis: new THREE.Vector3(Math.cos(m), 0, -Math.sin(m)) });
    }
    const rings = [[0.88, 0.95, 26], [0.62, 0.85, 22], [0.36, 0.72, 18], [0.1, 0.6, 14]];
    let total = 0;
    for (const r of rings) total += r[2];
    const teeth = new THREE.InstancedMesh(S.toothGeo, S.toothMat, total);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), dir = new THREE.Vector3();
    let i = 0;
    for (const [y, rad, n] of rings) {
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + y * 3;
        p.set(Math.sin(a) * rad, y, Math.cos(a) * rad);
        dir.set(-Math.sin(a), -0.55, -Math.cos(a)).normalize();
        q.setFromUnitVectors(Y, dir);
        sc.setScalar(0.8 + ((k * 7) % 5) * 0.12);
        mtx.compose(p, q, sc);
        teeth.setMatrixAt(i++, mtx);
      }
    }
    this.headInner.add(teeth);
    this.group.add(this.head);
    this.setMouth(0);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this.points = Array.from({ length: count + 1 }, () => new THREE.Vector3());
  }

  setMouth(open) {
    const q = new THREE.Quaternion();
    for (const pt of this.petals) {
      q.setFromAxisAngle(pt.axis, open * 1.45);
      pt.pivot.quaternion.copy(q);
    }
    this.mouth = open;
  }

  // points[0] = head base, points[i] trailing; headDir = direction the mouth faces
  apply(headDir) {
    const pts = this.points;
    this.head.position.copy(pts[0]);
    this.head.quaternion.setFromUnitVectors(Y, headDir);
    const r = this.radius;
    for (let i = 0; i < this.count; i++) {
      const a = pts[i], b = pts[i + 1];
      this._d.subVectors(a, b);
      const len = this._d.length() || 1;
      this._d.divideScalar(len);
      this._q.setFromUnitVectors(Y, this._d);
      this._p.addVectors(a, b).multiplyScalar(0.5);
      const taper = 1 - Math.pow(i / this.count, 2) * 0.55;
      this._s.set(r * taper, len * 1.18, r * taper);
      this._m.compose(this._p, this._q, this._s);
      this.body.setMatrixAt(i, this._m);
    }
    this.body.instanceMatrix.needsUpdate = true;
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
      pts[i].y = -3.6 + close * 1.3 + wave * 1.8 - sink - Math.max(0, i - 24) * 0.25;
    }
    pts[0].y = -1.0 + close * 3.4 + Math.sin(this.time * 3.2) * 0.6 - sink;
    this._dir.subVectors(pts[0], pts[2]).normalize();
    this._dir.y += 0.15 + close * 0.35;
    this._dir.normalize();
    m.setMouth(0.25 + close * 0.55 + Math.sin(this.time * 6) * 0.1 * close);
    m.apply(this._dir);
    this.headPos.copy(pts[0]);
  }
}

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
