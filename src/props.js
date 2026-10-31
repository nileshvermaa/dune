import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise3D, fbm3, mulberry32, smoothstep } from './noise.js';
import { createSandTextures, createStoneTextures, createGlowTexture, createArrowTexture } from './textures.js';
import { detailed } from './materials.js';
import { M, rbox, radialSurface, lathe, merge, shade, displace, col } from './geom.js';

// Props are built as single merged meshes with baked vertex colours (strata, grime, AO)
// and rendered with world-space stone detail. Geometry is cached per variant.

export const tex = {};
export const mats = {};
const cache = new Map();
const N3 = createNoise3D(4242);

function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}
export function geo(name) { return cache.get(name); }

const C = {
  cream: col('#ecd6b2'), light: col('#d8b287'), mid: col('#bd8d5d'), dark: col('#8c5c3a'),
  red: col('#a9583a'), rust: col('#9b4f2c'), ochre: col('#c98e4e'), sand: col('#e2bd8c'),
  bone: col('#ebe1ce'), boneDark: col('#a8977c'), metal: col('#7a6a5a'), metalDark: col('#3a332e'),
  hazard: col('#d9a531'), black: col('#1e1a17'), brass: col('#c49a55'), white: col('#ffffff'),
};

export function initProps() {
  Object.assign(tex, {
    sand: createSandTextures(512),
    stone: createStoneTextures(512),
    glow: createGlowTexture(128),
    arrow: createArrowTexture(256),
  });

  mats.stoneV = detailed(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 }), { scale: 0.3, strength: 0.08, bump: 0.1, photo: { set: 'sandstone', scale: 0.4, mix: 0.9, chroma: 0.3, bump: 1.6 } });
  mats.rock = detailed(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94 }), { scale: 0.12, strength: 0.2, bump: 0.3, photo: { set: 'rock', scale: 0.1, mix: 0.9, chroma: 0, bump: 1.8 } });
  mats.tile = detailed(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 }), { scale: 0.3, strength: 0.1, bump: 0.15, photo: { set: 'sandstone', scale: 0.45, mix: 0.8, chroma: 0.25, bump: 1.4 } });
  mats.wall = detailed(new THREE.MeshStandardMaterial({ map: tex.stone.map, normalMap: tex.stone.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.9, color: '#e8cfae' }), { scale: 0.3, strength: 0.12, bump: 0.2, photo: { set: 'sandstone', scale: 0.45, mix: 0.6, chroma: 0.2, bump: 1.0 } });
  mats.mortar = new THREE.MeshStandardMaterial({ color: '#7a5a3a', roughness: 1 });
  mats.sandPile = detailed(new THREE.MeshStandardMaterial({ color: '#c9935f', roughness: 1, metalness: 0 }), { scale: 0.9, strength: 0.25, bump: 0.6, sparkle: 1.0, photo: { set: 'sand', scale: 0.3, mix: 0.8, chroma: 0.4, bump: 1.2 } });
  mats.boneV = detailed(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.02 }), { scale: 1.0, strength: 0.12, bump: 0.2 });
  mats.metalV = detailed(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.7 }), { scale: 0.8, strength: 0.15, bump: 0.12 });
  mats.glass = new THREE.MeshPhysicalMaterial({ color: '#16222e', roughness: 0.05, metalness: 0.2, clearcoat: 1, emissive: '#0b2233', emissiveIntensity: 0.5 });
  mats.wing = new THREE.MeshStandardMaterial({ color: '#d8c8ae', roughness: 0.35, metalness: 0.4, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
  mats.spiceGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.8, 0.1) });
  mats.globe = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.2, 1.1) });
  mats.ibadGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.2, 4.0) });
  mats.dark = new THREE.MeshBasicMaterial({ color: '#120904' });
  mats.vent = new THREE.MeshStandardMaterial({ color: '#2a1408', emissive: '#ff5a10', emissiveIntensity: 0.4, roughness: 1 });
  mats.eruption = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 1.1, 0.25), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  mats.arrow = new THREE.MeshBasicMaterial({ map: tex.arrow, color: new THREE.Color(2.4, 1.1, 0.35), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  mats.spicePatch = new THREE.MeshBasicMaterial({ map: tex.glow, color: new THREE.Color(1.6, 0.55, 0.12), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });

  mats.halo = new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color(1.0, 0.75, 0.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 });
  mats.spiceHalo = new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color(1.0, 0.45, 0.1), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 });
  mats.shieldHalo = new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color(0.3, 0.6, 1.0), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  mats.tranceHalo = new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color(0.55, 0.35, 1.0), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  mats.thopterHalo = new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color(1.0, 0.85, 0.3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  mats.waterGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 1.3, 3.2) });
  mats.waterHalo = new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color(0.3, 0.7, 1.0), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 });
  mats.plume = new THREE.SpriteMaterial({ map: tex.glow, color: '#a07850', transparent: true, opacity: 0.35, depthWrite: false });

  mats.shieldPU = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.4, 3.2), wireframe: true });
  mats.trancePU = new THREE.MeshStandardMaterial({ color: '#4a3cff', emissive: new THREE.Color(0.5, 0.3, 2.0), roughness: 0.2, metalness: 0.3 });
  mats.thopterPU = new THREE.MeshStandardMaterial({ vertexColors: true, color: '#ffd27a', emissive: '#5a3500', roughness: 0.3, metalness: 0.9 });
  mats.hookProp = new THREE.MeshStandardMaterial({ vertexColors: true, color: '#e8c48a', roughness: 0.35, metalness: 0.85 });
  mats.silencePU = new THREE.MeshStandardMaterial({ color: '#f1e6cc', emissive: new THREE.Color(0.9, 0.82, 0.6), emissiveIntensity: 0.6, roughness: 0.6 });
  mats.sealPU = new THREE.MeshStandardMaterial({ color: '#2a8c8c', emissive: new THREE.Color(0.1, 1.1, 1.0), emissiveIntensity: 0.7, roughness: 0.3, metalness: 0.4 });
  mats.rushPU = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 0.9, 0.15) });
  mats.silenceHalo = new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color(1.0, 0.92, 0.75), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7 });
  mats.sealHalo = new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color(0.2, 1.0, 0.9), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 });
  mats.rushHalo = new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color(1.0, 0.4, 0.08), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 });
  // sinkhole: unlit, dark at the throat, fading into the sand at the rim (alpha in vertex colours)
  mats.sinkhole = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  // dust devil: translucent spinning shells of sand
  mats.devil = new THREE.MeshBasicMaterial({ map: tex.sand.map, color: '#d6ab7c', transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false });

  mats.stone = mats.wall;
  mats.stoneDark = mats.wall;

  cache.set('spiceCore', (() => {
    const core = new THREE.OctahedronGeometry(0.27, 0);
    core.scale(0.75, 1.3, 0.75);
    const ring = new THREE.TorusGeometry(0.4, 0.022, 5, 28);
    ring.rotateX(Math.PI / 2 - 0.35);
    const g = merge([[core, null, null], [ring, null, null], [new THREE.OctahedronGeometry(0.06, 0), null, M(0.4, 0.14, 0)], [new THREE.OctahedronGeometry(0.06, 0), null, M(-0.4, -0.14, 0)]]);
    g.deleteAttribute('color');
    return g;
  })());
  cache.set('box', new THREE.BoxGeometry(1, 1, 1));
  cache.set('globe', new THREE.SphereGeometry(0.2, 16, 12));
  cache.set('block', rbox(1, 1, 1, 0.07, 1));
  cache.set('sandPile', new THREE.SphereGeometry(1, 18, 6, 0, Math.PI * 2, 0, Math.PI / 2));
}

const lerpC = (a, b, t) => a.clone().lerp(b, t);
const vary = (c, rnd, k = 0.08) => c.clone().multiplyScalar(1 - k + rnd() * k * 2);

/* ================= Rock formations ================= */

function strataPalette(rnd) {
  const pool = [C.cream, C.light, C.mid, C.ochre, C.red, C.dark, C.light, C.mid];
  return Array.from({ length: 9 }, () => vary(pool[Math.floor(rnd() * pool.length)], rnd, 0.06));
}

function bandColor(bands, y, out) {
  const f = ((((y % 1) + 1) % 1)) * bands.length;
  const i = Math.floor(f), t = smoothstep(0.75, 1, f - i);
  return out.copy(bands[i % bands.length]).lerp(bands[(i + 1) % bands.length], t);
}

function buildMesa(seed) {
  const rnd = mulberry32(seed);
  const bands = strataPalette(rnd);
  const o = rnd() * 50;
  const ledges = [0.42 + rnd() * 0.1, 0.68 + rnd() * 0.1, 0.88];
  const noiseAt = (th, t) => fbm3(N3, Math.sin(th) * 1.4 + o, t * 3.2, Math.cos(th) * 1.4, 4);
  return radialSurface({
    seg: 56, rings: 36,
    radius: (th, t) => {
      let p = t < 0.16 ? 1.38 - 0.38 * smoothstep(0, 0.16, t) : 1;
      for (const l of ledges) p -= 0.055 * smoothstep(l - 0.01, l + 0.01, t);
      if (t > 0.985) p *= 0.94;
      const e = noiseAt(th, t);
      const gully = Math.pow(Math.abs(Math.sin(th * 6 + N3(t * 2 + o, th, 1) * 2.5)), 8) * 0.09 * smoothstep(0.15, 0.3, t);
      return p * (1 + e * 0.3 - gully);
    },
    height: (th, t) => (t >= 1 ? 1 + N3(Math.sin(th) * 3, o, Math.cos(th) * 3) * 0.015 : t),
    color: (th, t, x, y, z, c) => {
      const e = noiseAt(th, t);
      bandColor(bands, t * 6 + e * 0.6, c);
      if (t < 0.16) c.lerp(C.sand, 1 - smoothstep(0.02, 0.16, t) * 0.5);
      if (t > 0.97) c.lerp(C.sand, 0.55);
      c.multiplyScalar(0.82 + 0.25 * (e * 0.5 + 0.5));
    },
  });
}

function buildSpire(seed) {
  const rnd = mulberry32(seed);
  const bands = strataPalette(rnd);
  const o = rnd() * 50;
  const neck = 0.55 + rnd() * 0.15;
  return radialSurface({
    seg: 36, rings: 30,
    radius: (th, t) => {
      let p = 1 - t * 0.55;
      p -= 0.25 * Math.exp(-(((t - neck) / 0.12) ** 2));
      p += 0.22 * Math.exp(-(((t - (neck + 0.18)) / 0.07) ** 2));
      if (t > 0.92) p *= 1 - (t - 0.92) * 5;
      const e = fbm3(N3, Math.sin(th) * 1.3 + o, t * 4, Math.cos(th) * 1.3, 4);
      return Math.max(0.02, p * (1 + e * 0.32));
    },
    height: (th, t) => t,
    color: (th, t, x, y, z, c) => {
      bandColor(bands, t * 5 + N3(x * 2, t * 3, z * 2) * 0.4, c);
      if (t < 0.1) c.lerp(C.sand, 0.5);
      c.multiplyScalar(0.85 + 0.2 * (N3(x * 4 + o, y * 4, z * 4) * 0.5 + 0.5));
    },
  });
}

function buildBoulder(seed) {
  const rnd = mulberry32(seed);
  const pool = [C.mid, C.ochre, C.red, C.dark, C.light];
  const bands = Array.from({ length: 7 }, () => vary(pool[Math.floor(rnd() * pool.length)], rnd, 0.06));
  const o = rnd() * 50;
  const steps = 3 + Math.floor(rnd() * 3);
  let g = new THREE.IcosahedronGeometry(1, 4);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // push the sphere toward a weathered block
    const m = Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
    v.multiplyScalar(Math.pow(1 / m, 0.55));
    const e = fbm3(N3, v.x * 0.9 + o, v.y * 0.9, v.z * 0.9, 4);
    const fine = N3(v.x * 4 + o, v.y * 4, v.z * 4);
    v.multiplyScalar(0.8 + e * 0.38 + fine * 0.04);
    // strata ledges and an undercut at the base
    const ty = (v.y + 1) * steps * 0.5;
    const frac = ty - Math.floor(ty);
    const ledge = smoothstep(0.82, 1, frac);
    v.x *= 1 - ledge * 0.07; v.z *= 1 - ledge * 0.07;
    if (v.y < -0.35) { const k = 0.82 + (v.y + 0.35) * 0.4; v.x *= k; v.z *= k; v.y = -0.35 + (v.y + 0.35) * 0.3; }
    if (v.y > 0.6) v.y = 0.6 + (v.y - 0.6) * 0.45;
    p.setXYZ(i, v.x, v.y, v.z);
    bandColor(bands, v.y * 1.3 + e * 0.25, c);
    c.multiplyScalar((0.78 + 0.3 * (e * 0.5 + 0.5)) * (1 - ledge * 0.25));
    if (v.y > 0.5) c.lerp(C.sand, 0.25);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

export function rockGeometry(kind, variant = 0) {
  const v = variant % 4;
  return cached(`rock-${kind}-${v}`, () => {
    const seed = 1000 + v * 77 + kind.length * 13;
    return kind === 'mesa' ? buildMesa(seed) : kind === 'spire' ? buildSpire(seed) : buildBoulder(seed);
  });
}

export function makeRock(kind, variant, sx, sy, sz) {
  const m = new THREE.Mesh(rockGeometry(kind, variant), mats.rock);
  m.scale.set(sx, sy, sz);
  return m;
}

/* ================= Carved stone ================= */

function blockColor(rnd, base = C.light) {
  return vary(lerpC(base, rnd() < 0.5 ? C.mid : C.cream, rnd() * 0.4), rnd, 0.07);
}

function grime(g, y0, y1, amount = 0.35) {
  return shade(g, (x, y, z, nx, ny) => {
    const low = 1 - smoothstep(y0, y1, y);
    const up = ny > 0.6 ? 1.06 : 1;
    return (1 - low * amount) * up;
  });
}

function chipped(g, amp, freq, seed) {
  const n = createNoise3D(seed);
  const src = g.clone();
  src.deleteAttribute('uv');
  src.deleteAttribute('normal');
  const m = mergeVertices(src);
  return displace(m, (x, y, z, o) => o.set(n(x * freq, y * freq, z * freq), n(y * freq + 9, z * freq, x * freq) * 0.6, n(z * freq - 5, x * freq, y * freq)).multiplyScalar(amp));
}

function buildColumn(height, broken, seed) {
  const rnd = mulberry32(seed);
  const n = createNoise3D(seed);
  const shaftTop = broken ? height * (0.55 + rnd() * 0.3) : height - 0.85;
  const parts = [
    [rbox(1.75, 0.5, 1.75, 0.06), blockColor(rnd, C.mid), M(0, 0.25, 0)],
    [lathe([[0, 0.5], [0.84, 0.5], [0.86, 0.58], [0.78, 0.66], [0.72, 0.7], [0.76, 0.76], [0.68, 0.82], [0, 0.82]], 32), blockColor(rnd), null],
  ];
  const shaft = radialSurface({
    seg: 48, rings: 18, capTop: true,
    radius: (th, t) => {
      const flute = Math.pow(0.5 + 0.5 * Math.cos(th * 20), 2);
      const r = (0.64 - 0.09 * t + 0.03 * Math.sin(Math.PI * t)) * (1 - 0.05 * flute);
      return r * (1 + n(Math.sin(th) * 3, t * 6, Math.cos(th) * 3) * 0.035);
    },
    height: (th, t) => {
      let y = 0.82 + t * (shaftTop - 0.82);
      if (broken && t === 1) y -= 0.15 + Math.abs(n(Math.sin(th) * 2.5, 3, Math.cos(th) * 2.5)) * 0.9;
      return y;
    },
    color: (th, t, x, y, z, c) => {
      const flute = Math.pow(0.5 + 0.5 * Math.cos(th * 20), 2);
      c.copy(C.light).lerp(C.cream, 0.3).multiplyScalar(1 - flute * 0.16);
      c.lerp(C.red, (1 - smoothstep(0, 0.25, t)) * 0.3);
      for (const k of [0.33, 0.66]) if (Math.abs(t - k) < 0.03) c.multiplyScalar(0.75);
      c.multiplyScalar(0.9 + n(x * 5, y * 5, z * 5) * 0.12);
    },
  });
  parts.push([shaft, null, null]);
  if (!broken) {
    parts.push([lathe([[0, 0], [0.56, 0], [0.6, 0.1], [0.78, 0.3], [0.84, 0.38], [0, 0.38]], 32), blockColor(rnd), M(0, shaftTop, 0)]);
    parts.push([rbox(1.85, 0.42, 1.85, 0.05), blockColor(rnd, C.mid), M(0, shaftTop + 0.6, 0)]);
  } else {
    for (let i = 0; i < 3; i++) {
      const s = 0.25 + rnd() * 0.35;
      parts.push([rbox(s, s * 0.7, s * 0.9, 0.05), blockColor(rnd), M((rnd() - 0.5) * 1.6, 0.6, (rnd() - 0.5) * 1.6, rnd(), rnd(), rnd())]);
    }
  }
  return grime(merge(parts), 0, 1.8, 0.3);
}

export function makeColumn(height = 6, broken = false) {
  const h = Math.max(3, Math.round(height));
  const v = Math.random() < 0.5 ? 0 : 1;
  return new THREE.Mesh(cached(`col-${h}-${broken}-${v}`, () => buildColumn(h, broken, h * 31 + (broken ? 7 : 0) + v * 101)), mats.stoneV);
}

function buildBigArch(span, height) {
  const rnd = mulberry32(span * 7 + height);
  const R = span / 2;
  const springY = height - R - 1;
  const parts = [];
  for (const side of [-1, 1]) {
    let y = -3;
    while (y < springY - 0.05) {
      const h = Math.min(0.9 + rnd() * 0.6, springY - y);
      parts.push([rbox(2.1 + rnd() * 0.15, h - 0.04, 2.2 + rnd() * 0.15, 0.06), blockColor(rnd), M(side * (R + 1.05), y + h / 2, 0)]);
      y += h;
    }
    parts.push([rbox(2.6, 0.45, 2.6, 0.05), blockColor(rnd, C.mid), M(side * (R + 1.05), springY + 0.22, 0)]);
  }
  const nV = 17;
  for (let i = 0; i < nV; i++) {
    const a = (Math.PI * (i + 0.5)) / nV;
    const key = i === (nV - 1) / 2;
    const radial = key ? 2.3 : 1.7;
    const tang = (Math.PI * (R + 0.85)) / nV - 0.05;
    const cx = -Math.cos(a) * (R + radial / 2), cy = springY + 0.45 + Math.sin(a) * (R + radial / 2);
    parts.push([rbox(radial, tang, key ? 2.5 : 2.2, 0.05), key ? blockColor(rnd, C.cream) : blockColor(rnd), M(cx, cy, 0, 0, 0, a)]);
  }
  const topY = springY + 0.45 + R + 2.6;
  parts.push([rbox(span + 5.2, 1.3, 2.3, 0.06), blockColor(rnd), M(0, topY, 0)]);
  parts.push([rbox(span + 5.0, 0.35, 2.45, 0.04), blockColor(rnd, C.mid), M(0, topY - 0.35, 0)]);
  parts.push([rbox(span + 5.8, 0.38, 2.7, 0.05), blockColor(rnd, C.cream), M(0, topY + 0.82, 0)]);
  for (const side of [-1, 1]) {
    parts.push([rbox(R * 0.9, R * 0.75, 2.1, 0.05), blockColor(rnd), M(side * (R * 0.78 + 0.9), topY - 1.1 - R * 0.3, -0.02)]);
  }
  parts.push([rbox(4.2, 1.7, 2.5, 0.08), blockColor(rnd, C.mid), M(0, topY + 1.85, 0)]);
  return grime(merge(parts), -3, 2, 0.4);
}

export function makeBigArch(span = 15, height = 10) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(cached(`arch-${span}-${height}`, () => buildBigArch(span, height)), mats.stoneV);
  m.castShadow = true;
  g.add(m);
  const R = span / 2;
  const glyph = new THREE.Mesh(geo('globe'), mats.ibadGlow);
  glyph.position.set(0, height - R - 1 + 0.45 + R + 4.45, -1.3);
  glyph.scale.setScalar(2.2);
  g.add(glyph);
  return g;
}

function buildLintel() {
  const rnd = mulberry32(5);
  const parts = [];
  for (const side of [-1, 1]) {
    let y = -2.9;
    while (y < 1.2) {
      const h = Math.min(0.7 + rnd() * 0.5, 1.2 - y);
      parts.push([rbox(1.05, h - 0.04, 1.45, 0.06), blockColor(rnd), M(side * 4.62, y + h / 2, 0)]);
      y += h;
    }
  }
  parts.push([rbox(10.6, 0.72, 1.35, 0.06), blockColor(rnd, C.light), M(0, 1.56, 0)]);
  for (let i = -4; i <= 4; i += 2) {
    for (const z of [-0.7, 0.7]) {
      parts.push([new THREE.CylinderGeometry(0.22, 0.26, 0.08, 12), blockColor(rnd, C.cream), M(i, 1.56, z, Math.PI / 2, 0, 0)]);
    }
  }
  parts.push([rbox(11.2, 0.32, 1.65, 0.04), blockColor(rnd, C.mid), M(0, 2.08, 0)]);
  parts.push([rbox(3, 0.6, 1.4, 0.05), blockColor(rnd, C.cream), M(0, 2.5, 0)]);
  return grime(merge(parts), -2.9, 0.5, 0.35);
}

function buildGantry() {
  const parts = [];
  for (const side of [-1, 1]) {
    parts.push([rbox(0.7, 4.4, 0.7, 0.04), C.metalDark, M(side * 4.62, -0.7, 0)]);
    for (let y = -2.4; y < 1; y += 0.9) parts.push([rbox(0.08, 1.1, 0.08, 0.01), C.metal, M(side * 4.62, y, 0.4, 0, 0, side * 0.6)]);
  }
  parts.push([rbox(10.4, 0.16, 1.2, 0.02), C.metal, M(0, 1.3, 0)]);
  parts.push([rbox(10.4, 0.16, 1.2, 0.02), C.metal, M(0, 1.86, 0)]);
  parts.push([rbox(10.4, 0.5, 0.12, 0.02), C.metalDark, M(0, 1.58, 0)]);
  for (let i = 0; i < 12; i++) {
    parts.push([rbox(0.42, 0.42, 0.14, 0.01), i % 2 ? C.black : C.hazard, M(-4.6 + i * 0.84, 1.58, -0.62, 0, 0, Math.PI / 4)]);
  }
  return merge(parts);
}

export function makeLintel(metal = false) {
  if (metal) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(cached('gantry', buildGantry), mats.metalV));
    for (const sx of [-3, -1, 1, 3]) {
      const l = new THREE.Mesh(geo('globe'), mats.spiceGlow);
      l.position.set(sx, 1.18, -0.6);
      l.scale.setScalar(0.45);
      g.add(l);
    }
    return g;
  }
  return new THREE.Mesh(cached('lintel', buildLintel), mats.stoneV);
}

function buildRubble(seed) {
  const rnd = mulberry32(seed);
  const parts = [];
  let x = -3.95;
  while (x < 3.9) {
    const w = Math.min(0.85 + rnd() * 0.9, 3.98 - x);
    const h = 0.72 + rnd() * 0.24;
    const d = 0.8 + rnd() * 0.3;
    const b = chipped(rbox(w * 0.95, h, d, 0.08, 2), 0.05, 2.2, seed + parts.length);
    parts.push([b, blockColor(rnd), M(x + w / 2, h / 2, (rnd() - 0.5) * 0.25, 0, (rnd() - 0.5) * 0.15, (rnd() - 0.5) * 0.05)]);
    if (rnd() < 0.4) {
      const s = 0.25 + rnd() * 0.25;
      parts.push([chipped(rbox(s, s * 0.8, s, 0.05, 1), 0.03, 4, seed + 50 + parts.length), blockColor(rnd), M(x + w / 2, s * 0.4, (rnd() < 0.5 ? -1 : 1) * 0.65, rnd(), rnd(), rnd())]);
    }
    x += w;
  }
  return grime(merge(parts), 0, 0.5, 0.3);
}

export function makeRubbleWall(rnd) {
  const v = Math.floor(rnd() * 4);
  return new THREE.Mesh(cached(`rubble-${v}`, () => buildRubble(300 + v * 17)), mats.stoneV);
}

// Broken stretch of coursed masonry with arched window openings and a ragged top.
function buildRuinWall(seed) {
  const rnd = mulberry32(seed);
  const n = createNoise3D(seed);
  const len = 12 + rnd() * 6, hMax = 6.5 + rnd() * 3, depth = 1.4, course = 0.82;
  const nWin = 2 + Math.floor(rnd() * 2);
  const winW = 1.7, winBottom = 1.6, winTop = 3.9;
  const winX = Array.from({ length: nWin }, (_, i) => -len / 2 + ((i + 0.5) * len) / nWin);
  const parts = [];
  let row = 0;
  for (let y = -1.6; y < hMax; y += course, row++) {
    let x = -len / 2;
    let first = true;
    while (x < len / 2 - 0.05) {
      let w = first && row % 2 ? 0.7 : 1.15 + rnd() * 0.8;
      first = false;
      w = Math.min(w, len / 2 - x);
      const cx = x + w / 2, cy = y + course / 2;
      x += w;
      const edge = Math.abs(cx / (len / 2));
      const top = hMax * (0.42 + 0.58 * (0.5 + 0.5 * n(cx * 0.16, 0.3, 1.7))) * (1 - 0.4 * edge * edge);
      if (cy > top) continue;
      const open = winX.some((wx) => {
        const dx = Math.abs(cx - wx);
        if (dx > winW / 2 || cy < winBottom) return false;
        return cy < winTop + Math.sqrt(Math.max(0, (winW / 2) ** 2 - dx * dx));
      });
      if (open) continue;
      parts.push([rbox(w - 0.05, course - 0.05, depth + (rnd() - 0.5) * 0.14, 0.06), blockColor(rnd), M(cx, cy, (rnd() - 0.5) * 0.08, 0, (rnd() - 0.5) * 0.03, 0)]);
    }
  }
  for (const wx of winX) parts.push([rbox(winW + 0.5, 0.22, depth + 0.2, 0.04), blockColor(rnd, C.mid), M(wx, winBottom - 0.11, 0)]);
  for (let i = 0; i < 12; i++) {
    const s = 0.35 + rnd() * 0.8;
    parts.push([rbox(s, s * 0.6, s * 0.85, 0.06), blockColor(rnd), M((rnd() - 0.5) * len * 1.1, -0.15 + rnd() * 0.3, (rnd() < 0.5 ? -1 : 1) * (1 + rnd() * 1.8), rnd(), rnd(), rnd())]);
  }
  return grime(merge(parts), -1.6, 1.4, 0.42);
}

export function makeRuinWall(rnd) {
  const v = Math.floor(rnd() * 4);
  const m = new THREE.Mesh(cached(`ruinwall-${v}`, () => buildRuinWall(500 + v * 23)), mats.stoneV);
  m.castShadow = true;
  return m;
}

// Tall tapering watchtower, crumbling at the crown: reads as a silhouette on the skyline.
function buildRuinTower(seed) {
  const rnd = mulberry32(seed);
  const W = 7 + rnd() * 2, H = 30 + rnd() * 14, course = 1.6, th = 1.1;
  const parts = [];
  const rows = Math.floor(H / course);
  for (let r = 0; r < rows; r++) {
    const t = r / rows;
    const w = W * (1 - 0.28 * t);
    const y = -3 + r * course + course / 2;
    const crown = t > 0.82;
    const band = r % 6 === 5;
    const ww = band ? w + 0.5 : w;
    const slit = r % 4 === 2 && !band && t < 0.85;
    for (let face = 0; face < 4; face++) {
      if (crown && rnd() < (t - 0.82) * 4.5) continue;
      const ry = (face * Math.PI) / 2;
      const off = ww / 2 - th / 2;
      const ox = Math.sin(ry) * off, oz = Math.cos(ry) * off;
      const c = blockColor(rnd, band ? C.mid : C.light);
      if (slit) {
        const half = (ww - 0.9) / 2;
        for (const sd of [-1, 1]) {
          const lx = sd * (0.45 + half / 2);
          parts.push([rbox(half, course - 0.06, th, 0.06), c, M(ox + Math.cos(ry) * lx, y, oz - Math.sin(ry) * lx, 0, ry, 0)]);
        }
      } else {
        parts.push([rbox(ww, course - 0.06, th, 0.06), c, M(ox, y, oz, 0, ry, 0)]);
      }
    }
  }
  return grime(merge(parts), -3, 4, 0.45);
}

export function makeRuinTower(rnd) {
  const v = Math.floor(rnd() * 3);
  const m = new THREE.Mesh(cached(`ruintower-${v}`, () => buildRuinTower(700 + v * 41)), mats.stoneV);
  return m;
}

// A dark slab of unknown age, half-swallowed by the dunes.
function buildMonolith(seed) {
  const g = merge([[rbox(4.2, 22, 1.7, 0.2, 4), col('#2e2018'), null]]);
  return shade(chipped(g, 0.16, 0.32, seed), (x, y, z, nx, ny) => (ny > 0.5 ? 1.25 : 1) * (0.9 + 0.1 * Math.sin(y * 0.7)));
}

export function makeMonolith() {
  return new THREE.Mesh(cached('monolith', () => buildMonolith(913)), mats.rock);
}

function buildPipe() {
  const parts = [];
  parts.push([new THREE.CylinderGeometry(0.42, 0.42, 9.2, 20), C.rust, M(0, 0.55, 0, 0, 0, Math.PI / 2)]);
  for (const sx of [-4.4, -1.5, 1.5, 4.4]) {
    parts.push([new THREE.CylinderGeometry(0.54, 0.54, 0.16, 20), C.metal, M(sx, 0.55, 0, 0, 0, Math.PI / 2)]);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      parts.push([new THREE.CylinderGeometry(0.035, 0.035, 0.24, 6), C.metalDark, M(sx, 0.55 + Math.sin(a) * 0.47, Math.cos(a) * 0.47, 0, 0, Math.PI / 2)]);
    }
  }
  for (const sx of [-3, 0, 3]) {
    parts.push([rbox(0.18, 0.5, 0.9, 0.02), C.metalDark, M(sx, 0.25, 0)]);
    parts.push([rbox(0.5, 0.06, 1.1, 0.02), C.metalDark, M(sx, 0.03, 0)]);
    parts.push([new THREE.TorusGeometry(0.46, 0.05, 6, 20, Math.PI), C.metalDark, M(sx, 0.55, 0, 0, Math.PI / 2, Math.PI)]);
  }
  for (const sx of [-3.9, 3.9]) {
    for (let k = 0; k < 4; k++) parts.push([new THREE.CylinderGeometry(0.43, 0.43, 0.12, 20), k % 2 ? C.black : C.hazard, M(sx + (k - 1.5) * 0.12, 0.55, 0, 0, 0, Math.PI / 2)]);
  }
  return shade(merge(parts), (x, y, z, nx, ny) => (ny < -0.3 ? 0.65 : 1) * (0.85 + 0.15 * Math.abs(Math.sin(x * 3.1))));
}

export function makePipe() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(cached('pipe', buildPipe), mats.metalV);
  m.castShadow = true;
  g.add(m);
  for (const sx of [-3, 0, 3]) {
    const ring = new THREE.Mesh(cached('pipeRing', () => new THREE.TorusGeometry(0.44, 0.04, 6, 24)), mats.spiceGlow);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(sx + 0.75, 0.55, 0);
    g.add(ring);
  }
  return g;
}

function boneCurve() {
  const pts = [];
  for (let i = 0; i <= 18; i++) {
    const a = Math.PI * (i / 18);
    pts.push(new THREE.Vector3(-Math.cos(a) * 5.4, -2.8 + Math.sin(a) * 9.0 + Math.sin(a * 2) * 0.4, Math.sin(a) * -1.2));
  }
  return new THREE.CatmullRomCurve3(pts);
}

function buildBoneArch() {
  const parts = [];
  const curve = boneCurve();
  for (const dz of [-0.9, 0.9]) {
    parts.push([new THREE.TubeGeometry(curve, 48, 0.3, 10, false), C.bone, M(0, 0, dz)]);
    for (let i = 1; i < 12; i++) {
      const p = curve.getPoint(i / 12);
      parts.push([new THREE.SphereGeometry(0.36 + (i % 2) * 0.06, 10, 8), C.bone, M(p.x, p.y, p.z + dz, 0, 0, 0, 1, 0.75, 1.1)]);
    }
  }
  for (let i = -4; i <= 4; i++) {
    parts.push([new THREE.CylinderGeometry(0.3, 0.3, 0.85, 12), C.bone, M(i * 0.98, 1.55, 0, 0, 0, Math.PI / 2)]);
    parts.push([new THREE.CylinderGeometry(0.42, 0.42, 0.14, 12), C.boneDark, M(i * 0.98 + 0.49, 1.55, 0, 0, 0, Math.PI / 2)]);
    parts.push([new THREE.ConeGeometry(0.1, 0.45, 6), C.bone, M(i * 0.98, 1.95, 0)]);
  }
  for (const sx of [-4.4, 4.4]) {
    parts.push([new THREE.CylinderGeometry(0.24, 0.34, 4.4, 10), C.bone, M(sx, -0.6, 0)]);
    parts.push([new THREE.SphereGeometry(0.42, 10, 8), C.bone, M(sx, 1.55, 0)]);
  }
  return grime(merge(parts), -2.8, 1.5, 0.45);
}

export function makeBoneArch() {
  return new THREE.Mesh(cached('boneArch', buildBoneArch), mats.boneV);
}

function buildCrater() {
  return radialSurface({
    seg: 28, rings: 6, capTop: false,
    radius: (th, t) => (1.55 - t * 0.75) * (1 + N3(Math.sin(th) * 2, t, Math.cos(th) * 2) * 0.15),
    height: (th, t) => Math.sin(t * Math.PI * 0.9) * 0.35 - t * 0.05,
    color: (th, t, x, y, z, c) => c.copy(C.dark).lerp(C.rust, t).multiplyScalar(0.5 + t * 0.3),
  });
}

export function makeGeyser() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(cached('crater', buildCrater), mats.rock));
  const disc = new THREE.Mesh(cached('ventDisc', () => new THREE.CircleGeometry(0.85, 20)), mats.vent.clone());
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.08;
  g.add(disc);
  const colm = new THREE.Mesh(cached('eruption', () => {
    const c = new THREE.CylinderGeometry(0.5, 1.1, 1, 16, 1, true);
    c.translate(0, 0.5, 0);
    return c;
  }), mats.eruption);
  colm.scale.set(1, 0.01, 1);
  colm.visible = false;
  g.add(colm);
  return { group: g, disc, col: colm };
}

/* ================= Pickups ================= */

export function makeSpiceOrb() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(geo('spiceCore'), mats.spiceGlow);
  g.add(core);
  g.userData.core = core;
  return g;
}

export function makePowerup(type) {
  const g = new THREE.Group();
  let core, halo;
  if (type === 'shield') {
    core = new THREE.Mesh(cached('puShield', () => new THREE.IcosahedronGeometry(0.5, 1)), mats.shieldPU);
    halo = new THREE.Sprite(mats.shieldHalo);
  } else if (type === 'trance') {
    core = new THREE.Mesh(cached('puTrance', () => { const o = new THREE.OctahedronGeometry(0.45, 0); o.scale(0.7, 1.4, 0.7); return o; }), mats.trancePU);
    halo = new THREE.Sprite(mats.tranceHalo);
  } else if (type === 'water' || type === 'cache') {
    const big = type === 'cache';
    core = new THREE.Mesh(cached(big ? 'puCache' : 'puWater', () => big ? buildLiterjon() : buildDrop()), big ? mats.metalV : mats.waterGlow);
    if (big) {
      const ring = new THREE.Mesh(cached('cacheRing', () => new THREE.TorusGeometry(0.42, 0.04, 6, 28)), mats.waterGlow);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.05;
      core.add(ring);
    }
    halo = new THREE.Sprite(mats.waterHalo);
    if (!big) { halo.scale.setScalar(1.3); g.add(core, halo); g.userData.core = core; return g; }
  } else if (type === 'thumper') {
    const t = makeThumper();
    t.group.scale.setScalar(0.42);
    t.group.position.y = -0.55;
    core = new THREE.Group();
    core.add(t.group);
    halo = new THREE.Sprite(mats.thopterHalo);
  } else if (type === 'hooks') {
    core = new THREE.Mesh(cached('puHooks', buildHooks), mats.thopterPU);
    halo = new THREE.Sprite(mats.thopterHalo);
  } else if (type === 'silence') {
    // Silent Step: a pair of pale footprints
    core = new THREE.Mesh(cached('puSilence', () => merge([
      [new THREE.SphereGeometry(0.16, 12, 8), null, M(-0.13, 0.1, 0, 0, 0, 0.2, 0.75, 1.5, 0.35)],
      [new THREE.SphereGeometry(0.16, 12, 8), null, M(0.13, -0.1, 0, 0, 0, -0.2, 0.75, 1.5, 0.35)],
    ])), mats.silencePU);
    halo = new THREE.Sprite(mats.silenceHalo);
  } else if (type === 'seal') {
    // Stillsuit Seal: a banded water capsule
    core = new THREE.Mesh(cached('puSeal', () => merge([
      [new THREE.CapsuleGeometry(0.17, 0.4, 4, 12), null, null],
      [new THREE.TorusGeometry(0.19, 0.035, 6, 20), null, M(0, 0.12, 0, Math.PI / 2, 0, 0)],
      [new THREE.TorusGeometry(0.19, 0.035, 6, 20), null, M(0, -0.12, 0, Math.PI / 2, 0, 0)],
    ])), mats.sealPU);
    halo = new THREE.Sprite(mats.sealHalo);
  } else if (type === 'rush') {
    // Spice Rush: a burning spice crystal cluster
    core = new THREE.Mesh(cached('puRush', () => merge([
      [new THREE.OctahedronGeometry(0.3, 0), null, M(0, 0.05, 0, 0, 0, 0, 0.7, 1.4, 0.7)],
      [new THREE.OctahedronGeometry(0.18, 0), null, M(0.22, -0.12, 0.05, 0, 0, 0.5, 0.7, 1.3, 0.7)],
      [new THREE.OctahedronGeometry(0.16, 0), null, M(-0.2, -0.14, -0.04, 0, 0, -0.5, 0.7, 1.3, 0.7)],
    ])), mats.rushPU);
    halo = new THREE.Sprite(mats.rushHalo);
  } else {
    const t = makeOrnithopter(0.16, true);
    core = t.group;
    g.userData.thopter = t;
    halo = new THREE.Sprite(mats.thopterHalo);
  }
  halo.scale.setScalar(2.6);
  g.add(core, halo);
  g.userData.core = core;
  return g;
}

function buildDrop() {
  const g = merge([[new THREE.SphereGeometry(0.2, 14, 10), null, null], [new THREE.ConeGeometry(0.19, 0.34, 14, 1, true), null, M(0, 0.24, 0)]]);
  g.deleteAttribute('color');
  return g;
}

function buildLiterjon() {
  return merge([
    [new THREE.CylinderGeometry(0.26, 0.28, 0.75, 16), C.brass, null],
    [new THREE.CylinderGeometry(0.12, 0.18, 0.16, 12), C.metalDark, M(0, 0.45, 0)],
    [new THREE.TorusGeometry(0.27, 0.03, 6, 20), C.metalDark, M(0, 0.2, 0, Math.PI / 2, 0, 0)],
    [new THREE.TorusGeometry(0.27, 0.03, 6, 20), C.metalDark, M(0, -0.2, 0, Math.PI / 2, 0, 0)],
  ]);
}

function buildHooks() {
  const parts = [];
  for (const sx of [-1, 1]) {
    parts.push([new THREE.CylinderGeometry(0.035, 0.035, 1.1, 8), C.brass, M(sx * 0.18, 0, 0, 0, 0, sx * 0.25)]);
    parts.push([new THREE.TorusGeometry(0.14, 0.03, 6, 14, Math.PI * 1.3), C.brass, M(sx * 0.31, 0.55, 0, 0, 0, sx > 0 ? -0.2 : Math.PI + 0.2)]);
  }
  return merge(parts);
}

// a single maker hook as Ishra carries it: a pole with a hooked iron head and a grip wrap
export function makeHookProp() {
  return new THREE.Mesh(cached('hookProp', () => merge([
    [new THREE.CylinderGeometry(0.022, 0.022, 1.25, 8), C.dark, M(0, 0, 0)],
    [new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8), C.rust, M(0, -0.35, 0)],
    [new THREE.TorusGeometry(0.11, 0.022, 6, 14, Math.PI * 1.35), C.brass, M(0.1, 0.68, 0, 0, 0, -0.3)],
    [new THREE.ConeGeometry(0.03, 0.12, 6), C.brass, M(0.2, 0.62, 0, 0, 0, Math.PI * 0.9)],
  ])), mats.hookProp);
}

// A dust devil: nested spinning shells of sand, narrow at the ground, flaring overhead.
export function makeDustDevil() {
  const g = new THREE.Group();
  const shell = cached('devilShell', () => {
    const prof = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      prof.push(new THREE.Vector2(0.35 + Math.pow(t, 1.6) * 2.6 + Math.sin(t * 9) * 0.06, t * 9));
    }
    const geo = new THREE.LatheGeometry(prof, 20);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 2);
    return geo;
  });
  for (let k = 0; k < 3; k++) {
    const m = new THREE.Mesh(shell, mats.devil);
    m.scale.set(1 - k * 0.22, 1 - k * 0.1, 1 - k * 0.22);
    m.rotation.y = k * 2.1;
    m.renderOrder = 3;
    g.add(m);
  }
  const base = new THREE.Sprite(mats.halo);
  base.material = mats.devilBase || (mats.devilBase = new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color(0.85, 0.65, 0.42), transparent: true, depthWrite: false, opacity: 0.55 }));
  base.scale.set(4, 2.2, 1);
  base.position.y = 0.8;
  g.add(base);
  return g;
}

// sinkhole disc: radius 1, dark at the centre with spiral streaks, fading out at the rim
export function makeSinkholeGeometry() {
  return cached('sinkhole', () => {
    const geo = new THREE.CircleGeometry(1, 48, 0, Math.PI * 2);
    geo.rotateX(-Math.PI / 2);
    // add rings so the gradient has vertices to live on
    const rings = new THREE.RingGeometry(0.001, 1, 48, 8);
    rings.rotateX(-Math.PI / 2);
    const p = rings.attributes.position;
    const c = new Float32Array(p.count * 4);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const r = Math.hypot(x, z), a = Math.atan2(z, x);
      const spiral = 0.5 + 0.5 * Math.sin(a * 3 + r * 9);
      const k = Math.pow(r, 1.4) * (0.75 + 0.25 * spiral);
      c[i * 4] = 0.04 + k * 0.62; c[i * 4 + 1] = 0.025 + k * 0.45; c[i * 4 + 2] = 0.015 + k * 0.28;
      c[i * 4 + 3] = 1 - Math.pow(Math.max(0, (r - 0.7) / 0.3), 1.5);
    }
    rings.setAttribute('color', new THREE.BufferAttribute(c, 4));
    geo.dispose();
    return rings;
  });
}

/* ================= Vehicles ================= */

function buildThopterBody(gold) {
  const hull = gold ? C.brass : col('#8d7c68');
  const dark = gold ? C.brass : C.metalDark;
  const prof = [[0.001, -3.3], [0.45, -3.0], [0.8, -2.4], [0.98, -1.4], [1.02, -0.2], [0.92, 0.9], [0.62, 1.9], [0.36, 3.0], [0.22, 4.6], [0.16, 5.6], [0.001, 5.7]];
  const parts = [];
  const body = lathe(prof, 20);
  body.rotateX(Math.PI / 2);
  body.scale(1, 0.82, 1);
  parts.push([body, hull, null]);
  parts.push([new THREE.TorusGeometry(0.93, 0.05, 6, 24), dark, M(0, 0, -1.2, 0, 0, 0, 1, 0.82, 1)]);
  parts.push([new THREE.TorusGeometry(0.95, 0.05, 6, 24), dark, M(0, 0, 0.6, 0, 0, 0, 1, 0.82, 1)]);
  for (const sx of [-1, 1]) {
    parts.push([new THREE.CylinderGeometry(0.32, 0.26, 2.4, 14), dark, M(sx * 1.1, -0.25, 0.9, Math.PI / 2, 0, 0)]);
    parts.push([new THREE.TorusGeometry(0.33, 0.06, 6, 14), hull, M(sx * 1.1, -0.25, -0.3)]);
    parts.push([rbox(0.5, 0.3, 0.9, 0.06), dark, M(sx * 0.62, 0.62, -0.5)]);
    parts.push([rbox(0.5, 0.3, 0.9, 0.06), dark, M(sx * 0.62, 0.62, 0.95)]);
    parts.push([new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), dark, M(sx * 0.7, -1.1, -0.9, 0, 0, sx * 0.3)]);
    parts.push([new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), dark, M(sx * 0.7, -1.1, 1.3, 0, 0, sx * 0.3)]);
    parts.push([new THREE.CylinderGeometry(0.07, 0.07, 3.6, 8), dark, M(sx * 0.88, -1.6, 0.2, Math.PI / 2, 0, 0)]);
  }
  parts.push([rbox(0.08, 1.3, 1.1, 0.03), hull, M(0, 0.75, 5.0, -0.3, 0, 0)]);
  parts.push([rbox(2.2, 0.06, 0.7, 0.03), hull, M(0, 0.15, 5.2)]);
  return shade(merge(parts), (x, y, z, nx, ny) => (ny < -0.4 ? 0.7 : 1));
}

function buildWing(gold) {
  const spar = gold ? C.brass : C.metal;
  const parts = [];
  parts.push([new THREE.CylinderGeometry(0.07, 0.035, 5.8, 8), spar, M(2.9, 0, -0.45, 0, 0, Math.PI / 2)]);
  for (let i = 1; i <= 4; i++) {
    const x = i * 1.25;
    const len = 1.35 - i * 0.18;
    parts.push([new THREE.CylinderGeometry(0.025, 0.02, len, 5), spar, M(x, 0, -0.45 + len / 2, Math.PI / 2, 0, 0)]);
  }
  parts.push([rbox(0.4, 0.22, 0.5, 0.05), gold ? C.brass : C.metalDark, M(0.15, 0, -0.3)]);
  return merge(parts);
}

function wingMembrane() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.45);
  s.quadraticCurveTo(3, -0.62, 5.8, -0.45);
  s.quadraticCurveTo(5.5, 0.1, 4.2, 0.5);
  s.quadraticCurveTo(2, 0.95, 0, 0.75);
  s.lineTo(0, -0.45);
  const g = new THREE.ShapeGeometry(s, 10);
  g.rotateX(Math.PI / 2);
  return g;
}

export function makeOrnithopter(scale = 1, gold = false) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(scale);
  g.add(inner);
  const bodyMat = gold ? mats.thopterPU : mats.metalV;
  const body = new THREE.Mesh(cached(`thBody-${gold}`, () => buildThopterBody(gold)), bodyMat);
  body.castShadow = true;
  inner.add(body);
  const canopy = new THREE.Mesh(cached('thCanopy', () => new THREE.SphereGeometry(0.85, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55)), mats.glass);
  canopy.scale.set(0.92, 0.9, 1.5);
  canopy.position.set(0, 0.25, -1.75);
  inner.add(canopy);
  const wings = [];
  const wingGeo = cached(`thWing-${gold}`, () => buildWing(gold));
  const memGeo = cached('thMembrane', wingMembrane);
  for (const [z, phase] of [[-0.5, 0], [0.95, Math.PI * 0.85]]) {
    for (const side of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.72, 0.68, z);
      if (side < 0) pivot.rotation.y = Math.PI;
      pivot.add(new THREE.Mesh(wingGeo, bodyMat));
      pivot.add(new THREE.Mesh(memGeo, mats.wing));
      inner.add(pivot);
      wings.push({ pivot, phase, side });
    }
  }
  for (const sx of [-1.1, 1.1]) {
    const e = new THREE.Mesh(geo('globe'), mats.ibadGlow);
    e.position.set(sx, -0.25, 2.12);
    e.scale.set(1.3, 1.3, 0.5);
    inner.add(e);
  }
  const offset = Math.random() * 10;
  return {
    group: g,
    update(t) {
      for (const w of wings) {
        const a = Math.sin(t * 26 + offset + w.phase);
        w.pivot.rotation.z = a * 0.5 * (w.side < 0 ? -1 : 1);
        w.pivot.rotation.x = Math.cos(t * 26 + offset + w.phase) * 0.12;
      }
    },
  };
}

function buildHarvester() {
  const rnd = mulberry32(9);
  const parts = [];
  const rust = (k = 0.08) => vary(C.rust, rnd, k);
  parts.push([rbox(22, 7, 34, 0.6), rust(), M(0, 7.5, 0)]);
  parts.push([rbox(20, 5, 10, 0.5), rust(), M(0, 9.2, -16, -0.5, 0, 0)]);
  parts.push([rbox(17, 4, 24, 0.5), vary(C.metal, rnd), M(0, 12.5, 2)]);
  parts.push([rbox(8, 6, 8, 0.4), vary(C.metal, rnd), M(-4, 17, 6)]);
  parts.push([rbox(6.5, 2, 6.5, 0.3), C.metalDark, M(-4, 20.6, 6)]);
  for (const sx of [3, 6]) parts.push([new THREE.CylinderGeometry(0.8, 1, 9, 12), C.metalDark, M(sx, 18.5, 10)]);
  parts.push([new THREE.CylinderGeometry(0.15, 0.15, 8, 6), C.metalDark, M(-6, 26, 6)]);
  parts.push([rbox(2, 2, 26, 0.3), C.metalDark, M(7, 17, -8, 0.45, 0, 0)]);
  parts.push([rbox(1.2, 6, 1.2, 0.2), C.metalDark, M(7, 12, -19, 0.2, 0, 0)]);
  for (const sx of [-11.5, 11.5]) {
    for (const sz of [-11, 11]) {
      parts.push([rbox(5.5, 5.5, 15, 1.2), C.metalDark, M(sx, 2.6, sz)]);
      for (let k = 0; k < 14; k++) parts.push([rbox(5.8, 0.5, 0.45, 0.1), C.black, M(sx, 5.3, sz - 6.8 + k * 1.05)]);
    }
  }
  parts.push([rbox(18, 2.2, 3, 0.3), C.metalDark, M(0, 1.6, -19)]);
  for (let k = 0; k < 14; k++) parts.push([new THREE.ConeGeometry(0.35, 1.4, 6), C.metal, M(-8.4 + k * 1.3, 0.4, -20.6, -Math.PI / 2 - 0.6, 0, 0)]);
  for (let k = 0; k < 10; k++) parts.push([rbox(1.6, 0.6, 0.2, 0.05), k % 2 ? C.black : C.hazard, M(-9 + k * 2, 4.4, -17.05)]);
  return shade(merge(parts), (x, y) => 0.6 + 0.4 * smoothstep(0, 10, y));
}

function buildHarvesterLights() {
  const parts = [];
  for (const sx of [-8, -4, 0, 4, 8]) parts.push([rbox(2.2, 0.8, 0.3), C.white, M(sx, 11, -21.2, -0.5, 0, 0)]);
  for (const sx of [-6.5, -4, -1.5]) parts.push([rbox(1.6, 1.2, 0.2), C.white, M(sx, 17.5, 1.95)]);
  parts.push([rbox(16, 0.6, 0.4), C.white, M(0, 0.9, -20.4)]);
  return merge(parts);
}

export function makeHarvester() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(cached('harvester', buildHarvester), mats.metalV));
  g.add(new THREE.Mesh(cached('harvLights', buildHarvesterLights), mats.globe));
  const puffs = [];
  for (let i = 0; i < 16; i++) {
    const s = new THREE.Sprite(mats.plume);
    g.add(s);
    puffs.push({ s, t: i / 16 });
  }
  return {
    group: g,
    update(dt) {
      for (const p of puffs) {
        p.t = (p.t + dt * 0.11) % 1;
        const k = p.t;
        p.s.position.set(Math.sin(k * 9 + p.t) * 6 * k + 4.5, 22 + k * 50, 10 + k * 40);
        p.s.scale.setScalar(6 + k * 46);
      }
    },
  };
}

/* ================= Markers & small set dressing ================= */

function buildObelisk() {
  const rnd = mulberry32(3);
  const parts = [];
  parts.push([rbox(2.6, 0.5, 2.6, 0.05), blockColor(rnd, C.mid), M(0, -2.35, 0)]);
  parts.push([rbox(2.1, 0.5, 2.1, 0.05), blockColor(rnd), M(0, -1.85, 0)]);
  parts.push([rbox(1.7, 0.5, 1.7, 0.05), blockColor(rnd, C.mid), M(0, -1.35, 0)]);
  const shaft = new THREE.CylinderGeometry(0.5, 0.82, 8.2, 4, 6);
  shaft.rotateY(Math.PI / 4);
  parts.push([shaft, C.light, M(0, 3.0, 0)]);
  const tip = new THREE.ConeGeometry(0.71, 1.1, 4);
  tip.rotateY(Math.PI / 4);
  parts.push([tip, C.brass, M(0, 7.65, 0)]);
  return grime(merge(parts), -2.6, 1, 0.35);
}

function buildObeliskGlyphs() {
  const parts = [];
  const rnd = mulberry32(12);
  for (let face = 0; face < 4; face++) {
    const ry = (face * Math.PI) / 2;
    for (let k = 0; k < 7; k++) {
      const y = k * 0.85;
      // shaft half-width tapers from ~0.58 at its base (y=-1.1) to ~0.35 at the top (y=7.1)
      const half = 0.58 - ((y + 1.1) / 8.2) * 0.23 + 0.015;
      const m = new THREE.Matrix4().makeRotationY(ry).multiply(M((rnd() - 0.5) * 0.15, y, half, 0, 0, 0));
      parts.push([new THREE.BoxGeometry(0.5 * (0.4 + rnd() * 0.5), 0.06, 0.02), C.white, m]);
    }
  }
  return merge(parts);
}

export function makeObelisk() {
  const g = new THREE.Group();
  const o = new THREE.Mesh(cached('obelisk', buildObelisk), mats.stoneV);
  o.castShadow = true;
  g.add(o);
  g.add(new THREE.Mesh(cached('obGlyphs', buildObeliskGlyphs), mats.spiceGlow));
  const halo = new THREE.Sprite(mats.spiceHalo);
  halo.position.y = 7.9;
  halo.scale.setScalar(3.5);
  g.add(halo);
  return g;
}

function buildLantern() {
  const parts = [];
  parts.push([lathe([[0.001, 0], [0.26, 0], [0.26, 0.08], [0.16, 0.14], [0.12, 0.5], [0.18, 0.56], [0.2, 0.62], [0.001, 0.62]], 16), C.light, null]);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    parts.push([new THREE.CylinderGeometry(0.018, 0.018, 0.5, 5), C.brass, M(Math.sin(a) * 0.14, 0.84, Math.cos(a) * 0.14, Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25)]);
  }
  parts.push([new THREE.TorusGeometry(0.26, 0.022, 6, 24), C.brass, M(0, 1.08, 0, Math.PI / 2, 0, 0)]);
  return merge(parts);
}

export function makeGlowPost() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(cached('lantern', buildLantern), mats.metalV));
  const globe = new THREE.Mesh(geo('globe'), mats.globe);
  globe.position.y = 1.18;
  globe.scale.setScalar(0.9);
  g.add(globe);
  const halo = new THREE.Sprite(mats.halo);
  halo.position.y = 1.18;
  halo.scale.setScalar(2.4);
  g.add(halo);
  return g;
}

function buildThumper() {
  const parts = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    parts.push([new THREE.CylinderGeometry(0.04, 0.05, 1.2, 6), C.metalDark, M(Math.sin(a) * 0.35, 0.5, Math.cos(a) * 0.35, Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35)]);
  }
  parts.push([new THREE.CylinderGeometry(0.1, 0.12, 2.3, 10), C.metal, M(0, 1.15, 0)]);
  for (let k = 0; k < 5; k++) parts.push([new THREE.TorusGeometry(0.13, 0.025, 6, 12), C.brass, M(0, 0.6 + k * 0.32, 0, Math.PI / 2, 0, 0)]);
  return merge(parts);
}

export function makeThumper() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(cached('thumper', buildThumper), mats.metalV));
  const head = new THREE.Mesh(cached('thumpHead', () => merge([[rbox(0.42, 0.5, 0.42, 0.06), C.metalDark, null], [new THREE.CylinderGeometry(0.06, 0.06, 0.3, 6), C.brass, M(0, 0.35, 0)]])), mats.metalV);
  head.position.y = 2.4;
  g.add(head);
  return { group: g, head };
}

export function makeWreck(rnd) {
  const t = makeOrnithopter(1);
  t.group.rotation.set(0.25, rnd() * Math.PI * 2, 0.5);
  t.update(rnd() * 10);
  return t.group;
}

/* ================= Desert landmarks ================= */

function buildWormSkeleton() {
  const rnd = mulberry32(21);
  const parts = [];
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const x = i * 11;
    pts.push(new THREE.Vector3(x, -1.5 + Math.sin(i * 0.7) * 1.2, Math.sin(i * 0.5) * 9));
  }
  const spine = new THREE.CatmullRomCurve3(pts);
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const tan = new THREE.Vector3();
  const side = new THREE.Vector3();
  const nV = 44;
  for (let i = 0; i < nV; i++) {
    const t = i / (nV - 1);
    const p = spine.getPoint(t);
    spine.getTangent(t, tan);
    q.setFromUnitVectors(up, tan);
    const r = 2.4 * (1 - t * 0.55);
    const m = new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
    parts.push([new THREE.CylinderGeometry(r, r * 0.9, 1.8, 10), C.bone, m]);
    parts.push([new THREE.CylinderGeometry(r * 1.25, r * 1.25, 0.35, 10), lerpC(C.bone, C.boneDark, 0.35), m.clone().multiply(M(0, 0.95, 0))]);
    parts.push([new THREE.ConeGeometry(r * 0.35, r * 1.6, 6), C.bone, new THREE.Matrix4().makeTranslation(p.x, p.y + r * 1.2, p.z)]);
  }
  for (let i = 0; i < 20; i++) {
    const t = 0.06 + (i / 19) * 0.86;
    const p = spine.getPoint(t);
    spine.getTangent(t, tan);
    side.crossVectors(tan, up).normalize();
    const size = 20 * (1 - t * 0.55);
    const broken = rnd() < 0.3 ? 0.55 + rnd() * 0.3 : 1;
    for (const sgn of [-1, 1]) {
      const ribPts = [];
      for (let k = 0; k <= 6; k++) {
        const a = (k / 6) * Math.PI * 0.85 * broken;
        const out = Math.sin(a) * size * 0.75 + 1.8;
        const y = (1 - Math.cos(a)) * size * 0.62;
        ribPts.push(new THREE.Vector3(p.x + side.x * sgn * out, p.y + y * 0.9 + Math.sin(a) * size * 0.3, p.z + side.z * sgn * out));
      }
      parts.push([new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ribPts), 18, 0.55 * (1 - t * 0.4), 6, false), C.bone, null]);
    }
  }
  const head = spine.getPoint(0);
  parts.push([new THREE.TorusGeometry(10, 2.4, 10, 36), C.bone, M(head.x - 4, head.y + 6, head.z, 0, Math.PI / 2, 0)]);
  const dir = new THREE.Vector3();
  for (let k = 0; k < 36; k++) {
    const a = (k / 36) * Math.PI * 2;
    dir.set(-0.35, -Math.sin(a), -Math.cos(a)).normalize();
    q.setFromUnitVectors(up, dir);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(head.x - 4.5, head.y + 6 + Math.sin(a) * 8.6, head.z + Math.cos(a) * 8.6), q, new THREE.Vector3(1, 1, 1));
    parts.push([new THREE.ConeGeometry(0.45, 3.2, 5), C.cream, m]);
  }
  return shade(merge(parts), (x, y) => (y < 0.5 ? 0.62 : 1) * (0.85 + 0.15 * smoothstep(0, 18, y)));
}

export function makeWormSkeleton() {
  const m = new THREE.Mesh(cached('wormSkeleton', buildWormSkeleton), mats.boneV);
  return m;
}

function buildStoneCircle() {
  const rnd = mulberry32(31);
  const parts = [];
  const R = 22;
  const n = 11;
  const tops = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * R, z = Math.sin(a) * R;
    if (rnd() < 0.2) {
      const fallen = chipped(rbox(3, 15, 1.8, 0.3, 2), 0.25, 0.25, 400 + i);
      parts.push([fallen, blockColor(rnd, C.mid), M(x * 1.15, 0.6, z * 1.15, Math.PI / 2, -a, 0.2)]);
      tops.push(null);
      continue;
    }
    const h = 13 + rnd() * 8;
    const slab = chipped(rbox(3.2, h, 1.9, 0.3, 2), 0.28, 0.22, 500 + i);
    parts.push([slab, blockColor(rnd), M(x, h / 2 - 1.5, z, (rnd() - 0.5) * 0.08, -a + Math.PI / 2, (rnd() - 0.5) * 0.08)]);
    tops.push([x, h - 1.5, z, a]);
  }
  for (let i = 0; i < n; i += 2) {
    const A = tops[i], B = tops[(i + 1) % n];
    if (!A || !B) continue;
    const mx = (A[0] + B[0]) / 2, mz = (A[2] + B[2]) / 2;
    const len = Math.hypot(A[0] - B[0], A[2] - B[2]) + 3;
    const y = Math.min(A[1], B[1]) + 0.9;
    parts.push([chipped(rbox(len, 1.8, 2.2, 0.25, 2), 0.18, 0.3, 600 + i), blockColor(rnd, C.light), M(mx, y, mz, 0, -Math.atan2(B[2] - A[2], B[0] - A[0]), 0)]);
  }
  parts.push([chipped(rbox(6, 1.6, 4, 0.3, 2), 0.15, 0.4, 700), blockColor(rnd, C.mid), M(0, 0.3, 0)]);
  return grime(merge(parts), -1.5, 4, 0.4);
}

export function makeStoneCircle() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(cached('stoneCircle', buildStoneCircle), mats.stoneV));
  const orb = new THREE.Mesh(geo('globe'), mats.spiceGlow);
  orb.position.y = 2.6;
  orb.scale.setScalar(4);
  g.add(orb);
  const halo = new THREE.Sprite(mats.spiceHalo);
  halo.position.y = 2.6;
  halo.scale.setScalar(14);
  g.add(halo);
  return g;
}

function white(g) {
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
  return g;
}

function buildSietch() {
  const rnd = mulberry32(41);
  const parts = [];
  parts.push([rockGeometry('mesa', 2), null, M(0, -4, -16, 0, 0, 0, 36, 50, 22)]);
  parts.push([rockGeometry('mesa', 1), null, M(-40, -4, 0, 0, 1.1, 0, 20, 46, 18)]);
  parts.push([rockGeometry('mesa', 3), null, M(40, -4, -2, 0, 2.3, 0, 20, 42, 18)]);
  const face = shade(white(chipped(rbox(62, 40, 10, 2, 3), 1.6, 0.05, 800)), (x, y) => 0.82 + 0.18 * Math.sin(y * 0.9) + (y > 17 ? 0.06 : 0));
  parts.push([face, C.mid, M(0, 15, 5)]);
  for (let row = 0; row < 4; row++) {
    const y = 3 + row * 8.5;
    parts.push([rbox(58 - row * 6, 0.8, 3.2, 0.2), blockColor(rnd, C.light), M(0, y - 1.6, 11)]);
    for (let k = 0; k < 7 - row; k++) {
      const x = (k - (6 - row) / 2) * 7.5;
      parts.push([rbox(3.2, 4.6, 1.2, 0.3), C.black, M(x, y + 1.2, 10.05)]);
      parts.push([rbox(4.2, 0.6, 1.6, 0.15), blockColor(rnd, C.cream), M(x, y + 3.8, 10.3)]);
    }
  }
  for (let k = 0; k < 9; k++) {
    parts.push([rbox(4, 1.1, 3, 0.15), blockColor(rnd, C.light), M(-27 + k * 1.2, 0.6 + k * 1.05, 12 - k * 0.1, 0, 0, 0)]);
  }
  return grime(merge(parts), -4, 6, 0.35);
}

function buildSietchLights() {
  const parts = [];
  for (let row = 0; row < 4; row++) {
    const y = 3 + row * 8.5;
    for (let k = 0; k < 7 - row; k++) {
      const x = (k - (6 - row) / 2) * 7.5;
      if ((row * 7 + k) % 3 === 1) continue;
      parts.push([rbox(1.6, 2.4, 0.3, 0.1), C.white, M(x, y + 0.9, 10.4)]);
    }
  }
  return merge(parts);
}

export function makeSietch() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(cached('sietch', buildSietch), mats.rock));
  g.add(new THREE.Mesh(cached('sietchLights', buildSietchLights), mats.globe));
  return g;
}
