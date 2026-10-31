import * as THREE from 'three';

// Screen-space passes for the high-quality post chain (see systems/render.js).
// Heat shimmer around the horizon band on hot, clear days.
export const SHIMMER = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAmt: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uAmt; varying vec2 vUv;
    void main() {
      // heat haze only on the far horizon band, well above the runner and the road ahead
      float band = smoothstep(0.5, 0.57, vUv.y) * (1.0 - smoothstep(0.62, 0.7, vUv.y));
      float o = sin(vUv.y * 230.0 + uTime * 4.0) * 0.00035 + sin(vUv.y * 97.0 - uTime * 2.5 + vUv.x * 31.0) * 0.00025;
      gl_FragColor = texture2D(tDiffuse, vUv + vec2(o, o * 0.4) * band * uAmt);
    }`,
};

// Crepuscular rays: march from each pixel toward the sun's screen position, gathering the
// bright sky near the sun, so dunes, ruins and the runner cut shafts through the haze.
export const SUNSHAFTS = {
  uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.7) }, uStrength: { value: 0 }, uColor: { value: new THREE.Color(1, 0.8, 0.55) } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uStrength; uniform vec3 uColor; varying vec2 vUv;
    float bright(vec2 uv) {
      vec3 c = texture2D(tDiffuse, uv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      return smoothstep(0.85, 2.0, l) * exp(-length((uv - uSun) * vec2(1.6, 1.0)) * 2.2);
    }
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uStrength <= 0.001) { gl_FragColor = base; return; }
      vec2 step = (vUv - uSun) / 40.0 * 0.9;
      vec2 uv = vUv;
      float decay = 1.0, acc = 0.0;
      float dither = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
      uv -= step * dither;
      for (int i = 0; i < 40; i++) {
        uv -= step;
        acc += bright(uv) * decay;
        decay *= 0.955;
      }
      gl_FragColor = vec4(base.rgb + uColor * acc * (uStrength / 40.0) * 5.0, base.a);
    }`,
};

// Final display-space grade: gentle S-curve, warm highlights / cool shadows, lens fringe, grain.
export const GRADE = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uWarm: { value: 1 }, uNight: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uWarm; uniform float uNight; varying vec2 vUv;
    void main() {
      // faint lens fringing toward the frame edges
      vec2 dc = vUv - 0.5;
      float ca = dot(dc, dc) * 0.006;
      vec3 c = vec3(texture2D(tDiffuse, vUv + dc * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - dc * ca).b);
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.28);
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      vec3 mono = l * mix(vec3(1.08, 0.96, 0.8), vec3(0.78, 0.9, 1.08), uNight);
      c = mix(mono, c, mix(0.62, 0.5, uNight));
      c = c * 0.93 + vec3(0.035, 0.03, 0.028);
      c += uWarm * (vec3(0.025, 0.008, -0.02) * smoothstep(0.45, 1.0, l) + vec3(-0.008, 0.0, 0.018) * (1.0 - smoothstep(0.0, 0.35, l)));
      float n = fract(sin(dot(vUv * 1000.0 + fract(uTime) * 91.0, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * 0.022;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};
