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

export function detailed(material, { scale = 0.6, strength = 0.35, bump = 0.6, sparkle = 0 } = {}) {
  const tex = getDetailTexture();
  material.userData.tp = { scale, strength, bump, sparkle };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTpTex = { value: tex };
    shader.uniforms.uTpScale = { value: scale };
    shader.uniforms.uTpStrength = { value: strength };
    shader.uniforms.uTpBump = { value: bump };
    shader.uniforms.uTpSparkle = { value: sparkle };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_DECL)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + FRAG_ALBEDO)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_NORMAL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_SPARKLE);
  };
  material.customProgramCacheKey = () => 'tp1';
  return material;
}
