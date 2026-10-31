import * as THREE from 'three';

// GPU-wrapped blowing sand around the camera, plus a CPU particle pool for bursts.

const dustVert = /* glsl */ `
uniform vec3 uCam; uniform vec3 uBox; uniform vec3 uWind; uniform float uTime; uniform float uScale; uniform float uSize;
attribute float aRand;
varying float vA;
void main() {
  vec3 p = position * uBox + uWind * uTime * (0.7 + aRand * 0.6);
  p.y += sin(uTime * 1.3 + aRand * 40.0) * 0.6;
  p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = length(p - uCam);
  vA = (1.0 - smoothstep(uBox.x * 0.25, uBox.x * 0.5, dist)) * smoothstep(3.0, 9.0, dist);
  gl_PointSize = min(uSize * (0.5 + aRand) * uScale / -mv.z, 24.0);
  gl_Position = projectionMatrix * mv;
}`;
const dustFrag = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.0, 0.5, d)) * vA * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}`;

export class DustField {
  constructor(scene, count = 6000) {
    const pos = new Float32Array(count * 3);
    const rnd = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random(); pos[i * 3 + 1] = Math.random(); pos[i * 3 + 2] = Math.random();
      rnd[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
    this.uniforms = {
      uCam: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(90, 26, 90) },
      uWind: { value: new THREE.Vector3(-9, 0, 4) },
      uTime: { value: 0 },
      uScale: { value: 400 },
      uSize: { value: 0.35 },
      uColor: { value: new THREE.Color(0.85, 0.65, 0.42) },
      uOpacity: { value: 0.3 },
    };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: dustVert, fragmentShader: dustFrag,
      transparent: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(time, cam, density, wind, color) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uCam.value.copy(cam);
    u.uOpacity.value = 0.12 + density * 0.55;
    u.uSize.value = 0.1 + density * 0.22;
    u.uWind.value.set(-9 * wind, -0.5 * wind, 4 * wind);
    u.uColor.value.copy(color);
  }

  setScale(px) { this.uniforms.uScale.value = px; }
}

const poolVert = /* glsl */ `
attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
uniform float uScale;
varying float vA; varying vec3 vC;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vA = aAlpha * smoothstep(2.0, 6.0, -mv.z); vC = aColor;
  gl_PointSize = min(aSize * uScale / max(0.1, -mv.z), 90.0);
  gl_Position = projectionMatrix * mv;
}`;
const poolFrag = /* glsl */ `
varying float vA; varying vec3 vC;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = exp(-d * d * 14.0) * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vC, a);
}`;

export class ParticlePool {
  constructor(scene, max = 1500, additive = false) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aAlpha', this.aAlpha);
    g.setAttribute('aColor', this.aCol);
    this.uniforms = { uScale: { value: 400 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: poolVert, fragmentShader: poolFrag,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.active = 0;
  }

  // o: { count, spread:[x,y,z], vel:[x,y,z], velSpread, life, size, grow, color:THREE.Color, gravity, drag, alpha }
  emit(p, o) {
    const n = o.count || 10;
    const sp = o.spread || [0.5, 0.5, 0.5];
    const v = o.vel || [0, 2, 0];
    const vs = o.velSpread ?? 2;
    const c = o.color || new THREE.Color(1, 1, 1);
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * 2 * sp[0];
      this.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * 2 * sp[1];
      this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 2 * sp[2];
      this.vel[i * 3] = v[0] + (Math.random() - 0.5) * 2 * vs;
      this.vel[i * 3 + 1] = v[1] + (Math.random() - 0.5) * 2 * vs;
      this.vel[i * 3 + 2] = v[2] + (Math.random() - 0.5) * 2 * vs;
      const l = (o.life || 1) * (0.7 + Math.random() * 0.6);
      this.life[i] = l; this.maxLife[i] = l;
      this.size[i] = (o.size || 0.5) * (0.7 + Math.random() * 0.6);
      this.grow[i] = o.grow || 0;
      this.grav[i] = o.gravity ?? -4;
      this.drag[i] = o.drag ?? 1;
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
      this.alpha[i] = o.alpha ?? 1;
      this.baseAlpha = this.baseAlpha || new Float32Array(this.max);
      this.baseAlpha[i] = o.alpha ?? 1;
    }
  }

  update(dt) {
    const ba = this.baseAlpha;
    if (!ba) return;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; } continue; }
      this.life[i] -= dt;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d + this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = ba[i] * Math.min(1, t * 2.5) * Math.min(1, (1 - t) * 8 + 0.2);
      if (this.life[i] <= 0) this.alpha[i] = 0;
    }
    this.aPos.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
    this.aCol.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.aAlpha.needsUpdate = true;
  }

  setScale(px) { this.uniforms.uScale.value = px; }
}

const wallVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const wallFrag = /* glsl */ `
uniform float uTime; uniform float uAlpha; uniform vec3 uColor; uniform vec3 uLight;
varying vec2 vUv;
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.0, w = 0.5; for (int i = 0; i < 5; i++) { a += w * vn(p); p = p * 2.02 + 3.1; w *= 0.5; } return a; }
void main() {
  vec2 p = vec2(vUv.x * 16.0, vUv.y * 3.2);
  float n = fbm(p + vec2(uTime * 0.04, -uTime * 0.1));
  float n2 = fbm(p * 2.3 + n * 1.6 + vec2(-uTime * 0.07, 0.0));
  float lobes = fbm(vec2(vUv.x * 9.0 + uTime * 0.02, uTime * 0.03));
  float top = 0.42 + lobes * 0.5;
  float a = (1.0 - smoothstep(top - 0.07, top, vUv.y)) * uAlpha;
  a *= smoothstep(0.0, 0.1, vUv.x) * (1.0 - smoothstep(0.9, 1.0, vUv.x));
  float rim = smoothstep(top - 0.16, top - 0.02, vUv.y);
  vec3 c = mix(uColor * 0.42, uColor * 1.15, pow(n2, 1.4) * (0.5 + 0.5 * vUv.y / top));
  c += uLight * rim * 0.35 * n;
  gl_FragColor = vec4(c, min(1.0, a * (0.85 + 0.3 * n2)));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// The Coriolis storm front: a towering billowing wall of sand that rises on the horizon
// as the runner approaches the storm biome.
// Wormsign: a ridge of sand that travels over a worm swimming just beneath the surface, piles up
// where its back breaks through, and pushes a bow wave ahead of the head. Drawn with the terrain
// material so it reads as the desert floor itself being shouldered aside.
const BOW = 4; // rows extrapolated ahead of the head
export class SandMound {
  constructor(scene, material, rows = 40, across = 13) {
    this.rows = rows + BOW;
    this.across = across;
    const n = this.rows * across;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let r = 0; r < this.rows - 1; r++) {
      for (let a = 0; a < across - 1; a++) {
        const i = r * across + a;
        idx.push(i, i + across, i + 1, i + 1, i + across, i + across + 1);
      }
    }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.bed = new THREE.Color('#a8774c');
    this.crest = new THREE.Color('#d3a271');
    this._c = new THREE.Color();
  }

  // surfaceAt(x, z) -> ground height; strength 0..1 fades the whole effect
  update(model, surfaceAt, strength) {
    const vis = strength > 0.02;
    this.mesh.visible = vis;
    if (!vis) return;
    const pts = model.points, cnt = model.count, R = model.radius, A = this.across;
    const pos = this.mesh.geometry.attributes.position.array;
    const col = this.mesh.geometry.attributes.color.array;
    const uv = this.mesh.geometry.attributes.uv.array;
    const c = this._c;
    for (let row = 0; row < this.rows; row++) {
      const i = row - BOW; // spine index; negative rows run ahead of the head
      const si = Math.max(0, Math.min(cnt, i));
      const a = pts[Math.max(0, si - 1)], b = pts[Math.min(cnt, si + 1)];
      let tx = a.x - b.x, tz = a.z - b.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const sx = -tz, sz = tx; // across the body
      const ahead = Math.max(0, -i) * model.segLen * 0.8;
      const px = pts[si].x + tx * ahead, pz = pts[si].z + tz * ahead;
      const r = R * (1 - Math.pow(si / cnt, 2) * 0.55);
      const halfW = r * 2.7;
      const sL = surfaceAt(px - sx * halfW, pz - sz * halfW), s0 = surfaceAt(px, pz), sR = surfaceAt(px + sx * halfW, pz + sz * halfW);
      const top = pts[si].y + r;
      const depth = s0 - top;
      // buried close under the skin: a swelling ridge; broken through: sand heaped along the flanks
      let h = depth > 0 ? r * 0.6 * Math.max(0, 1 - depth / (r * 2.4)) : r * 0.42;
      if (i < 0) h *= (1 + i / (BOW + 1)) * 0.9; // the bow wave tapers out ahead
      h *= strength * Math.min(1, (cnt - si) / 6); // and toward the buried tail
      for (let k = 0; k < A; k++) {
        const u = (k / (A - 1)) * 2 - 1;
        const bell = Math.exp(-(u * 1.9) * (u * 1.9));
        const ground = u < 0 ? s0 + (sL - s0) * -u : s0 + (sR - s0) * u;
        const y = ground + h * bell - 0.14 * (1 - bell); // feathered edges tuck under the terrain
        const x = px + sx * u * halfW, z = pz + sz * u * halfW;
        const v = row * A + k;
        pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
        c.copy(this.bed).lerp(this.crest, bell * Math.min(1, h / (r * 0.4)) * 0.55);
        col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
        uv[v * 2] = x / 6; uv[v * 2 + 1] = z / 6;
      }
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.uv.needsUpdate = true;
    g.computeVertexNormals();
  }
}

export class StormWall {
  constructor(scene) {
    this.uniforms = {
      uTime: { value: 0 }, uAlpha: { value: 0 },
      uColor: { value: new THREE.Color() }, uLight: { value: new THREE.Color() },
    };
    const g = new THREE.CylinderGeometry(1, 1, 1, 64, 1, true, Math.PI - 1.35, 2.7);
    g.translate(0, 0.5, 0);
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: wallVert, fragmentShader: wallFrag,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }));
    this.mesh.renderOrder = -5;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.storm = new THREE.Color(0.62, 0.38, 0.2);
  }

  // dist: path metres until the storm zone (0 inside it)
  update(time, center, yaw, dist, horizon, day) {
    const k = dist <= 0 ? 0 : (1 - smoothstep(120, 950, dist));
    const u = this.uniforms;
    u.uAlpha.value = Math.min(1, k * 1.3);
    this.mesh.visible = k > 0.01;
    if (!this.mesh.visible) return;
    const r = 260 + 560 * smoothstep(0, 950, dist);
    this.mesh.scale.set(r, r * 0.62, r);
    this.mesh.position.set(center.x, -25, center.z);
    this.mesh.rotation.y = yaw;
    u.uTime.value = time;
    u.uColor.value.copy(this.storm).multiplyScalar(0.2 + 0.42 * day).lerp(horizon, 0.08);
    u.uLight.value.copy(horizon);
  }
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
