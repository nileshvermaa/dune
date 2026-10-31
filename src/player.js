import * as THREE from 'three';
import { damp } from './noise.js';
import { limb, lathe, rbox, M, merge, displace } from './geom.js';
import { makeHookProp } from './props.js';

// Fremen runner: tapered anatomy, ribbed stillsuit, harness and belt kit, hood and mantle with
// breathing tubes. A gait-cycle animator drives the skeleton; the cloak and scarf tails are
// verlet cloth simulated in the runner's frame, so they answer real motion (lane changes,
// jumps, landings, corners) instead of looping.

const TAU = Math.PI * 2;
// smooth periodic pulse centred on phase c with width w
const bump = (th, c, w) => {
  let d = (((th - c) % TAU) + TAU) % TAU;
  if (d > Math.PI) d -= TAU;
  return Math.exp(-(d * d) / (2 * w * w));
};
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const mix = (a, b, t) => a + (b - a) * t;

const shieldVert = /* glsl */ `
varying vec3 vN; varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const shieldFrag = /* glsl */ `
uniform float uTime; uniform float uAlpha;
varying vec3 vN; varying vec3 vV;
void main() {
  float f = pow(1.0 - abs(dot(vN, vV)), 2.5);
  float bands = 0.5 + 0.5 * sin(vN.y * 30.0 + uTime * 6.0);
  vec3 c = vec3(0.35, 0.7, 1.6) * (f * 1.6 + bands * 0.08);
  gl_FragColor = vec4(c, (f * 0.9 + 0.05) * uAlpha);
}`;

function ribs(r, y0, y1, n, sz = 1) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    parts.push([new THREE.TorusGeometry(r(t), 0.009, 5, 20), null, M(0, y0 + (y1 - y0) * t, 0, Math.PI / 2, 0, 0, 1, sz, 1)]);
  }
  return parts;
}

/* ---------------- verlet cloth ---------------- */

class Verlet {
  constructor(count) {
    this.n = count;
    this.p = new Float32Array(count * 3);
    this.q = new Float32Array(count * 3); // previous positions
    this.pin = new Int8Array(count);
    this.cons = []; // [a, b, rest, stiffness]
  }
  link(a, b, k = 1) {
    const p = this.p;
    const rest = Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
    this.cons.push(a, b, rest, k);
  }
  settle() { this.q.set(this.p); }
  // rotate every point about the frame's vertical axis (the runner turned under the cloth)
  yaw(a) {
    const c = Math.cos(a), s = Math.sin(a);
    for (const arr of [this.p, this.q]) {
      for (let i = 0; i < this.n; i++) {
        const x = arr[i * 3], z = arr[i * 3 + 2];
        arr[i * 3] = x * c + z * s;
        arr[i * 3 + 2] = -x * s + z * c;
      }
    }
  }
  integrate(h, force, drag) {
    const p = this.p, q = this.q, h2 = h * h;
    const f = this._f || (this._f = new THREE.Vector3());
    for (let i = 0; i < this.n; i++) {
      if (this.pin[i]) continue;
      const k = i * 3;
      const vx = (p[k] - q[k]) / h, vy = (p[k + 1] - q[k + 1]) / h, vz = (p[k + 2] - q[k + 2]) / h;
      force(i, f);
      // linear air drag toward the local wind (already in f.wind via force callback)
      const ax = f.x - vx * drag, ay = f.y - vy * drag, az = f.z - vz * drag;
      q[k] = p[k]; q[k + 1] = p[k + 1]; q[k + 2] = p[k + 2];
      p[k] += vx * h * 0.996 + ax * h2;
      p[k + 1] += vy * h * 0.996 + ay * h2;
      p[k + 2] += vz * h * 0.996 + az * h2;
    }
  }
  solve(iters) {
    const p = this.p, c = this.cons, pin = this.pin;
    for (let it = 0; it < iters; it++) {
      for (let j = 0; j < c.length; j += 4) {
        const a = c[j] * 3, b = c[j + 1] * 3;
        const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = ((d - c[j + 2]) / d) * c[j + 3];
        const wa = pin[c[j]] ? 0 : 1, wb = pin[c[j + 1]] ? 0 : 1;
        const ws = wa + wb;
        if (!ws) continue;
        const sa = (wa / ws) * diff, sb = (wb / ws) * diff;
        p[a] += dx * sa; p[a + 1] += dy * sa; p[a + 2] += dz * sa;
        p[b] -= dx * sb; p[b + 1] -= dy * sb; p[b + 2] -= dz * sb;
      }
    }
  }
}

export class Runner {
  constructor() {
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);

    const suit = new THREE.MeshStandardMaterial({ color: '#5a4a3d', roughness: 0.6, metalness: 0.12 });
    const suitDark = new THREE.MeshStandardMaterial({ color: '#3f342c', roughness: 0.65, metalness: 0.1 });
    const rib = new THREE.MeshStandardMaterial({ color: '#7d6853', roughness: 0.45, metalness: 0.25 });
    const leather = new THREE.MeshStandardMaterial({ color: '#6c472b', roughness: 0.7 });
    const metal = new THREE.MeshStandardMaterial({ color: '#b8925a', roughness: 0.35, metalness: 0.9 });
    const clothDark = new THREE.MeshPhysicalMaterial({ color: '#6b4c32', roughness: 0.95, sheen: 0.8, sheenColor: new THREE.Color('#c99a6a'), sheenRoughness: 0.6, side: THREE.DoubleSide });
    const hoodCloth = new THREE.MeshPhysicalMaterial({ color: '#8a6b4b', roughness: 0.95, sheen: 0.6, sheenColor: new THREE.Color('#e0b585'), sheenRoughness: 0.7, side: THREE.DoubleSide });
    const skin = new THREE.MeshStandardMaterial({ color: '#a97b58', roughness: 0.6 });
    const sole = new THREE.MeshStandardMaterial({ color: '#1d1714', roughness: 0.9 });
    const bone = new THREE.MeshStandardMaterial({ color: '#efe6d2', roughness: 0.35, emissive: '#2a241c' });

    const add = (parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    const ribMesh = (parent, parts) => {
      const m = new THREE.Mesh(merge(parts), rib);
      m.castShadow = false;
      parent.add(m);
      return m;
    };

    // body (translation) -> pivot at the hip joint (whole-body tilt / lean) -> hips (pelvis yaw / roll)
    this.pivot = new THREE.Group();
    this.pivot.position.y = 0.95;
    this.body.add(this.pivot);
    const hips = new THREE.Group();
    this.pivot.add(hips);
    this.hips = hips;

    /* ---- pelvis & belt ---- */
    add(hips, new THREE.SphereGeometry(0.16, 20, 14), suit, 0, -0.01, 0).scale.set(1, 0.74, 0.8);
    add(hips, new THREE.TorusGeometry(0.158, 0.03, 8, 28), leather, 0, 0.07, 0, Math.PI / 2).scale.set(1, 0.8, 1);
    add(hips, rbox(0.075, 0.06, 0.03, 0.01), metal, 0, 0.07, -0.13);
    add(hips, rbox(0.09, 0.085, 0.05, 0.018), leather, -0.12, 0.03, -0.075, 0, 0.5);
    add(hips, rbox(0.09, 0.085, 0.05, 0.018), leather, 0.12, 0.03, -0.075, 0, -0.5);
    add(hips, rbox(0.13, 0.09, 0.06, 0.018), leather, 0, 0.03, 0.135);
    for (const side of [-1, 1]) add(hips, new THREE.CylinderGeometry(0.03, 0.03, 0.1, 10), leather, side * 0.15, 0.0, 0.08, 0.2, 0, 0);
    // crysknife at the left hip
    const knife = new THREE.Group();
    knife.position.set(-0.165, 0.0, 0.02);
    knife.rotation.set(0.25, 0, 0.18);
    hips.add(knife);
    add(knife, new THREE.CylinderGeometry(0.022, 0.012, 0.24, 8), leather, 0, -0.1, 0);
    add(knife, new THREE.CylinderGeometry(0.015, 0.018, 0.09, 8), bone, 0, 0.06, 0);
    add(knife, new THREE.SphereGeometry(0.022, 8, 6), bone, 0, 0.11, 0);
    this.hipKit = hips.children.slice(1); // belt, pouches, knife: worn over the skinned body too

    /* ---- legs: thigh 0.43, shin 0.42, ankle 0.10 above the sole ---- */
    this.legs = [];
    for (const side of [-1, 1]) {
      const thigh = new THREE.Group();
      thigh.position.set(side * 0.092, -0.03, 0);
      add(thigh, new THREE.SphereGeometry(0.085, 14, 10), suit, 0, 0, 0);
      add(thigh, limb(0.084, 0.058, 0.39, 0.014, 14), suit);
      ribMesh(thigh, ribs((t) => 0.082 - t * 0.018, -0.1, -0.34, 3));
      if (side > 0) add(thigh, rbox(0.06, 0.1, 0.07, 0.018), leather, 0.072, -0.17, -0.01);
      add(thigh, new THREE.TorusGeometry(0.084, 0.012, 6, 16), leather, 0, -0.12, 0, Math.PI / 2);
      const knee = new THREE.Group();
      knee.position.y = -0.43;
      add(knee, new THREE.SphereGeometry(0.058, 12, 10), suit);
      add(knee, new THREE.SphereGeometry(0.05, 10, 8), rib, 0, 0.005, -0.038).scale.set(1, 1.1, 0.6);
      add(knee, limb(0.058, 0.04, 0.36, 0.018, 14), suit);
      ribMesh(knee, ribs((t) => 0.062 - t * 0.02, -0.08, -0.28, 3));
      // boot shaft wrap
      add(knee, new THREE.CylinderGeometry(0.056, 0.05, 0.16, 14), leather, 0, -0.33, 0);
      add(knee, new THREE.TorusGeometry(0.057, 0.01, 6, 16), suitDark, 0, -0.26, 0, Math.PI / 2);
      const foot = new THREE.Group();
      foot.position.y = -0.42;
      knee.add(foot);
      const boot = add(foot, new THREE.CapsuleGeometry(0.052, 0.13, 4, 12), suitDark, 0, -0.058, -0.05, Math.PI / 2);
      boot.scale.set(1.1, 1, 0.8);
      add(foot, rbox(0.115, 0.022, 0.25, 0.01), sole, 0, -0.09, -0.05);
      add(foot, new THREE.SphereGeometry(0.05, 12, 8), leather, 0, -0.03, -0.12).scale.set(1.05, 0.75, 1.1);
      add(foot, rbox(0.11, 0.018, 0.04, 0.008), leather, 0, -0.035, -0.04, 0.3);
      thigh.add(knee);
      hips.add(thigh);
      this.legs.push({ thigh, knee, foot, side });
    }

    /* ---- torso ---- */
    const torso = new THREE.Group();
    torso.position.y = 0.06;
    hips.add(torso);
    this.torso = torso;
    const chest = add(torso, lathe([[0.001, -0.02], [0.13, 0.0], [0.145, 0.1], [0.18, 0.25], [0.19, 0.34], [0.168, 0.42], [0.1, 0.47], [0.05, 0.5], [0.001, 0.5]], 24), suit);
    chest.scale.set(1, 1, 0.72);
    ribMesh(torso, ribs((t) => 0.148 + t * 0.035, 0.07, 0.29, 4, 0.72));
    const kitFrom = torso.children.length;
    add(torso, rbox(0.2, 0.16, 0.04, 0.02), rib, 0, 0.3, -0.12);
    add(torso, rbox(0.012, 0.3, 0.012, 0.005), suitDark, 0, 0.17, -0.128);
    for (const side of [-1, 1]) {
      add(torso, rbox(0.035, 0.48, 0.012, 0.005), leather, side * 0.06, 0.27, -0.136, 0, 0, side * 0.42);
      add(torso, rbox(0.035, 0.48, 0.012, 0.005), leather, side * 0.06, 0.27, 0.136, 0, 0, -side * 0.42);
    }
    add(torso, new THREE.CylinderGeometry(0.03, 0.03, 0.015, 14), metal, 0, 0.27, -0.144, Math.PI / 2);
    // catchpocket reservoir and breathing tubes
    add(torso, rbox(0.24, 0.26, 0.08, 0.03, 2), leather, 0, 0.28, 0.15);
    add(torso, rbox(0.18, 0.04, 0.085, 0.012), metal, 0, 0.17, 0.155);
    for (const side of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.08, 0.38, 0.18), new THREE.Vector3(side * 0.12, 0.5, 0.12),
        new THREE.Vector3(side * 0.11, 0.56, -0.02), new THREE.Vector3(side * 0.06, 0.6, -0.1),
      ]);
      add(torso, new THREE.TubeGeometry(curve, 16, 0.012, 6, false), rib);
    }
    add(torso, new THREE.TorusGeometry(0.06, 0.018, 8, 18), rib, 0, 0.5, 0, Math.PI / 2);
    this.torsoKit = torso.children.slice(kitFrom); // chest plate, harness, reservoir, tubes, collar
    // the skinned body's suit: matte woven stillsuit, a touch warmer than the procedural one
    const skinSuit = new THREE.MeshStandardMaterial({ color: '#5c4a3b', roughness: 0.72, metalness: 0.06 });
    this.suitMats = { suit, suitDark, rib, leather, skinSuit };

    /* ---- head, hood & mantle ---- */
    const head = new THREE.Group();
    head.position.y = 0.6;
    torso.add(head);
    this.head = head;
    add(head, new THREE.SphereGeometry(0.105, 20, 16), skin, 0, 0.02, 0).scale.set(0.95, 1.08, 1);
    // hood: open toward -z, a little long at the back so it reads as cloth, not a helmet
    const hoodGeo = new THREE.SphereGeometry(0.14, 32, 20, Math.PI * 1.5 + Math.PI * 0.2, Math.PI * 1.6, 0, Math.PI * 0.78);
    displace(hoodGeo, (x, y, z, o) => {
      const a = Math.atan2(x, z);
      const back = Math.max(0, z / 0.14);
      // soft folds radiating from the crown, and a back that drapes lower
      const fold = Math.sin(a * 9 + y * 18) * 0.006 * (1 - y / 0.14);
      const r = Math.hypot(x, y, z) || 1;
      o.set((x / r) * fold, -Math.max(0, -y) * back * 0.35, (z / r) * fold);
    });
    const hood = add(head, hoodGeo, hoodCloth, 0, 0.03, 0.016);
    hood.rotation.x = -0.12;
    hood.scale.set(0.94, 0.98, 1.02);
    // mantle: drapes from the neck over the shoulders and back, open at the chest
    const mantleProfile = [[0.09, 0.0], [0.1, -0.05], [0.15, -0.11], [0.215, -0.16], [0.25, -0.19], [0.255, -0.215]].map(([r, y]) => new THREE.Vector2(r, y));
    const mantle = add(head, new THREE.LatheGeometry(mantleProfile, 28, -Math.PI * 0.68, Math.PI * 1.36), hoodCloth, 0, -0.05, 0.015);
    mantle.scale.set(1.02, 1, 0.8);
    // mask, nose plugs, mouth tube
    add(head, new THREE.SphereGeometry(0.112, 20, 10, Math.PI * 1.5 - Math.PI * 0.4, Math.PI * 0.8, Math.PI * 0.52, Math.PI * 0.3), suitDark, 0, 0.005, 0);
    // face veil over the mask, a small mouth valve, nose-plug tubes running back to the suit
    add(head, new THREE.SphereGeometry(0.118, 20, 8, Math.PI * 1.5 - Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.55, Math.PI * 0.28), hoodCloth, 0, 0.0, 0.002);
    add(head, new THREE.CylinderGeometry(0.016, 0.02, 0.025, 10), rib, 0.02, -0.05, -0.113, Math.PI / 2);
    const eyeMat = new THREE.MeshStandardMaterial({ color: '#173a5c', emissive: '#2f86d6', emissiveIntensity: 0.55, roughness: 0.2 });
    for (const side of [-1, 1]) {
      const tube = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.014, 0.0, -0.104), new THREE.Vector3(side * 0.06, -0.01, -0.09),
        new THREE.Vector3(side * 0.1, -0.04, -0.03), new THREE.Vector3(side * 0.09, -0.1, 0.03),
      ]);
      add(head, new THREE.TubeGeometry(tube, 10, 0.005, 5, false), rib);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 10, 8), eyeMat);
      eye.position.set(side * 0.034, 0.036, -0.097);
      head.add(eye);
    }
    // nose and brow ridge give the face some relief
    add(head, new THREE.ConeGeometry(0.012, 0.03, 8), skin, 0, 0.018, -0.105, -1.35);
    add(head, new THREE.CapsuleGeometry(0.009, 0.07, 3, 8), skin, 0, 0.052, -0.095, 0, 0, Math.PI / 2);

    /* ---- arms ---- */
    this.arms = [];
    for (const side of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(side * 0.2, 0.41, 0);
      add(sh, new THREE.SphereGeometry(0.07, 14, 10), suit, 0, 0.005, 0);
      add(sh, new THREE.SphereGeometry(0.078, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), clothDark, 0, 0.0, 0).scale.set(1, 0.75, 1.05);
      add(sh, limb(0.058, 0.045, 0.26, 0.01), suit);
      ribMesh(sh, ribs((t) => 0.056 - t * 0.01, -0.07, -0.22, 3));
      const el = new THREE.Group();
      el.position.y = -0.29;
      add(el, new THREE.SphereGeometry(0.046, 10, 8), suit);
      add(el, limb(0.046, 0.034, 0.22, 0.008), suit);
      add(el, new THREE.CylinderGeometry(0.05, 0.043, 0.13, 12), leather, 0, -0.155, 0);
      const hand = new THREE.Group();
      hand.position.y = -0.265;
      el.add(hand);
      add(hand, new THREE.SphereGeometry(0.042, 12, 10), leather, 0, -0.045, 0).scale.set(0.78, 1.1, 0.62);
      add(hand, new THREE.SphereGeometry(0.034, 10, 8), leather, 0, -0.085, -0.014).scale.set(0.8, 0.7, 0.75);
      add(hand, new THREE.CapsuleGeometry(0.012, 0.03, 3, 6), leather, side * -0.03, -0.045, -0.02, 0.5, 0, side * 0.6);
      sh.add(el);
      torso.add(sh);
      this.arms.push({ sh, el, hand, side });
    }

    /* ---- cloak (verlet) ---- */
    this.buildCloak();
    this.buildScarves(clothDark);

    this.shield = new THREE.Mesh(
      new THREE.SphereGeometry(1.25, 32, 20),
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 } },
        vertexShader: shieldVert, fragmentShader: shieldFrag,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      })
    );
    this.shield.position.y = 0.95;
    this.shield.visible = false;
    this.root.add(this.shield);

    this.phase = 0;
    this.time = 0;
    this.r = {};
    this.mode = 'idle';
    this.modeT = 0;
    this.land = 0;
    this.lead = 1;
    this.kin = { ready: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), acc: new THREE.Vector3(), yaw: 0 };
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._inv = new THREE.Matrix4();
    this._tInv = new THREE.Matrix4();
    this.colliders = Array.from({ length: 8 }, () => new THREE.Vector3());
    // frames the cloth hangs from; attachRig() swaps them for proxies on the skinned body
    this.clothTorso = this.torso;
    this.clothHead = this.head;
    this.rig = null;
    this.landT = 0;
    this.hands = this.arms.map((a) => a.hand);
    this.buildHooks();
  }

  // maker hooks: crossed on the back while carried, one in each fist while riding
  buildHooks() {
    if (this.hooks) for (const h of [this.hooks.back, ...this.hooks.held]) h.parent && h.parent.remove(h);
    const back = new THREE.Group();
    for (const side of [-1, 1]) {
      const h = makeHookProp();
      h.rotation.z = side * 0.42;
      h.position.x = side * 0.05;
      h.castShadow = true;
      back.add(h);
    }
    back.position.set(0, 0.32, 0.22);
    this.clothTorso.add(back);
    const held = this.hands.map((hand, i) => {
      const h = makeHookProp();
      h.castShadow = true;
      h.scale.setScalar(this.rig ? 1 / 0.96 : 1);
      if (this.rig) { h.position.set(0, 0.09, 0); h.rotation.set(0, 0, 0); }
      else { h.position.set(0, -0.07, 0); h.rotation.set(Math.PI, 0, 0); }
      hand.add(h);
      return h;
    });
    this.hooks = { back, held, count: -1, riding: null };
    this.setHooks(0, false);
  }

  setHooks(count, riding) {
    const H = this.hooks;
    if (H.count === count && H.riding === riding) return;
    H.count = count;
    H.riding = riding;
    H.back.visible = count > 0 && !riding;
    H.back.children[1].visible = count > 0;
    for (const h of H.held) h.visible = riding;
  }

  buildCloak() {
    const C = 11, R = 14, LEN = 1.02;
    this.cloakC = C; this.cloakR = R;
    this.cloakAnchors = [];
    // rest shape in torso space: an arc across the back of the shoulders, widening toward the hem
    this.cloakRest = (i, j, out) => {
      const u = (i / (C - 1)) * 2 - 1;
      const a = u * (1.72 + (j / (R - 1)) * 0.12);
      const r = 0.2 + (j / (R - 1)) * 0.11;
      return out.set(Math.sin(a) * r * 1.05, 0.47 - (j / (R - 1)) * LEN, Math.cos(a) * r * 0.8 + 0.03);
    };
    const cl = (this.cloth = new Verlet(C * R));
    const v = new THREE.Vector3();
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < C; i++) {
        const k = j * C + i;
        this.cloakRest(i, j, v);
        cl.p.set([v.x, v.y, v.z], k * 3);
        if (j === 0) { cl.pin[k] = 1; this.cloakAnchors.push(v.clone()); }
      }
    }
    const id = (i, j) => j * C + i;
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < C; i++) {
        if (i < C - 1) cl.link(id(i, j), id(i + 1, j), 1);
        if (j < R - 1) cl.link(id(i, j), id(i, j + 1), 1);
        if (i < C - 1 && j < R - 1) { cl.link(id(i, j), id(i + 1, j + 1), 0.6); cl.link(id(i + 1, j), id(i, j + 1), 0.6); }
        if (j < R - 2) cl.link(id(i, j), id(i, j + 2), 0.35);
        if (i < C - 2) cl.link(id(i, j), id(i + 2, j), 0.25);
      }
    }
    cl.settle();

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(C * R * 3), 3));
    const colors = new Float32Array(C * R * 3);
    const top = new THREE.Color('#7d5d40'), hem = new THREE.Color('#b8956b'), c = new THREE.Color();
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < C; i++) {
        const t = j / (R - 1);
        c.copy(top).lerp(hem, t * t);
        // dusty, sun-bleached edges
        const edge = Math.abs((i / (C - 1)) * 2 - 1);
        c.multiplyScalar(1 + edge * 0.06 - (j % 2) * 0.015);
        colors.set([c.r, c.g, c.b], (j * C + i) * 3);
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const idx = [];
    for (let j = 0; j < R - 1; j++) {
      for (let i = 0; i < C - 1; i++) {
        const a = id(i, j), b = id(i + 1, j), cc = id(i, j + 1), d = id(i + 1, j + 1);
        idx.push(a, cc, b, b, cc, d);
      }
    }
    geo.setIndex(idx);
    const outer = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.95, sheen: 0.6, sheenColor: new THREE.Color('#e3b887'), sheenRoughness: 0.7, side: THREE.FrontSide });
    const inner = new THREE.MeshStandardMaterial({ color: '#5a4230', roughness: 1, side: THREE.BackSide });
    this.cloakOuter = new THREE.Mesh(geo, outer);
    this.cloakInner = new THREE.Mesh(geo, inner);
    for (const m of [this.cloakOuter, this.cloakInner]) {
      m.castShadow = true;
      m.frustumCulled = false;
      this.root.add(m);
    }
  }

  buildScarves(mat) {
    // two tails tied at the back of the neck, in head space
    this.scarves = [
      { anchor: new THREE.Vector3(0.045, -0.07, 0.115), n: 10, seg: 0.062, w0: 0.075, w1: 0.04 },
      { anchor: new THREE.Vector3(-0.025, -0.075, 0.115), n: 7, seg: 0.058, w0: 0.065, w1: 0.035 },
    ];
    for (const s of this.scarves) {
      const v = new Verlet(s.n);
      for (let i = 0; i < s.n; i++) v.p.set([s.anchor.x, 1.55 - i * s.seg, s.anchor.z + 0.1], i * 3);
      v.pin[0] = 1;
      for (let i = 0; i < s.n - 1; i++) v.link(i, i + 1, 1);
      for (let i = 0; i < s.n - 2; i++) v.link(i, i + 2, 0.3);
      v.settle();
      s.v = v;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(s.n * 2 * 3), 3));
      const idx = [];
      for (let i = 0; i < s.n - 1; i++) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
      geo.setIndex(idx);
      s.mesh = new THREE.Mesh(geo, mat);
      s.mesh.castShadow = true;
      s.mesh.frustumCulled = false;
      this.root.add(s.mesh);
    }
  }

  setShield(on) {
    this.shieldOn = on;
    if (on) this.shield.visible = true;
  }

  /* ---------------- poses ---------------- */

  pose(mode, sp, vy, t) {
    const ph = this.phase;
    const P = {
      thighL: 0, thighR: 0, kneeL: -0.12, kneeR: -0.12, footL: 0, footR: 0,
      shL: 0.05, shR: 0.05, elL: 0.3, elR: 0.3, outL: 0.1, outR: 0.1,
      torso: 0, twist: 0, torsoRoll: 0, hipYaw: 0, hipRoll: 0,
      tilt: 0, bodyY: 0, bodyX: 0, head: 0, headX: 0,
    };
    const legs = (th) => ({
      thigh: 0.1 + 0.72 * Math.cos(th + 0.35),
      knee: -(0.28 + 0.2 * bump(th, 0.55, 0.45) + 1.75 * bump(th, 3.9, 0.75)),
      foot: 0.18 * bump(th, 0.05, 0.35) - 0.7 * bump(th, 2.3, 0.45) + 0.3 * bump(th, 4.7, 0.7),
    });
    switch (mode) {
      case 'run':
      case 'stumble': {
        const L = legs(ph), R = legs(ph + Math.PI);
        const amp = mode === 'stumble' ? 0.6 : 1;
        P.thighL = L.thigh * amp; P.thighR = R.thigh * amp;
        P.kneeL = L.knee; P.kneeR = R.knee;
        P.footL = L.foot; P.footR = R.foot;
        const c = Math.cos(ph + 0.35);
        P.shL = -0.75 * c + 0.08; P.shR = 0.75 * c + 0.08;
        P.elL = 1.2 + 0.45 * Math.max(0, P.shL); P.elR = 1.2 + 0.45 * Math.max(0, P.shR);
        P.outL = 0.15 - 0.1 * Math.max(0, P.shL); P.outR = 0.15 - 0.1 * Math.max(0, P.shR);
        P.hipYaw = -0.12 * c;
        P.twist = 0.27 * c;
        P.hipRoll = 0.05 * Math.sin(2 * (ph - 1.1));
        P.bodyY = -0.035 * Math.cos(2 * (ph - 1.1)) - 0.02;
        P.bodyX = -0.022 * Math.sin(ph + 0.42);
        P.torso = -0.15 - clamp(sp - 10, 0, 25) * 0.006 + 0.03 * Math.cos(2 * (ph - 1.1));
        P.headX = 0.1;
        if (mode === 'stumble') {
          P.shL = -2.3 + Math.sin(t * 18) * 0.7; P.shR = -1.9 + Math.cos(t * 18) * 0.7;
          P.elL = 0.4; P.elR = 0.5; P.outL = P.outR = 0.6;
          P.torso = 0.22; P.headX = -0.35; P.bodyY -= 0.04;
        }
        break;
      }
      case 'jump': {
        const k = clamp(vy / 8, -1, 1);
        const s = (k + 1) / 2; // 1 rising, 0 falling
        const up = { thighA: 1.35, kneeA: -1.9, footA: 0.2, thighB: -0.4, kneeB: -1.35, footB: -0.55, shA: -0.7, elA: 0.9, shB: 1.3, elB: 0.7, out: 0.25, torso: -0.28 };
        const dn = { thighA: 0.85, kneeA: -0.65, footA: 0.25, thighB: 0.45, kneeB: -1.0, footB: 0.1, shA: 0.35, elA: 0.5, shB: 0.5, elB: 0.5, out: 0.8, torso: -0.08 };
        const g = (key) => mix(dn[key], up[key], s);
        // A = the leg that leads the leap, chosen at take-off
        const a = this.lead > 0 ? 'L' : 'R', b = this.lead > 0 ? 'R' : 'L';
        P['thigh' + a] = g('thighA'); P['knee' + a] = g('kneeA'); P['foot' + a] = g('footA');
        P['thigh' + b] = g('thighB'); P['knee' + b] = g('kneeB'); P['foot' + b] = g('footB');
        P['sh' + a] = g('shA'); P['el' + a] = g('elA'); P['sh' + b] = g('shB'); P['el' + b] = g('elB');
        P.outL = P.outR = g('out');
        P.torso = g('torso');
        P.twist = 0.15 * this.lead * s;
        P.headX = 0.15;
        break;
      }
      case 'slide': {
        // knee slide: lead leg skimming forward, trail leg folded beneath, a hand trailing the sand
        const j = Math.sin(t * 34) * 0.012;
        P.tilt = 1.0; P.bodyY = -0.5 + j;
        P.thighL = 0.15; P.kneeL = -0.12; P.footL = 0.35;
        P.thighR = -0.55; P.kneeR = -2.1; P.footR = -0.6;
        P.torso = -0.35; P.twist = -0.15;
        P.shL = -0.45; P.elL = 0.2; P.outL = 0.6;
        P.shR = 1.0; P.elR = 0.9; P.outR = 0.2;
        P.headX = -0.5;
        break;
      }
      case 'fly': {
        P.shL = -2.95; P.shR = -2.95; P.elL = 0.15; P.elR = 0.15; P.outL = P.outR = 0.08;
        P.thighL = 0.3 + Math.sin(t * 3) * 0.2; P.thighR = 0.1 + Math.sin(t * 3 + 1) * 0.2;
        P.kneeL = -0.5; P.kneeR = -0.75; P.footL = -0.4; P.footR = -0.5;
        P.torso = 0.05 + Math.sin(t * 3) * 0.04; P.headX = -0.2;
        break;
      }
      case 'ride': {
        // braced on the worm's back, hooks held high
        const w = Math.sin(t * 2.4);
        P.thighL = 0.6; P.thighR = -0.3; P.kneeL = -1.0; P.kneeR = -0.55; P.footL = 0.2; P.footR = -0.2;
        P.shL = -2.6 + w * 0.08; P.shR = -2.3; P.elL = 0.35; P.elR = 0.5; P.outL = P.outR = 0.25;
        P.torso = -0.15 + w * 0.04; P.twist = 0.15; P.hipYaw = -0.1;
        P.bodyY = w * 0.05 - 0.1;
        break;
      }
      case 'dead': {
        P.tilt = 1.45; P.bodyY = -0.78; P.shL = -1.6; P.shR = -1.2; P.outL = P.outR = 0.9;
        P.thighL = 0.4; P.thighR = 0.9; P.kneeL = -0.8; P.kneeR = -0.3; P.headX = -0.2;
        break;
      }
      case 'idle':
      default: {
        // weight on the left leg, breathing, looking out over the dunes
        const b = Math.sin(t * 1.6);
        P.hipRoll = 0.05; P.bodyX = -0.02; P.kneeR = -0.25; P.thighR = 0.08; P.footR = 0.1;
        P.shL = 0.08; P.shR = -0.02; P.elL = 0.28 + b * 0.03; P.elR = 0.22; P.outL = 0.12; P.outR = 0.14;
        P.torso = b * 0.02; P.torsoRoll = -0.04; P.bodyY = b * 0.008;
        P.head = Math.sin(t * 0.45) * 0.35; P.headX = Math.sin(t * 0.3) * 0.06;
      }
    }
    return P;
  }

  // state: { speed, mode: 'run'|'jump'|'slide'|'fly'|'ride'|'idle'|'dead'|'stumble', vy, air? }
  update(dt, st) {
    this.time += dt;
    const t = this.time;
    const sp = st.speed || 0;
    const mode = st.mode;
    if (mode !== this.mode) {
      if (mode === 'jump') this.lead = Math.cos(this.phase + 0.35) > 0 ? 1 : -1;
      if (this.mode === 'jump' && (mode === 'run' || mode === 'stumble')) { this.land = 1; this.landT = 0.26; }
      this.mode = mode;
      this.modeT = 0;
    }
    this.modeT += dt;
    if (mode === 'run' || mode === 'stumble') this.phase += dt * (7.5 + sp * 0.38);
    this.land = Math.max(0, this.land - dt * 4.5);

    /* ---- kinematics of the root (drives lean and cloth) ---- */
    const root = this.root;
    const kin = this.kin;
    const pos = root.position;
    const yaw = root.rotation.y;
    const jumped = !kin.ready || pos.distanceTo(kin.pos) > 4;
    let dYaw = 0;
    if (jumped) {
      kin.vel.set(0, 0, 0); kin.acc.set(0, 0, 0);
    } else if (dt > 0) {
      const v = this._v.copy(pos).sub(kin.pos).divideScalar(dt);
      const a = this._w.copy(v).sub(kin.vel).divideScalar(dt);
      if (a.length() > 90) a.setLength(90);
      kin.acc.lerp(a, Math.min(1, dt * 25));
      kin.vel.copy(v);
      dYaw = yaw - kin.yaw;
      dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    }
    kin.pos.copy(pos);
    kin.yaw = yaw;
    kin.ready = true;
    // into the runner's frame (yaw only)
    const cy = Math.cos(-yaw), sy = Math.sin(-yaw);
    const toLocal = (w, out) => out.set(w.x * cy + w.z * sy, w.y, -w.x * sy + w.z * cy);
    const velL = toLocal(kin.vel, this._v.clone());
    const accL = toLocal(kin.acc, this._w.clone());
    if (st.air) velL.z -= st.air;

    /* ---- pose ---- */
    const lateral = clamp(velL.x / 14, -1, 1);
    if (this.rig) this.animateRig(dt, mode, sp, st.vy || 0, lateral, dt > 0 ? dYaw / dt : 0);
    else this.animateProcedural(dt, mode, sp, st.vy || 0, t, lateral);

    root.updateMatrixWorld(true);
    this.detectSteps(mode);
    this.simulateCloth(dt, velL, accL, dYaw, jumped);

    const su = this.shield.material.uniforms;
    su.uTime.value = t;
    su.uAlpha.value = damp(su.uAlpha.value, this.shieldOn ? 1 : 0, 8, dt);
    this.shield.visible = su.uAlpha.value > 0.02;
    this.shield.scale.setScalar(1 + Math.sin(t * 5) * 0.02);
  }

  animateProcedural(dt, mode, sp, vy, t, lateral) {
    const target = this.pose(mode, sp, vy, t);
    // lean into lane changes
    target.lean = mode === 'slide' || mode === 'dead' ? 0 : -lateral * 0.22;
    target.torsoRoll += lateral * 0.08;
    target.headZ = -target.lean * 0.6;
    // landing: absorb through the knees
    if (this.land > 0) {
      const l = this.land * this.land;
      target.bodyY -= 0.12 * l; target.kneeL -= 0.55 * l; target.kneeR -= 0.55 * l;
      target.thighL += 0.35 * l; target.thighR += 0.35 * l; target.torso -= 0.2 * l;
      target.outL += 0.3 * l; target.outR += 0.3 * l;
    }
    const cyc = (mode === 'run' || mode === 'stumble') && this.modeT > 0.18;
    const rate = cyc ? 40 : mode === 'jump' ? 16 : 12;
    const r = this.r;
    for (const key in target) r[key] = r[key] === undefined ? target[key] : damp(r[key], target[key], key === 'lean' ? 9 : rate, dt);

    const [L, R] = this.legs;
    L.thigh.rotation.x = r.thighL; R.thigh.rotation.x = r.thighR;
    L.thigh.rotation.z = -0.03; R.thigh.rotation.z = 0.03;
    L.knee.rotation.x = r.kneeL; R.knee.rotation.x = r.kneeR;
    L.foot.rotation.x = r.footL; R.foot.rotation.x = r.footR;
    const [AL, AR] = this.arms;
    AL.sh.rotation.x = r.shL; AR.sh.rotation.x = r.shR;
    AL.sh.rotation.z = -r.outL; AR.sh.rotation.z = r.outR;
    AL.el.rotation.x = r.elL; AR.el.rotation.x = r.elR;
    AL.hand.rotation.x = -0.25; AR.hand.rotation.x = -0.25;
    this.hips.rotation.set(0, r.hipYaw, r.hipRoll);
    this.torso.rotation.set(r.torso, r.twist, r.torsoRoll - r.hipRoll * 0.7);
    this.head.rotation.set(r.headX - r.torso * 0.6 - r.tilt * 0.3, r.head - (r.twist + r.hipYaw) * 0.8, r.headZ - r.torsoRoll);
    this.pivot.rotation.set(r.tilt, 0, r.lean);
    this.body.position.set(r.bodyX, r.bodyY, 0);
    // breathing
    const breath = 1 + Math.sin(t * (mode === 'idle' ? 1.6 : 5)) * (mode === 'idle' ? 0.012 : 0.02);
    this.torso.scale.set(1, 1, breath);
  }

  /* ---------------- skinned rig (motion clips) ---------------- */

  // Swap the procedural body for the skinned, clip-driven one. The costume (hood, mantle, face,
  // harness, reservoir, belt) moves onto proxy frames riding the bones; the cloth follows them.
  attachRig(gltf) {
    const S = 0.96; // clip rig is 1.83 m; Ishra is ~1.76 m
    const model = gltf.scene;
    model.rotation.y = Math.PI; // clips face +z, the runner faces -z
    model.scale.setScalar(S);
    const bones = {};
    model.traverse((o) => {
      if (o.isBone) bones[o.name] = o;
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
        // one material over the whole skin: a contrasting joint material is what made the body
        // read as jointed segments rather than one figure
        o.material = this.suitMats.skinSuit;
      }
    });
    const need = ['DEF-hips', 'DEF-spine003', 'DEF-neck', 'DEF-head', 'DEF-upper_armL', 'DEF-upper_armR', 'DEF-forearmL', 'DEF-forearmR', 'DEF-handL', 'DEF-handR',
      'DEF-thighL', 'DEF-shinL', 'DEF-footL', 'DEF-thighR', 'DEF-shinR', 'DEF-footR'];
    if (need.some((n) => !bones[n])) throw new Error('runner rig is missing bones');
    this.rigHolder = new THREE.Group();
    this.rigHolder.add(model);
    this.root.add(this.rigHolder);

    // the mannequin's own head is replaced by the hooded one: collapse it and follow its motion
    this.headBone = bones['DEF-head'];
    this.headFollow = new THREE.Group();
    this.headFollow.position.copy(this.headBone.position);
    this.headFollow.quaternion.copy(this.headBone.quaternion);
    bones['DEF-neck'].add(this.headFollow);

    // proxy frames: in bind pose each matches the procedural part's frame in runner space
    this.root.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const proxy = (parent, y) => {
      const p = new THREE.Group();
      const parentInRoot = new THREE.Matrix4().multiplyMatrices(rootInv, parent.matrixWorld);
      p.matrixAutoUpdate = true;
      new THREE.Matrix4().copy(parentInRoot).invert().multiply(new THREE.Matrix4().makeTranslation(0, y, 0))
        .decompose(p.position, p.quaternion, p.scale);
      parent.add(p);
      return p;
    };
    const torsoP = proxy(bones['DEF-spine003'], 0.973);
    const hipsP = proxy(bones['DEF-hips'], 0.92);
    const headP = proxy(this.headFollow, 1.6);
    for (const o of this.torsoKit) torsoP.add(o);
    for (const o of this.hipKit) hipsP.add(o);
    this.head.position.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    headP.add(this.head);
    this.pivot.visible = false;
    this.clothTorso = torsoP;
    this.clothHead = this.head;
    this.legBones = [['L'], ['R']].map(([s]) => [bones['DEF-thigh' + s], bones['DEF-shin' + s], bones['DEF-foot' + s]]);
    this.armBones = [['L'], ['R']].map(([s]) => [bones['DEF-upper_arm' + s], bones['DEF-forearm' + s]]);

    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);
    this.rig = { model, mixer, actions, cur: null, name: '', armsUp: 0, lean: 0 };
    // hooks move to the skinned body: back proxy and the real hand bones
    this.hands = [bones['DEF-handL'], bones['DEF-handR']];
    const prev = this.hooks;
    this.buildHooks();
    this.setHooks(prev.count, prev.riding);
    this.landT = 0;
    this.kin.ready = false; // re-seat the cloth on the new frames
  }

  playClip(name, { timeScale = 1, once = false, fade = 0.18, startAt = 0 } = {}) {
    const R = this.rig;
    if (R.name !== name) {
      const next = R.actions[name];
      next.reset();
      next.time = startAt;
      next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = once;
      next.enabled = true;
      next.setEffectiveWeight(1);
      if (R.cur) next.crossFadeFrom(R.cur, fade, false);
      next.play();
      R.cur = next;
      R.name = name;
    }
    R.cur.timeScale = timeScale;
  }

  animateRig(dt, mode, sp, vy, lateral, yawRate) {
    const R = this.rig;
    this.landT = Math.max(0, this.landT - dt); // set on touchdown in update()
    let arms = 0;
    switch (mode) {
      case 'run':
        if (this.landT > 0) this.playClip('Jump_Land', { timeScale: 2.2, once: true, fade: 0.06 });
        else this.playClip('Sprint_Loop', { timeScale: clamp(0.95 + (sp - 12) * 0.035, 1, 2.3), fade: 0.16 });
        break;
      case 'stumble': this.playClip('Hit_Chest', { once: true, fade: 0.08 }); break;
      case 'jump':
        // push off with the take-off clip (skipping its crouch), then the airborne loop
        if (this.modeT < 0.16) this.playClip('Jump_Start', { timeScale: 2.4, once: true, fade: 0.06, startAt: 0.5 });
        else this.playClip('Jump_Loop', { timeScale: 1.2, fade: 0.16 });
        break;
      case 'slide': this.playClip('Roll', { timeScale: 1.47 / 0.8, once: true, fade: 0.08 }); break;
      case 'fly': this.playClip('Jump_Loop', { timeScale: 0.6, fade: 0.25 }); arms = 1; break;
      case 'ride': this.playClip('Crouch_Idle_Loop', { fade: 0.3 }); arms = 0.85; break;
      case 'dead': this.playClip('Death01', { once: true, fade: 0.15 }); break;
      default: this.playClip('Idle_Loop', { fade: 0.3 });
    }
    R.mixer.update(dt);

    // hands up: gripping the ornithopter skid, or the Maker hooks while riding
    R.armsUp = damp(R.armsUp, arms, 8, dt);
    if (R.armsUp > 0.01) {
      this.root.updateMatrixWorld(true);
      for (const [i, [upper, fore]] of this.armBones.entries()) {
        const side = i === 0 ? -1 : 1;
        this.aimBone(upper, this._v.set(side * 0.18, 1, -0.12), R.armsUp);
        this.aimBone(fore, this._v.set(side * 0.08, 1, -0.05), R.armsUp);
      }
    }
    // the hooded head follows the (collapsed) mannequin head
    this.headBone.scale.setScalar(0.001);
    this.headFollow.position.copy(this.headBone.position);
    this.headFollow.quaternion.copy(this.headBone.quaternion);
    // lean into lane changes and corners; turn the body toward where it is heading
    const upright = mode === 'slide' || mode === 'dead' || mode === 'ride';
    R.lean = damp(R.lean, upright ? 0 : clamp(-lateral * 0.24 + yawRate * 0.12, -0.42, 0.42), 9, dt);
    R.face = damp(R.face || 0, upright ? 0 : -lateral * 0.38, 10, dt);
    this.rigHolder.rotation.set(0, R.face, R.lean);
    // lean the spine forward with speed; keep the head level, eyes on the trail ahead
    const run = mode === 'run' ? clamp((sp - 12) / 30, 0, 1) : mode === 'jump' ? 0.3 : 0;
    R.fwd = damp(R.fwd || 0, run * 0.22, 6, dt);
    if (R.fwd > 0.005) {
      this.root.updateMatrixWorld(true);
      const right = this._w.set(1, 0, 0).applyQuaternion(this.root.quaternion);
      this.spineBones = this.spineBones || ['DEF-spine001', 'DEF-spine002'].map((n) => this.rig.model.getObjectByName(n)).filter(Boolean);
      for (const b of this.spineBones) b.rotateOnWorldAxis(right, -R.fwd * 0.5);
      this.headFollow.rotateOnWorldAxis(right, R.fwd * 0.9);
      this.headFollow.rotateOnWorldAxis(this._v.set(0, 0, -1).applyQuaternion(this.root.quaternion), R.lean * 0.6);
    }
  }

  // rotate a bone so its length axis (+y) points along a runner-space direction, blended by w
  aimBone(bone, dir, w) {
    bone.updateWorldMatrix(true, false);
    const q = bone.getWorldQuaternion(new THREE.Quaternion());
    const cur = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const want = dir.clone().normalize().transformDirection(this.root.matrixWorld);
    const world = new THREE.Quaternion().setFromUnitVectors(cur, want).multiply(q);
    const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.slerp(parentQ.invert().multiply(world), w);
    bone.updateWorldMatrix(false, true);
  }

  // Footfalls from the animated feet: a step fires as an ankle drops to the ground, re-arming once
  // it lifts again. onStep(side) is set by the game (-1 left, 1 right).
  detectSteps(mode) {
    if (!this.onStep) return;
    const feet = this.rig ? this.legBones.map((l) => l[2]) : this.legs.map((l) => l.foot);
    const inv = this._inv.copy(this.root.matrixWorld).invert();
    this.stepArmed = this.stepArmed || [true, true];
    for (let i = 0; i < 2; i++) {
      const y = this._w.setFromMatrixPosition(feet[i].matrixWorld).applyMatrix4(inv).y;
      if (y > 0.24) this.stepArmed[i] = true;
      else if (y < 0.16 && this.stepArmed[i]) {
        this.stepArmed[i] = false;
        if (mode === 'run' || mode === 'stumble') this.onStep(i === 0 ? -1 : 1);
      }
    }
  }

  /* ---------------- cloth ---------------- */

  simulateCloth(dt, velL, accL, dYaw, reset) {
    const root = this.root;
    const inv = this._inv.copy(root.matrixWorld).invert();
    const toRoot = this._m.multiplyMatrices(inv, this.clothTorso.matrixWorld); // torso -> root space
    const tInv = this._tInv.copy(toRoot).invert();
    const headToRoot = new THREE.Matrix4().multiplyMatrices(inv, this.clothHead.matrixWorld);
    const v = this._v;
    const cl = this.cloth, C = this.cloakC;

    // pins follow the shoulders
    for (let i = 0; i < C; i++) {
      v.copy(this.cloakAnchors[i]).applyMatrix4(toRoot);
      cl.p.set([v.x, v.y, v.z], i * 3);
      if (reset) cl.q.set([v.x, v.y, v.z], i * 3);
    }
    if (reset) {
      const w = new THREE.Vector3();
      for (let j = 1; j < this.cloakR; j++) for (let i = 0; i < C; i++) { this.cloakRest(i, j, w).applyMatrix4(toRoot); cl.p.set([w.x, w.y, w.z], (j * C + i) * 3); }
      cl.settle();
    } else if (dYaw) cl.yaw(-dYaw);

    for (const s of this.scarves) {
      const sv = s.v;
      v.copy(s.anchor).applyMatrix4(headToRoot);
      sv.p.set([v.x, v.y, v.z], 0);
      if (reset) {
        for (let i = 0; i < s.n; i++) sv.p.set([v.x, v.y - i * s.seg, v.z + 0.02 * i], i * 3);
        sv.settle();
      } else if (dYaw) sv.yaw(-dYaw);
    }

    // colliders in root space: hip line, knees, shins, feet
    const cols = this.colliders;
    let ci = 0;
    if (this.rig) {
      for (const [thigh, shin, foot] of this.legBones) {
        const a = cols[ci].setFromMatrixPosition(thigh.matrixWorld).applyMatrix4(inv);
        const b = cols[ci + 1].setFromMatrixPosition(shin.matrixWorld).applyMatrix4(inv);
        const c = cols[ci + 3].setFromMatrixPosition(foot.matrixWorld).applyMatrix4(inv);
        cols[ci + 2].copy(b).lerp(c, 0.5);
        a.lerp(b, 0.5);
        ci += 4;
      }
    } else {
      for (const leg of this.legs) {
        cols[ci++].set(0, -0.2, 0).applyMatrix4(leg.thigh.matrixWorld).applyMatrix4(inv);
        cols[ci++].setFromMatrixPosition(leg.knee.matrixWorld).applyMatrix4(inv);
        cols[ci++].set(0, -0.22, 0).applyMatrix4(leg.knee.matrixWorld).applyMatrix4(inv);
        cols[ci++].setFromMatrixPosition(leg.foot.matrixWorld).applyMatrix4(inv);
      }
    }
    const ground = root.position.y > -1 ? -root.position.y + 0.03 : -1e9;

    const air = Math.hypot(velL.x, velL.z);
    const t = this.time;
    const g = -9.8;
    const fx = -accL.x, fy = g - accL.y, fz = -accL.z;
    const wx = -velL.x, wy = -velL.y * 0.5, wz = -velL.z;
    const gust = 0.25 + air * 0.035;
    const DRAG = 0.75;
    const force = (C2, k1, k2) => (i, f) => {
      const a = i % C2, b = (i / C2) | 0;
      const fl = Math.sin(t * k1 + b * 1.1 + a * 0.9);
      f.set(
        fx + (wx + Math.sin(t * k2 + b * 0.7 - a * 1.3) * air * gust * 0.5) * DRAG,
        fy + (wy + fl * air * gust * 0.4) * DRAG,
        fz + (wz + Math.sin(t * 13 + a * 0.6 + b) * air * gust * 0.5) * DRAG
      );
    };
    const cloakForce = force(C, 15, 11);
    const tmp = new THREE.Vector3();
    const n = Math.min(4, Math.max(1, Math.ceil(dt / (1 / 90))));
    const h = dt / n;
    if (h > 0) {
      for (let s = 0; s < n; s++) {
        cl.integrate(h, cloakForce, DRAG);
        cl.solve(5);
        this.collide(cl, tInv, toRoot, cols, ground, tmp, 0.215);
        for (const sc of this.scarves) {
          sc.v.integrate(h, force(1e9, 17, 13), 1.0);
          sc.v.solve(4);
          this.collide(sc.v, tInv, toRoot, cols, ground, tmp, 0.2);
        }
      }
    }

    // write meshes
    const pa = this.cloakOuter.geometry.attributes.position;
    pa.array.set(cl.p);
    pa.needsUpdate = true;
    this.cloakOuter.geometry.computeVertexNormals();

    for (const sc of this.scarves) {
      const p = sc.v.p, arr = sc.mesh.geometry.attributes.position.array;
      const d = new THREE.Vector3(), side = new THREE.Vector3();
      for (let i = 0; i < sc.n; i++) {
        const a = Math.max(0, i - 1), b = Math.min(sc.n - 1, i + 1);
        d.set(p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]).normalize();
        side.set(1, 0, 0).addScaledVector(d, -d.x);
        if (side.lengthSq() < 1e-4) side.set(0, 0, 1);
        side.normalize().multiplyScalar(mix(sc.w0, sc.w1, i / (sc.n - 1)) * 0.5);
        arr.set([p[i * 3] - side.x, p[i * 3 + 1] - side.y, p[i * 3 + 2] - side.z, p[i * 3] + side.x, p[i * 3 + 1] + side.y, p[i * 3 + 2] + side.z], i * 6);
      }
      sc.mesh.geometry.attributes.position.needsUpdate = true;
      sc.mesh.geometry.computeVertexNormals();
    }
  }

  // keep cloth outside the torso (elliptic cylinder in torso space), the legs and the ground
  collide(cl, tInv, toRoot, cols, ground, v, R) {
    const p = cl.p;
    for (let i = 0; i < cl.n; i++) {
      if (cl.pin[i]) continue;
      const k = i * 3;
      v.set(p[k], p[k + 1], p[k + 2]).applyMatrix4(tInv);
      if (v.y > -0.42 && v.y < 0.43) {
        const rz = v.z > 0 ? 0.205 : 0.16;
        const ex = v.x / R, ez = v.z / rz;
        const e = Math.sqrt(ex * ex + ez * ez);
        if (e < 1 && e > 1e-4) {
          v.x /= e; v.z /= e;
          v.applyMatrix4(toRoot);
          p[k] = v.x; p[k + 1] = v.y; p[k + 2] = v.z;
        }
      }
      for (let c = 0; c < cols.length; c++) {
        const o = cols[c];
        const dx = p[k] - o.x, dy = p[k + 1] - o.y, dz = p[k + 2] - o.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const rr = 0.095;
        if (d2 < rr * rr && d2 > 1e-8) {
          const d = Math.sqrt(d2), s = (rr - d) / d;
          p[k] += dx * s; p[k + 1] += dy * s; p[k + 2] += dz * s;
        }
      }
      if (p[k + 1] < ground) p[k + 1] = ground;
    }
  }
}
