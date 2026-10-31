import * as THREE from 'three';
import { smoothstep, lerp } from './noise.js';

// Sky dome with day/night cycle, sun, two moons and stars; drives lights and fog.

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const frag = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMoon1;
uniform vec3 uMoon2;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform float uStars;
uniform float uTime;
uniform float uHaze;
uniform float uSunVis;
uniform float uDay;
uniform float uCloud;
varying vec3 vDir;

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(vhash(i), vhash(i + vec2(1.0, 0.0)), f.x), mix(vhash(i + vec2(0.0, 1.0)), vhash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm2(vec2 p) {
  float a = 0.0, w = 0.5;
  for (int i = 0; i < 5; i++) { a += w * vnoise(p); p = p * 2.03 + vec2(17.1, 9.3); w *= 0.5; }
  return a;
}
// integer frequencies so the silhouette wraps seamlessly around the horizon
float ridgeH(float a, float s) {
  float h = 0.5 * sin(a * 3.0 + s);
  h += 0.28 * sin(a * 7.0 + s * 2.1 + sin(a * 2.0) * 0.8);
  h += 0.14 * abs(sin(a * 17.0 + s * 3.7));
  h += 0.07 * abs(sin(a * 41.0 + s * 1.3));
  h += 0.035 * abs(sin(a * 97.0 + s * 5.1));
  return h * 0.5 + 0.5;
}

vec3 moon(vec3 d, vec3 md, float size, vec3 tint, vec3 col) {
  float c = dot(d, md);
  float disk = smoothstep(size, size + 0.00015, c);
  vec3 lit = tint * (0.75 + 0.25 * hash(floor(d * 900.0)));
  float glow = pow(max(c, 0.0), 400.0) * 0.25;
  return mix(col, lit, disk * uStars) + tint * glow * uStars;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.38));
  col = mix(col, uHorizon * 0.85, (1.0 - smoothstep(-0.25, 0.0, h)));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 6.0) * 0.28 + pow(sd, 60.0) * 0.6) * uSunVis;
  col += uSunColor * smoothstep(0.9994, 0.99965, sd) * 6.0 * uSunVis;
  if (uStars > 0.01) {
    vec3 sp = d * 260.0;
    vec3 cell = floor(sp);
    float r = hash(cell);
    float star = step(0.993, r) * (1.0 - smoothstep(0.0, 0.35, length(fract(sp) - 0.5)));
    col += vec3(0.9, 0.95, 1.0) * star * uStars * smoothstep(0.0, 0.25, h) * (0.6 + 0.4 * sin(uTime * 2.0 + r * 80.0));
    col = moon(d, uMoon1, 0.99935, vec3(1.15, 1.1, 1.0), col);
    col = moon(d, uMoon2, 0.99975, vec3(0.9, 1.0, 1.15), col);
  }

  // wind-streaked cirrus
  if (h > 0.0 && uCloud > 0.01) {
    vec2 uv = d.xz / (h + 0.12) * 1.2 + vec2(uTime * 0.006, uTime * 0.0025);
    vec2 st = vec2(uv.x * 0.55 + uv.y * 0.25, uv.y * 1.7);
    float n = fbm2(st * 1.3);
    float n2 = fbm2(st * 4.2 + n * 2.0);
    float c = smoothstep(0.6, 0.92, n * 0.72 + n2 * 0.38) * uCloud * smoothstep(0.0, 0.16, h);
    vec3 lit = mix(vec3(1.0, 0.97, 0.92), uSunColor, 0.45);
    vec3 cc = mix(uHorizon * 1.05, lit, 0.5 + 0.3 * n2);
    cc += uSunColor * pow(sd, 5.0) * 0.7 * uSunVis;
    cc *= mix(0.22, 1.0, uDay);
    col = mix(col, cc, c * 0.8);
  }

  // two hazy mountain ranges on the horizon
  float az = atan(d.z, d.x);
  vec3 hz = normalize(vec3(d.x, 0.0001, d.z));
  vec3 sz = normalize(vec3(uSunDir.x, 0.0001, uSunDir.z));
  float rim = pow(max(dot(hz, sz), 0.0), 6.0) * 0.18 * uSunVis * uDay;
  vec3 rock = mix(uHorizon, uZenith, 0.25) * vec3(0.92, 0.82, 0.8);
  float e1 = 0.01 + ridgeH(az, 1.0) * 0.055;
  float m1 = 1.0 - smoothstep(e1 - 0.0012, e1, h);
  vec3 far = mix(rock, uHorizon, 0.55 + 0.35 * (1.0 - smoothstep(-0.01, e1, h))) + uSunColor * rim;
  col = mix(col, far, m1);
  float e2 = -0.004 + ridgeH(az + 1.3, 4.0) * 0.032;
  float m2 = 1.0 - smoothstep(e2 - 0.0012, e2, h);
  vec3 near = mix(rock * 0.82, uHorizon, 0.3 + 0.45 * (1.0 - smoothstep(-0.01, e2, h))) + uSunColor * rim * 1.4;
  col = mix(col, near, m2);

  col = mix(col, uHorizon, uHaze * (1.0 - smoothstep(-0.1, 0.9, h) * 0.5));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Ground-hugging aerial haze: replaces three's fog chunks so every material gets
// distance fog that thickens in dune valleys and thins on high ground.
export function installHeightFog() {
  const SC = THREE.ShaderChunk;
  SC.fog_pars_vertex = '#ifdef USE_FOG\n  varying float vFogDepth;\n  varying vec3 vFogWorld;\n#endif';
  SC.fog_vertex = '#ifdef USE_FOG\n  vFogDepth = - mvPosition.z;\n  vFogWorld = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;\n#endif';
  SC.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  SC.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  float fogH = exp( - max( vFogWorld.y + 2.0, 0.0 ) * 0.03 );
  float fogGround = ( 1.0 - exp( - vFogDepth * 0.004 ) ) * fogH * 0.32;
  fogFactor = clamp( max( fogFactor * mix( 0.8, 1.0, fogH ), fogGround ), 0.0, 1.0 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
}

const C = (r, g, b) => new THREE.Color(r, g, b);
const PAL = {
  dayZenith: C(0.05, 0.17, 0.52),
  dayHorizon: C(0.98, 0.74, 0.5),
  setZenith: C(0.22, 0.16, 0.34),
  setHorizon: C(1.0, 0.42, 0.16),
  nightZenith: C(0.035, 0.05, 0.12),
  nightHorizon: C(0.2, 0.18, 0.28),
  sunDay: C(1.0, 0.88, 0.7),
  sunSet: C(1.0, 0.45, 0.2),
  moonLight: C(0.45, 0.55, 0.9),
  storm: C(0.78, 0.5, 0.27),
};

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoon1: { value: new THREE.Vector3(-0.45, 0.42, -0.78).normalize() },
      uMoon2: { value: new THREE.Vector3(0.3, 0.28, -0.9).normalize() },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uStars: { value: 0 },
      uTime: { value: 0 },
      uHaze: { value: 0 },
      uSunVis: { value: 1 },
      uDay: { value: 1 },
      uCloud: { value: 0.6 },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(1500, 32, 16),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag, side: THREE.BackSide, depthWrite: false, fog: false })
    );
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xb07a48, 0.8);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = false;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 220;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    scene.fog = new THREE.Fog(0xffffff, 80, 600);
    this.cycle = 0.29; // 0.25 = noon, 0.5 = sunset
    this.cycleLength = 320;
    this.night = 0;
    this.flash = 0;
    this.horizon = new THREE.Color();
    this._sunDir = new THREE.Vector3();
    this._storm = new THREE.Color();
  }

  setShadows(on) { this.sun.castShadow = on; }

  update(dt, center, atmo, time) {
    this.cycle = (this.cycle + (dt / this.cycleLength) * (this.night > 0.5 ? 1.8 : 1)) % 1;
    const a = this.cycle * Math.PI * 2;
    const sunDir = this._sunDir.set(Math.cos(a) * 0.8, Math.sin(a), -0.45).normalize();
    const el = sunDir.y;
    const day = smoothstep(-0.12, 0.25, el);
    const sunset = Math.exp(-(((el - 0.04) / 0.13) ** 2));
    const night = 1 - smoothstep(-0.28, -0.02, el);
    this.night = night;

    const u = this.uniforms;
    u.uSunDir.value.copy(sunDir);
    u.uZenith.value.copy(PAL.nightZenith).lerp(PAL.dayZenith, day).lerp(PAL.setZenith, sunset * 0.55);
    const hor = u.uHorizon.value.copy(PAL.nightHorizon).lerp(PAL.dayHorizon, day).lerp(PAL.setHorizon, sunset * 0.8);
    hor.r *= atmo.tint[0]; hor.g *= atmo.tint[1]; hor.b *= atmo.tint[2];
    hor.lerp(this._storm.copy(PAL.storm).multiplyScalar(0.3 + 0.7 * day), atmo.haze * 0.75);
    u.uSunColor.value.copy(PAL.sunDay).lerp(PAL.sunSet, sunset);
    u.uStars.value = night * (1 - atmo.haze);
    u.uHaze.value = atmo.haze;
    u.uSunVis.value = 1 - atmo.haze * 0.85;
    u.uDay.value = day;
    u.uCloud.value = 0.55 * (1 - atmo.haze * 0.85);
    u.uTime.value = time;
    if (this.flash > 0) {
      hor.lerp(C(1.4, 1.35, 1.5), this.flash * 0.6);
      this.flash = Math.max(0, this.flash - dt * 3.5);
    }
    this.horizon.copy(hor);

    this.dome.position.copy(center);
    const fog = this.scene.fog;
    fog.color.copy(hor);
    fog.near = atmo.fogNear;
    fog.far = atmo.fogFar;

    // key light: sun by day, first moon by night
    const useSun = el > -0.06;
    const ldir = useSun ? sunDir : u.uMoon1.value;
    const sunI = smoothstep(-0.06, 0.12, el) * 3.1;
    const moonI = night * 1.05;
    this.sun.intensity = (useSun ? sunI : moonI) * (1 - atmo.haze * 0.6) + this.flash * 4;
    this.sun.color.copy(useSun ? u.uSunColor.value : PAL.moonLight);
    this.sun.position.copy(center).addScaledVector(ldir, 120);
    this.sun.target.position.copy(center);

    this.hemi.color.copy(u.uZenith.value).lerp(hor, 0.5).multiplyScalar(1.2).lerp(PAL.moonLight, night * 0.35);
    this.hemi.groundColor.setRGB(0.55, 0.36, 0.2).multiplyScalar(lerp(0.35, 1, day));
    this.hemi.intensity = lerp(0.9, 1.3, day) + night * 0.5 + atmo.haze * 0.6 + this.flash * 2;
  }
}
