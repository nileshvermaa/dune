import * as THREE from 'three';
import { mulberry32 } from './noise.js';

// World-space ("triplanar") surface detail injected into MeshStandardMaterial:
// stone grain + pitting modulate albedo and perturb the normal, fading with distance.
// Lets procedural props read as carved stone without any UV unwrapping.

let detailTex = null;

function periodicValueNoise(size, cells, rnd) {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const out = new Float32Array(size * size);
  const f = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * cells, gy = (y / size) * cells;
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const tx = f(gx - x0), ty = f(gy - y0);
      const x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
      const a = g[y0 * cells + x0], b = g[y0 * cells + x1], c = g[y1 * cells + x0], d = g[y1 * cells + x1];
      out[y * size + x] = a + (b - a) * tx + (c + (d - c) * tx - (a + (b - a) * tx)) * ty;
    }
  }
  return out;
}

export function getDetailTexture() {
  if (detailTex) return detailTex;
  const size = 512;
  const rnd = mulberry32(99);
  const h = new Float32Array(size * size);
  let amp = 0.5;
  for (const cells of [4, 8, 16, 32, 64]) {
    const n = periodicValueNoise(size, cells, rnd);
    for (let i = 0; i < h.length; i++) h[i] += n[i] * amp;
    amp *= 0.5;
  }
  // pits and chisel marks
  for (let k = 0; k < 0; k++) {
    const cx = rnd() * size, cy = rnd() * size, r = 2 + rnd() * 4, depth = 0.08 + rnd() * 0.12;
    for (let y = -6; y <= 6; y++) {
      for (let x = -6; x <= 6; x++) {
        const d = Math.hypot(x, y) / r;
        if (d > 1) continue;
        const px = (Math.floor(cx + x) + size) % size, py = (Math.floor(cy + y) + size) % size;
        h[py * size + px] -= depth * (1 - d * d);
      }
    }
  }
  let mn = Infinity, mx = -Infinity;
  for (const v of h) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < h.length; i++) {
    const v = ((h[i] - mn) / (mx - mn)) * 255;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  detailTex = t;
  return t;
}

/* ---- photo-scanned surface sets (CC0, Poly Haven; see public/textures/CREDITS.md) ----
   Sampled in world space like the procedural detail. Colour is applied relative to the
   photo's mean so it adds grain and variation without shifting the game's palette. */
const PHOTO = {
  sand: { mean: [0.422, 0.378, 0.31], lum: 0.383 },
  sandstone: { mean: [0.82, 0.632, 0.453], lum: 0.668 },
  rock: { mean: [0.293, 0.269, 0.175], lum: 0.266 },
};
export const photoUniforms = {}; // exported for devtools comparisons
function solid(r, g, b) {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}
function photoSet(name) {
  if (!photoUniforms[name]) {
    const m = PHOTO[name].mean;
    photoUniforms[name] = {
      map: { value: solid(m[0] * 255, m[1] * 255, m[2] * 255) },
      nor: { value: solid(128, 128, 255) },
      mean: { value: new THREE.Vector3(...m) },
      lum: { value: PHOTO[name].lum },
      on: { value: 0 },
    };
  }
  return photoUniforms[name];
}

// Load every photo set in the background; each fades in once both of its maps arrive.
export function loadPhotoTextures(renderer) {
  const loader = new THREE.TextureLoader();
  const aniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
  const sets = Object.keys(PHOTO).map((name) => {
    const u = photoSet(name);
    const load = (file) => new Promise((resolve, reject) => {
      loader.load(`/textures/${file}`, (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = THREE.NoColorSpace; // used as relative detail, not as final albedo
        t.anisotropy = aniso;
        resolve(t);
      }, undefined, reject);
    });
    return Promise.all([load(`${name}_diff.webp`), load(`${name}_nor.webp`)]).then(([map, nor]) => {
      u.map.value = map;
      u.nor.value = nor;
      u.loaded = true;
    });
  });
  return Promise.allSettled(sets);
}

// call each frame: eases loaded sets in so the swap never pops
export function updatePhotoTextures(dt) {
  for (const u of Object.values(photoUniforms)) if (u.loaded && !u.held && u.on.value < 1) u.on.value = Math.min(1, u.on.value + dt * 1.5);
}

const VERT_DECL = /* glsl */ `
varying vec3 vTpPos;
varying vec3 vTpN;
`;
const VERT_BODY = /* glsl */ `
vec4 tpP = vec4(transformed, 1.0);
vec3 tpN = objectNormal;
#ifdef USE_INSTANCING
tpP = instanceMatrix * tpP;
tpN = mat3(instanceMatrix) * tpN;
#endif
tpP = modelMatrix * tpP;
vTpPos = tpP.xyz;
vTpN = normalize(mat3(modelMatrix) * tpN);
`;
const FRAG_DECL = /* glsl */ `
varying vec3 vTpPos;
varying vec3 vTpN;
uniform sampler2D uTpTex;
uniform float uTpScale;
uniform float uTpStrength;
uniform float uTpBump;
uniform float uTpSparkle;
float tpSample(float s) {
  vec3 bw = pow(abs(normalize(vTpN)), vec3(4.0));
  bw /= dot(bw, vec3(1.0));
  return texture2D(uTpTex, vTpPos.zy * s).r * bw.x
       + texture2D(uTpTex, vTpPos.xz * s).r * bw.y
       + texture2D(uTpTex, vTpPos.xy * s).r * bw.z;
}
float tpHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
#ifdef USE_PHOTO
uniform sampler2D uPhMap;
uniform sampler2D uPhNor;
uniform vec3 uPhMean;
uniform float uPhLum;
uniform float uPhOn;
uniform float uPhScale;
uniform float uPhMix;
uniform float uPhChroma;
uniform float uPhBump;
vec3 phWeights() { vec3 bw = pow(abs(normalize(vTpN)), vec3(4.0)); return bw / dot(bw, vec3(1.0)); }
vec3 phColor(float s) {
  vec3 bw = phWeights();
  return texture2D(uPhMap, vTpPos.zy * s).rgb * bw.x
       + texture2D(uPhMap, vTpPos.xz * s).rgb * bw.y
       + texture2D(uPhMap, vTpPos.xy * s).rgb * bw.z;
}
#endif
`;
const FRAG_PHOTO_ALBEDO = /* glsl */ `
#ifdef USE_PHOTO
{
  // a second, larger scale breaks up the tiling; detail is relative to the photo's mean
  vec3 p1 = phColor(uPhScale), p2 = phColor(uPhScale * 0.29);
  vec3 r1 = mix(vec3(dot(p1, vec3(0.299, 0.587, 0.114)) / uPhLum), p1 / uPhMean, uPhChroma);
  vec3 r2 = mix(vec3(dot(p2, vec3(0.299, 0.587, 0.114)) / uPhLum), p2 / uPhMean, uPhChroma);
  vec3 rel = 1.0 + (r1 - 1.0) * 0.75 + (r2 - 1.0) * 0.45;
  diffuseColor.rgb *= mix(vec3(1.0), clamp(rel, 0.25, 1.9), uPhMix * uPhOn);
}
#endif
`;
const FRAG_PHOTO_NORMAL = /* glsl */ `
#ifdef USE_PHOTO
{
  float phFade = (1.0 - smoothstep(25.0, 90.0, length(vViewPosition))) * uPhOn * uPhBump;
  if (phFade > 0.0) {
    // triplanar normal mapping ("whiteout" blend) in world space, then into view space
    vec3 wn = normalize(vTpN);
    vec3 bw = phWeights();
    vec3 tx = texture2D(uPhNor, vTpPos.zy * uPhScale).xyz * 2.0 - 1.0;
    vec3 ty = texture2D(uPhNor, vTpPos.xz * uPhScale).xyz * 2.0 - 1.0;
    vec3 tz = texture2D(uPhNor, vTpPos.xy * uPhScale).xyz * 2.0 - 1.0;
    tx = vec3(tx.xy + wn.zy, abs(tx.z) * wn.x);
    ty = vec3(ty.xy + wn.xz, abs(ty.z) * wn.y);
    tz = vec3(tz.xy + wn.xy, abs(tz.z) * wn.z);
    vec3 pn = normalize(tx.zyx * bw.x + ty.xzy * bw.y + tz.xyz * bw.z);
    pn = normalize(mix(wn, pn, phFade));
    vec3 dv = (viewMatrix * vec4(pn, 0.0)).xyz - (viewMatrix * vec4(wn, 0.0)).xyz;
    normal = normalize(normal + dv);
  }
}
#endif
`;
const FRAG_ALBEDO = /* glsl */ `
float tpH = tpSample(uTpScale);
float tpL = tpSample(uTpScale * 0.13);
diffuseColor.rgb *= mix(1.0 - uTpStrength, 1.0 + uTpStrength * 0.35, tpH) * mix(0.82, 1.12, tpL);
`;
const FRAG_NORMAL = /* glsl */ `
{
  float tpFade = 1.0 - smoothstep(18.0, 70.0, length(vViewPosition));
  if (uTpBump > 0.0 && tpFade > 0.0) {
    vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
    float h = tpH + tpL * 0.6;
    float dhx = dFdx(h), dhy = dFdy(h);
    vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
    float det = dot(dpdx, r1);
    vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
    normal = normalize(abs(det) * normal - grad * uTpBump * tpFade);
  }
}
`;
const FRAG_SPARKLE = /* glsl */ `
if (uTpSparkle > 0.0) {
  vec3 tpV = normalize(vViewPosition);
  float tpS = step(0.9965, tpHash(floor(vTpPos * 22.0) + floor(tpV * 30.0)));
  totalEmissiveRadiance += vec3(1.0, 0.92, 0.8) * tpS * uTpSparkle * (1.0 - smoothstep(10.0, 45.0, length(vViewPosition)));
}
`;

// photo: optional { set: 'sand'|'sandstone'|'rock', scale (1/metres), mix, chroma, bump }
export function detailed(material, { scale = 0.6, strength = 0.35, bump = 0.6, sparkle = 0, photo = null } = {}) {
  const tex = getDetailTexture();
  material.userData.tp = { scale, strength, bump, sparkle };
  const ph = photo && photoSet(photo.set);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTpTex = { value: tex };
    shader.uniforms.uTpScale = { value: scale };
    shader.uniforms.uTpStrength = { value: strength };
    shader.uniforms.uTpBump = { value: bump };
    shader.uniforms.uTpSparkle = { value: sparkle };
    let frag = FRAG_DECL;
    if (ph) {
      frag = '#define USE_PHOTO\n' + frag;
      Object.assign(shader.uniforms, {
        uPhMap: ph.map, uPhNor: ph.nor, uPhMean: ph.mean, uPhLum: ph.lum, uPhOn: ph.on,
        uPhScale: { value: photo.scale ?? 0.5 }, uPhMix: { value: photo.mix ?? 0.6 },
        uPhChroma: { value: photo.chroma ?? 0.3 }, uPhBump: { value: photo.bump ?? 0.8 },
      });
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_DECL)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + frag)
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + FRAG_ALBEDO + (ph ? FRAG_PHOTO_ALBEDO : ''))
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_NORMAL + (ph ? FRAG_PHOTO_NORMAL : ''))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_SPARKLE);
  };
  material.customProgramCacheKey = () => (ph ? 'tp2-' + photo.set : 'tp1');
  return material;
}
