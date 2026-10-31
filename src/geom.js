import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Geometry toolkit: radial surfaces for formations/columns, tapered limbs, and a
// part-merger that bakes per-part colours so a whole prop is a single draw call.

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

export function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _q.setFromEuler(_e.set(rx, ry, rz));
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
}

export function rbox(w, h, d, r = 0.04, seg = 1) {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
}

// Closed radial surface. radius(theta, t) and height(theta, t) with t in [0,1] bottom->top.
export function radialSurface({ seg = 32, rings = 24, radius, height, color, capTop = true, capBottom = false }) {
  const pos = [];
  const col = [];
  const c = new THREE.Color();
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    for (let i = 0; i < seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      const r = radius(th, t);
      const y = height(th, t);
      const x = Math.sin(th) * r, z = Math.cos(th) * r;
      pos.push(x, y, z);
      color(th, t, x, y, z, c);
      col.push(c.r, c.g, c.b);
    }
  }
  const idx = [];
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * seg + i, b = j * seg + ((i + 1) % seg), cc = a + seg, d = b + seg;
      idx.push(a, b, cc, b, d, cc);
    }
  }
  const addCap = (ring, up) => {
    const t = up ? 1 : 0;
    let y = 0;
    for (let i = 0; i < seg; i++) y += pos[(ring * seg + i) * 3 + 1];
    y /= seg;
    const center = pos.length / 3;
    pos.push(0, y + (up ? 0.002 : 0), 0);
    color(0, t, 0, y, 0, c);
    col.push(c.r, c.g, c.b);
    for (let i = 0; i < seg; i++) {
      const a = ring * seg + i, b = ring * seg + ((i + 1) % seg);
      if (up) idx.push(a, b, center); else idx.push(b, a, center);
    }
  };
  if (capTop) addCap(rings, true);
  if (capBottom) addCap(0, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Tapered limb with rounded ends; top of the limb sits at y=0 and it hangs down.
export function limb(r0, r1, len, bulge = 0, seg = 12) {
  const pts = [];
  for (let i = 0; i <= 4; i++) {
    const a = (i / 4) * Math.PI / 2;
    pts.push(new THREE.Vector2(Math.max(0.0001, r0 * Math.sin(a)), r0 * Math.cos(a)));
  }
  for (let i = 1; i < 8; i++) {
    const t = i / 8;
    pts.push(new THREE.Vector2(r0 + (r1 - r0) * t + bulge * Math.sin(Math.PI * Math.pow(t, 0.8)), -len * t));
  }
  for (let i = 0; i <= 4; i++) {
    const a = (i / 4) * Math.PI / 2;
    pts.push(new THREE.Vector2(Math.max(0.0001, r1 * Math.cos(a)), -len - r1 * Math.sin(a)));
  }
  return new THREE.LatheGeometry(pts.reverse(), seg);
}

export function lathe(profile, seg = 24) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
}

function prep(geo, color, matrix) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (matrix) g.applyMatrix4(matrix);
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.color) {
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    const c = color instanceof THREE.Color ? color : new THREE.Color(color ?? 0xffffff);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  } else if (color) {
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    const a = g.attributes.color;
    for (let i = 0; i < a.count; i++) a.setXYZ(i, a.getX(i) * c.r, a.getY(i) * c.g, a.getZ(i) * c.b);
  }
  g.morphAttributes = {};
  return g;
}

// parts: [[geometry, color, matrix], ...]
export function merge(parts) {
  const geos = parts.map(([g, c, m]) => prep(g, c, m));
  const out = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  out.computeBoundingSphere();
  return out;
}

// Multiply vertex colours by fn(x, y, z, nx, ny, nz) — used to bake ambient occlusion and grime.
export function shade(geo, fn) {
  const p = geo.attributes.position, n = geo.attributes.normal, c = geo.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const k = fn(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i));
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  c.needsUpdate = true;
  return geo;
}

// Displace by a smooth vector field (same input position -> same offset, so no cracks).
export function displace(geo, fn) {
  const p = geo.attributes.position;
  const o = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    fn(p.getX(i), p.getY(i), p.getZ(i), o.set(0, 0, 0));
    p.setXYZ(i, p.getX(i) + o.x, p.getY(i) + o.y, p.getZ(i) + o.z);
  }
  geo.computeVertexNormals();
  return geo;
}

export const col = (hex) => new THREE.Color(hex);
