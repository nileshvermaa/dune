import * as THREE from 'three';
import { createNoise2D, mulberry32 } from './noise.js';
import { createSandTextures, createStoneTextures, createGlowTexture, createArrowTexture } from './textures.js';

// Shared materials, geometry and prop builders. Everything is procedural.

export const tex = {};
export const mats = {};
const geoCache = new Map();
const rockNoise = createNoise2D(4242);

const srgb = (hex) => new THREE.Color(hex);

export function initProps() {
  Object.assign(tex, {
    sand: createSandTextures(512),
    stone: createStoneTextures(512),
    glow: createGlowTexture(128),
    arrow: createArrowTexture(256),
  });

  mats.rock = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 });
  mats.stone = new THREE.MeshStandardMaterial({ map: tex.stone.map, normalMap: tex.stone.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.92, color: srgb('#fff4e6') });
  mats.stoneDark = new THREE.MeshStandardMaterial({ map: tex.stone.map, normalMap: tex.stone.normalMap, roughness: 0.95, color: srgb('#9c7f62') });
  mats.bone = new THREE.MeshStandardMaterial({ color: srgb('#e7dcc6'), roughness: 0.55, metalness: 0.02 });
  mats.metal = new THREE.MeshStandardMaterial({ color: srgb('#6b5a4a'), roughness: 0.55, metalness: 0.7 });
  mats.metalDark = new THREE.MeshStandardMaterial({ color: srgb('#2c2622'), roughness: 0.45, metalness: 0.8 });
  mats.rust = new THREE.MeshStandardMaterial({ color: srgb('#8a5a3a'), roughness: 0.8, metalness: 0.45 });
  mats.glass = new THREE.MeshStandardMaterial({ color: srgb('#1b2a3a'), roughness: 0.08, metalness: 0.6, emissive: srgb('#0d2a40'), emissiveIntensity: 0.6 });
  mats.wing = new THREE.MeshStandardMaterial({ color: srgb('#c9b9a0'), roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
  mats.spiceGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.8, 0.1) });
  mats.globe = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.2, 1.1) });
  mats.ibadGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.2, 4.0) });
  mats.dark = new THREE.MeshBasicMaterial({ color: srgb('#120904') });
  mats.vent = new THREE.MeshStandardMaterial({ color: srgb('#2a1408'), emissive: srgb('#ff5a10'), emissiveIntensity: 0.4, roughness: 1 });
  mats.eruption = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 1.1, 0.25), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  mats.arrow = new THREE.MeshBasicMaterial({ map: tex.arrow, color: new THREE.Color(2.4, 1.1, 0.35), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  mats.spicePatch = new THREE.MeshBasicMaterial({ map: tex.glow, color: new THREE.Color(1.6, 0.55, 0.12), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });

  mats.halo = new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color(1.0, 0.75, 0.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 });
  mats.spiceHalo = new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color(1.0, 0.45, 0.1), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 });
  mats.shieldHalo = new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color(0.3, 0.6, 1.0), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  mats.tranceHalo = new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color(0.55, 0.35, 1.0), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  mats.thopterHalo = new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color(1.0, 0.85, 0.3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  mats.plume = new THREE.SpriteMaterial({ map: tex.glow, color: srgb('#a07850'), transparent: true, opacity: 0.35, depthWrite: false });

  mats.shieldPU = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.4, 3.2), wireframe: true });
  mats.trancePU = new THREE.MeshStandardMaterial({ color: srgb('#4a3cff'), emissive: new THREE.Color(0.5, 0.3, 2.0), roughness: 0.2, metalness: 0.3 });
  mats.thopterPU = new THREE.MeshStandardMaterial({ color: srgb('#ffc54a'), emissive: srgb('#7a4a00'), roughness: 0.3, metalness: 0.9 });

  geoCache.set('spiceCore', new THREE.OctahedronGeometry(0.26, 0));
  geoCache.set('box', new THREE.BoxGeometry(1, 1, 1));
  geoCache.set('globe', new THREE.SphereGeometry(0.2, 12, 8));
}

export function geo(name) { return geoCache.get(name); }

/* ---------------- Rocks ---------------- */

const ROCK_DARK = srgb('#5e3a26');
const ROCK_MID = srgb('#9a6440');
const ROCK_LIGHT = srgb('#c89566');

function buildRock(kind, seed) {
  const rnd = mulberry32(seed);
  const g = new THREE.IcosahedronGeometry(1, kind === 'mesa' ? 3 : 2);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const o = rnd() * 100;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = rockNoise(v.x * 1.3 + o, v.y * 1.3) * 0.5 + rockNoise(v.y * 1.7 - o, v.z * 1.7) * 0.35 + rockNoise(v.z * 3.1 + o, v.x * 3.1) * 0.15;
    v.multiplyScalar(1 + n * (kind === 'boulder' ? 0.38 : 0.25));
    if (kind === 'mesa') {
      if (v.y > 0.3) v.y = 0.3 + (v.y - 0.3) * 0.1;
      const strata = 1 + 0.05 * Math.sin(v.y * 22 + o);
      v.x *= strata; v.z *= strata;
    } else if (kind === 'spire') {
      const k = 0.35 + (1 - (v.y + 1) * 0.5) * 0.35;
      v.x *= k; v.z *= k;
    }
    if (v.y < -0.4) v.y = -0.4 + (v.y + 0.4) * 0.3;
    pos.setXYZ(i, v.x, v.y, v.z);
    const band = 0.5 + 0.5 * Math.sin(v.y * 9 + n * 3 + o);
    c.copy(ROCK_MID).lerp(ROCK_LIGHT, band * 0.8);
    c.lerp(ROCK_DARK, Math.max(0, -v.y) * 0.6);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

export function rockGeometry(kind, variant = 0) {
  const key = `rock-${kind}-${variant % 4}`;
  if (!geoCache.has(key)) geoCache.set(key, buildRock(kind, 1000 + (variant % 4) * 77 + kind.length * 13));
  return geoCache.get(key);
}

export function makeRock(kind, variant, sx, sy, sz) {
  const m = new THREE.Mesh(rockGeometry(kind, variant), mats.rock);
  m.scale.set(sx, sy, sz);
  return m;
}

/* ---------------- Track obstacles ---------------- */

function cachedGeo(key, fn) {
  if (!geoCache.has(key)) geoCache.set(key, fn());
  return geoCache.get(key);
}

export function makeColumn(height = 6, broken = false) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(cachedGeo('colShaft', () => new THREE.CylinderGeometry(0.62, 0.74, 1, 10)), mats.stone);
  shaft.scale.y = height;
  shaft.position.y = height / 2;
  g.add(shaft);
  const base = new THREE.Mesh(geo('box'), mats.stoneDark);
  base.scale.set(1.9, 0.6, 1.9);
  base.position.y = 0.3;
  g.add(base);
  if (!broken) {
    const cap = new THREE.Mesh(geo('box'), mats.stoneDark);
    cap.scale.set(1.9, 0.55, 1.9);
    cap.position.y = height + 0.27;
    g.add(cap);
  } else {
    shaft.rotation.z = 0.04;
  }
  return g;
}

function boneArcGeometry() {
  return cachedGeo('boneArc', () => {
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const a = Math.PI * t;
      pts.push(new THREE.Vector3(-Math.cos(a) * 5.4, -2.8 + Math.sin(a) * 9.0 + Math.sin(a * 2) * 0.4, Math.sin(a) * -1.2));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.32, 8, false);
  });
}

export function makeBoneArch(withBeam = true) {
  const g = new THREE.Group();
  for (const dz of [-0.9, 0.9]) {
    const arc = new THREE.Mesh(boneArcGeometry(), mats.bone);
    arc.position.z = dz;
    g.add(arc);
  }
  if (withBeam) {
    const beam = new THREE.Mesh(cachedGeo('boneBeam', () => new THREE.CapsuleGeometry(0.34, 9.0, 4, 10)), mats.bone);
    beam.rotation.z = Math.PI / 2;
    beam.position.y = 1.55;
    g.add(beam);
    for (const sx of [-4.35, 4.35]) {
      const post = new THREE.Mesh(cachedGeo('bonePost', () => new THREE.CylinderGeometry(0.22, 0.3, 4.4, 8)), mats.bone);
      post.position.set(sx, -0.6, 0);
      g.add(post);
    }
  }
  return g;
}

export function makeLintel(metal = false) {
  const g = new THREE.Group();
  const mat = metal ? mats.metal : mats.stone;
  const beam = new THREE.Mesh(geo('box'), mat);
  beam.scale.set(10.2, 0.75, 1.3);
  beam.position.y = 1.6;
  g.add(beam);
  for (const sx of [-4.6, 4.6]) {
    const p = new THREE.Mesh(geo('box'), metal ? mats.metalDark : mats.stoneDark);
    p.scale.set(1.0, 5.2, 1.4);
    p.position.set(sx, -0.6, 0);
    g.add(p);
  }
  if (metal) {
    for (const sx of [-3, -1, 1, 3]) {
      const l = new THREE.Mesh(geo('globe'), mats.spiceGlow);
      l.position.set(sx, 1.2, -0.66);
      l.scale.setScalar(0.5);
      g.add(l);
    }
  } else {
    const top = new THREE.Mesh(geo('box'), mats.stoneDark);
    top.scale.set(11, 0.4, 1.6);
    top.position.y = 2.15;
    g.add(top);
  }
  return g;
}

export function makeRubbleWall(rnd) {
  const g = new THREE.Group();
  let x = -3.9;
  while (x < 3.9) {
    const w = Math.min(0.9 + rnd() * 0.9, 3.95 - x);
    const h = 0.75 + rnd() * 0.25;
    const b = new THREE.Mesh(geo('box'), rnd() < 0.5 ? mats.stone : mats.stoneDark);
    b.scale.set(w * 0.96, h, 0.8 + rnd() * 0.3);
    b.position.set(x + w / 2, h / 2, (rnd() - 0.5) * 0.25);
    b.rotation.y = (rnd() - 0.5) * 0.15;
    b.castShadow = true;
    g.add(b);
    x += w;
  }
  return g;
}

export function makePipe() {
  const g = new THREE.Group();
  const pipe = new THREE.Mesh(cachedGeo('pipe', () => new THREE.CylinderGeometry(0.42, 0.42, 9, 14)), mats.rust);
  pipe.rotation.z = Math.PI / 2;
  pipe.position.y = 0.55;
  pipe.castShadow = true;
  g.add(pipe);
  for (const sx of [-3.2, 0, 3.2]) {
    const ring = new THREE.Mesh(cachedGeo('pipeRing', () => new THREE.TorusGeometry(0.46, 0.07, 6, 16)), mats.spiceGlow);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(sx, 0.55, 0);
    g.add(ring);
    const sup = new THREE.Mesh(geo('box'), mats.metalDark);
    sup.scale.set(0.25, 0.4, 0.6);
    sup.position.set(sx + 0.8, 0.2, 0);
    g.add(sup);
  }
  return g;
}

export function makeGeyser() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(cachedGeo('ventRing', () => new THREE.TorusGeometry(0.9, 0.28, 8, 18)), mats.rock);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.08;
  g.add(ring);
  const disc = new THREE.Mesh(cachedGeo('ventDisc', () => new THREE.CircleGeometry(0.85, 18)), mats.vent.clone());
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.03;
  g.add(disc);
  const col = new THREE.Mesh(cachedGeo('eruption', () => {
    const c = new THREE.CylinderGeometry(0.5, 1.1, 1, 14, 1, true);
    c.translate(0, 0.5, 0);
    return c;
  }), mats.eruption);
  col.scale.set(1, 0.01, 1);
  col.visible = false;
  g.add(col);
  return { group: g, disc, col };
}

/* ---------------- Pickups ---------------- */

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
    core = new THREE.Mesh(cachedGeo('puShield', () => new THREE.IcosahedronGeometry(0.5, 1)), mats.shieldPU);
    halo = new THREE.Sprite(mats.shieldHalo);
  } else if (type === 'trance') {
    core = new THREE.Mesh(cachedGeo('puTrance', () => { const o = new THREE.OctahedronGeometry(0.45, 0); o.scale(0.7, 1.4, 0.7); return o; }), mats.trancePU);
    halo = new THREE.Sprite(mats.tranceHalo);
  } else {
    const t = makeOrnithopter(0.16, mats.thopterPU);
    core = t.group;
    g.userData.thopter = t;
    halo = new THREE.Sprite(mats.thopterHalo);
  }
  halo.scale.setScalar(2.6);
  g.add(core, halo);
  g.userData.core = core;
  return g;
}

/* ---------------- Vehicles & set pieces ---------------- */

export function makeOrnithopter(scale = 1, bodyMat = mats.metal) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(scale);
  g.add(inner);
  const body = new THREE.Mesh(cachedGeo('thBody', () => { const c = new THREE.CapsuleGeometry(0.9, 3.2, 6, 12); c.rotateX(Math.PI / 2); return c; }), bodyMat);
  inner.add(body);
  const cockpit = new THREE.Mesh(cachedGeo('thCock', () => new THREE.SphereGeometry(0.85, 16, 12)), mats.glass);
  cockpit.scale.set(1, 0.85, 1.25);
  cockpit.position.set(0, 0.15, -1.9);
  inner.add(cockpit);
  const tail = new THREE.Mesh(cachedGeo('thTail', () => { const c = new THREE.CylinderGeometry(0.28, 0.12, 3.6, 8); c.rotateX(Math.PI / 2); return c; }), bodyMat);
  tail.position.set(0, 0.2, 3.6);
  inner.add(tail);
  const fin = new THREE.Mesh(geo('box'), bodyMat);
  fin.scale.set(0.08, 1.1, 0.9);
  fin.position.set(0, 0.8, 5.0);
  inner.add(fin);
  const wings = [];
  const wingGeo = cachedGeo('thWing', () => { const b = new THREE.BoxGeometry(5.6, 0.05, 1.2); b.translate(2.8, 0, 0); return b; });
  for (const [z, phase] of [[-0.5, 0], [0.9, Math.PI]]) {
    for (const side of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.7, 0.75, z);
      if (side < 0) pivot.rotation.y = Math.PI;
      const w = new THREE.Mesh(wingGeo, mats.wing);
      pivot.add(w);
      inner.add(pivot);
      wings.push({ pivot, phase, side });
    }
  }
  for (const sx of [-0.45, 0.45]) {
    const e = new THREE.Mesh(geo('globe'), mats.ibadGlow);
    e.position.set(sx, -0.1, 2.0);
    e.scale.setScalar(0.9);
    inner.add(e);
  }
  const offset = Math.random() * 10;
  return {
    group: g,
    update(t) {
      for (const w of wings) w.pivot.rotation.z = Math.sin(t * 28 + offset + w.phase) * 0.45 * (w.side < 0 ? -1 : 1);
    },
  };
}

export function makeHarvester() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(geo('box'), mats.rust);
  body.scale.set(22, 9, 36);
  body.position.y = 7;
  g.add(body);
  const top = new THREE.Mesh(geo('box'), mats.metal);
  top.scale.set(14, 5, 16);
  top.position.set(0, 13.5, -4);
  g.add(top);
  const tower = new THREE.Mesh(geo('box'), mats.metalDark);
  tower.scale.set(4, 9, 4);
  tower.position.set(5, 18, 6);
  g.add(tower);
  for (const sx of [-11, 11]) {
    for (const sz of [-12, 12]) {
      const tread = new THREE.Mesh(geo('box'), mats.metalDark);
      tread.scale.set(5, 5, 14);
      tread.position.set(sx, 2.2, sz);
      g.add(tread);
    }
  }
  const scoop = new THREE.Mesh(geo('box'), mats.spiceGlow);
  scoop.scale.set(16, 1, 2);
  scoop.position.set(0, 1.4, -18.5);
  g.add(scoop);
  const lights = [];
  for (const sx of [-8, 0, 8]) {
    const l = new THREE.Mesh(geo('globe'), mats.globe);
    l.scale.setScalar(2.5);
    l.position.set(sx, 11.8, -18.2);
    g.add(l);
    lights.push(l);
  }
  const puffs = [];
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(mats.plume);
    g.add(s);
    puffs.push({ s, t: i / 14 });
  }
  return {
    group: g,
    update(dt) {
      for (const p of puffs) {
        p.t = (p.t + dt * 0.12) % 1;
        const k = p.t;
        p.s.position.set(Math.sin(k * 9 + p.t) * 6 * k, 4 + k * 55, 18 + k * 40);
        p.s.scale.setScalar(10 + k * 50);
      }
    },
  };
}

export function makeBigArch(span = 13, height = 9) {
  const g = new THREE.Group();
  for (const sx of [-span / 2, span / 2]) {
    const leg = new THREE.Mesh(geo('box'), mats.stone);
    leg.scale.set(1.8, height + 3, 1.8);
    leg.position.set(sx, (height + 3) / 2 - 3, 0);
    leg.castShadow = true;
    g.add(leg);
  }
  const top = new THREE.Mesh(geo('box'), mats.stone);
  top.scale.set(span + 3, 1.6, 2.2);
  top.position.y = height + 0.8;
  top.castShadow = true;
  g.add(top);
  const crown = new THREE.Mesh(geo('box'), mats.stoneDark);
  crown.scale.set(4, 1.8, 2.4);
  crown.position.y = height + 2.5;
  g.add(crown);
  const glyph = new THREE.Mesh(geo('globe'), mats.ibadGlow);
  glyph.position.set(0, height + 2.5, -1.25);
  glyph.scale.setScalar(2);
  g.add(glyph);
  return g;
}

export function makeObelisk() {
  const g = new THREE.Group();
  const o = new THREE.Mesh(cachedGeo('obelisk', () => new THREE.CylinderGeometry(0.35, 0.9, 9, 4)), mats.stoneDark);
  o.rotation.y = Math.PI / 4;
  o.position.y = 1.9;
  o.castShadow = true;
  g.add(o);
  const gem = new THREE.Mesh(geo('globe'), mats.spiceGlow);
  gem.position.y = 6.8;
  gem.scale.setScalar(1.6);
  g.add(gem);
  const halo = new THREE.Sprite(mats.spiceHalo);
  halo.position.y = 6.8;
  halo.scale.setScalar(4);
  g.add(halo);
  return g;
}

export function makeGlowPost() {
  const g = new THREE.Group();
  const post = new THREE.Mesh(geo('box'), mats.stoneDark);
  post.scale.set(0.28, 1.1, 0.28);
  post.position.y = 0.55;
  g.add(post);
  const globe = new THREE.Mesh(geo('globe'), mats.globe);
  globe.position.y = 1.55;
  g.add(globe);
  const halo = new THREE.Sprite(mats.halo);
  halo.position.y = 1.55;
  halo.scale.setScalar(2.2);
  g.add(halo);
  return g;
}

export function makeThumper() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(cachedGeo('thumpPole', () => new THREE.CylinderGeometry(0.1, 0.14, 2.4, 6)), mats.metal);
  pole.position.y = 1.2;
  g.add(pole);
  const head = new THREE.Mesh(geo('box'), mats.metalDark);
  head.scale.set(0.4, 0.5, 0.4);
  head.position.y = 2.4;
  g.add(head);
  return { group: g, head };
}

export function makeWreck(rnd) {
  const t = makeOrnithopter(1, mats.rust);
  t.group.rotation.set(0.25, rnd() * Math.PI * 2, 0.5);
  t.update(rnd() * 10);
  return t.group;
}
