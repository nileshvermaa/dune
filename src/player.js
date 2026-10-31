import * as THREE from 'three';
import { damp } from './noise.js';
import { mats } from './props.js';
import { limb, lathe, rbox, M, merge } from './geom.js';
import { detailed } from './materials.js';

// Fremen runner: tapered anatomy, ribbed stillsuit, harness and belt kit, hooded mask with
// breathing tubes, a two-tone flowing cloak and a trailing scarf — all procedurally animated.

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

export class Runner {
  constructor() {
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);

    const suit = new THREE.MeshStandardMaterial({ color: '#3d322b', roughness: 0.55, metalness: 0.15 });
    const rib = new THREE.MeshStandardMaterial({ color: '#5b4a3c', roughness: 0.5, metalness: 0.25 });
    const leather = new THREE.MeshStandardMaterial({ color: '#5e3d24', roughness: 0.68 });
    const metal = new THREE.MeshStandardMaterial({ color: '#b8925a', roughness: 0.35, metalness: 0.9 });
    const cloth = new THREE.MeshPhysicalMaterial({ color: '#664730', roughness: 0.95, sheen: 0.5, sheenColor: new THREE.Color('#d9a875'), sheenRoughness: 0.7, side: THREE.DoubleSide });
    const clothDark = new THREE.MeshPhysicalMaterial({ color: '#6b4c32', roughness: 0.95, sheen: 0.8, sheenColor: new THREE.Color('#c99a6a'), sheenRoughness: 0.6, side: THREE.DoubleSide });
    const skin = new THREE.MeshStandardMaterial({ color: '#a97b58', roughness: 0.6 });
    const sole = new THREE.MeshStandardMaterial({ color: '#1d1714', roughness: 0.9 });
    const bone = new THREE.MeshStandardMaterial({ color: '#efe6d2', roughness: 0.35, emissive: '#2a241c' });
    this.cloakMat = cloth;

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

    /* ---- hips & belt ---- */
    const hips = new THREE.Group();
    hips.position.y = 0.95;
    this.body.add(hips);
    this.hips = hips;
    add(hips, new THREE.SphereGeometry(0.16, 18, 12), suit, 0, -0.01, 0).scale.set(1, 0.72, 0.78);
    add(hips, new THREE.TorusGeometry(0.158, 0.03, 8, 28), leather, 0, 0.07, 0, Math.PI / 2).scale.set(1, 0.78, 1);
    add(hips, rbox(0.07, 0.06, 0.03, 0.01), metal, 0, 0.07, -0.13);
    add(hips, rbox(0.09, 0.08, 0.05, 0.015), leather, -0.12, 0.03, -0.07, 0, 0.5);
    add(hips, rbox(0.09, 0.08, 0.05, 0.015), leather, 0.12, 0.03, -0.07, 0, -0.5);
    add(hips, rbox(0.12, 0.09, 0.06, 0.015), leather, 0, 0.03, 0.13);
    // crysknife at the left hip
    const knife = new THREE.Group();
    knife.position.set(-0.16, 0.0, 0.02);
    knife.rotation.set(0.25, 0, 0.18);
    hips.add(knife);
    add(knife, new THREE.CylinderGeometry(0.022, 0.012, 0.24, 8), leather, 0, -0.1, 0);
    add(knife, new THREE.CylinderGeometry(0.015, 0.018, 0.09, 8), bone, 0, 0.06, 0);
    add(knife, new THREE.SphereGeometry(0.022, 8, 6), bone, 0, 0.11, 0);

    /* ---- legs ---- */
    this.legs = [];
    for (const side of [-1, 1]) {
      const thigh = new THREE.Group();
      thigh.position.set(side * 0.095, -0.03, 0);
      add(thigh, limb(0.082, 0.06, 0.38, 0.012), suit, 0, 0, 0);
      ribMesh(thigh, ribs((t) => 0.08 - t * 0.016, -0.1, -0.33, 3));
      if (side > 0) add(thigh, rbox(0.06, 0.1, 0.07, 0.015), leather, 0.07, -0.16, -0.01);
      add(thigh, new THREE.TorusGeometry(0.083, 0.012, 6, 16), leather, 0, -0.1, 0, Math.PI / 2);
      const knee = new THREE.Group();
      knee.position.y = -0.43;
      add(knee, new THREE.SphereGeometry(0.055, 10, 8), rib, 0, 0, -0.035).scale.set(1, 1, 0.6);
      add(knee, limb(0.06, 0.04, 0.37, 0.015), suit, 0, 0, 0);
      ribMesh(knee, ribs((t) => 0.064 - t * 0.02, -0.08, -0.3, 3));
      const foot = new THREE.Group();
      foot.position.y = -0.4;
      knee.add(foot);
      add(foot, rbox(0.11, 0.1, 0.24, 0.035, 2), suit, 0, -0.03, -0.045);
      add(foot, rbox(0.12, 0.035, 0.26, 0.012), sole, 0, -0.085, -0.05);
      add(foot, new THREE.TorusGeometry(0.052, 0.012, 6, 14), leather, 0, 0.02, 0, Math.PI / 2);
      add(foot, rbox(0.115, 0.02, 0.05, 0.008), leather, 0, -0.01, -0.09);
      thigh.add(knee);
      hips.add(thigh);
      this.legs.push({ thigh, knee, foot, side });
    }

    /* ---- torso ---- */
    const torso = new THREE.Group();
    torso.position.y = 0.06;
    hips.add(torso);
    this.torso = torso;
    const chest = add(torso, lathe([[0.001, -0.02], [0.13, 0.0], [0.15, 0.1], [0.185, 0.26], [0.19, 0.34], [0.165, 0.42], [0.09, 0.47], [0.05, 0.5], [0.001, 0.5]], 22), suit, 0, 0, 0);
    chest.scale.set(1, 1, 0.72);
    const torsoRibs = ribMesh(torso, ribs((t) => 0.15 + t * 0.035, 0.08, 0.3, 4, 0.72));
    torsoRibs.scale.set(1, 1, 1);
    // chest panel & harness
    add(torso, rbox(0.2, 0.16, 0.04, 0.02), rib, 0, 0.3, -0.12);
    for (const side of [-1, 1]) {
      add(torso, rbox(0.035, 0.48, 0.012, 0.005), leather, side * 0.06, 0.27, -0.135, 0, 0, side * 0.42);
      add(torso, rbox(0.035, 0.48, 0.012, 0.005), leather, side * 0.06, 0.27, 0.135, 0, 0, -side * 0.42);
    }
    add(torso, new THREE.CylinderGeometry(0.03, 0.03, 0.015, 14), metal, 0, 0.27, -0.143, Math.PI / 2);
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
    for (const side of [-1, 1]) {
      add(torso, new THREE.SphereGeometry(0.075, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), clothDark, side * 0.18, 0.43, 0, 0, 0, side * -0.35).scale.set(1, 0.7, 1.05);
    }

    /* ---- head ---- */
    const head = new THREE.Group();
    head.position.y = 0.6;
    torso.add(head);
    this.head = head;
    add(head, new THREE.SphereGeometry(0.105, 20, 16), skin, 0, 0.02, 0).scale.set(0.95, 1.08, 1);
    // hood: open toward -z (sphere phi = 1.5PI faces forward)
    const hood = add(head, new THREE.SphereGeometry(0.137, 24, 16, Math.PI * 1.5 + Math.PI * 0.22, Math.PI * 1.56, 0, Math.PI * 0.74), cloth, 0, 0.035, 0.012);
    hood.rotation.x = -0.1;
    add(head, new THREE.CylinderGeometry(0.11, 0.2, 0.24, 20, 1, true, -Math.PI * 0.5, Math.PI), cloth, 0, -0.14, 0.02);
    add(head, new THREE.SphereGeometry(0.112, 20, 10, Math.PI * 1.5 - Math.PI * 0.4, Math.PI * 0.8, Math.PI * 0.52, Math.PI * 0.3), suit, 0, 0.005, 0);
    add(head, new THREE.CylinderGeometry(0.03, 0.035, 0.04, 12), rib, 0, -0.045, -0.105, Math.PI / 2);
    add(head, new THREE.TorusGeometry(0.035, 0.008, 6, 14), metal, 0, -0.045, -0.126);
    for (const side of [-1, 1]) {
      add(head, new THREE.CylinderGeometry(0.022, 0.022, 0.03, 10), rib, side * 0.085, -0.03, -0.06, 0, 0, Math.PI / 2);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), mats.ibadGlow);
      eye.position.set(side * 0.038, 0.035, -0.098);
      head.add(eye);
    }
    add(head, rbox(0.12, 0.018, 0.03, 0.008), clothDark, 0, 0.065, -0.1);

    /* ---- arms ---- */
    this.arms = [];
    for (const side of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(side * 0.205, 0.42, 0);
      add(sh, limb(0.058, 0.046, 0.26, 0.01), suit, 0, 0, 0);
      ribMesh(sh, ribs((t) => 0.056 - t * 0.01, -0.07, -0.22, 3));
      const el = new THREE.Group();
      el.position.y = -0.29;
      add(el, limb(0.047, 0.036, 0.23, 0.008), suit, 0, 0, 0);
      add(el, new THREE.CylinderGeometry(0.05, 0.044, 0.12, 12), leather, 0, -0.16, 0);
      const hand = new THREE.Group();
      hand.position.y = -0.27;
      el.add(hand);
      add(hand, rbox(0.06, 0.085, 0.045, 0.018, 2), suit, 0, -0.03, 0);
      add(hand, limb(0.014, 0.012, 0.04), suit, side * -0.03, -0.01, -0.02, 0.4, 0, side * 0.5);
      sh.add(el);
      torso.add(sh);
      this.arms.push({ sh, el, side });
    }

    /* ---- cloak & scarf (cloth driven per frame) ---- */
    const cg = new THREE.PlaneGeometry(0.6, 1.12, 10, 18);
    cg.translate(0, -0.56, 0);
    const cp = cg.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i), y = cp.getY(i);
      const d = -y / 1.12;
      cp.setX(i, x * (0.62 + d * 0.55));
      if (d > 0.97) cp.setY(i, y + Math.sin(x * 40) * 0.03 + Math.sin(x * 17) * 0.02);
    }
    this.cloakBase = cp.array.slice();
    this.cloak = new THREE.Mesh(cg, cloth);
    this.cloak.position.set(0, 0.47, 0.2);
    this.cloak.castShadow = true;
    torso.add(this.cloak);

    const sg = new THREE.PlaneGeometry(0.07, 0.55, 1, 10);
    sg.translate(0, -0.275, 0);
    this.scarfBase = sg.attributes.position.array.slice();
    this.scarf = new THREE.Mesh(sg, clothDark);
    this.scarf.position.set(0.04, 0.08, 0.1);
    this.scarf.castShadow = true;
    head.add(this.scarf);

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
  }

  setShield(on) {
    this.shieldOn = on;
    if (on) this.shield.visible = true;
  }

  // state: { speed, mode: 'run'|'jump'|'slide'|'fly'|'idle'|'dead'|'stumble', vy }
  update(dt, st) {
    this.time += dt;
    const t = this.time;
    const sp = st.speed || 0;
    if (st.mode === 'run' || st.mode === 'stumble') this.phase += dt * (8 + sp * 0.45);
    const ph = this.phase;
    const target = {
      thighL: 0, thighR: 0, kneeL: -0.1, kneeR: -0.1, footL: 0, footR: 0,
      shL: 0, shR: 0, elL: 0.3, elR: 0.3, torso: 0, twist: 0, bodyRot: 0, bodyY: 0, head: 0, headX: 0, armOut: 0.1,
    };
    switch (st.mode) {
      case 'run': {
        const s = Math.sin(ph);
        target.thighL = s * 1.0; target.thighR = -s * 1.0;
        target.kneeL = -Math.max(0, Math.sin(ph + 1.3)) * 1.65 - 0.2;
        target.kneeR = -Math.max(0, Math.sin(ph + 1.3 + Math.PI)) * 1.65 - 0.2;
        target.footL = Math.max(0, -Math.sin(ph + 0.6)) * 0.5;
        target.footR = Math.max(0, Math.sin(ph + 0.6)) * 0.5;
        target.shL = -s * 0.95; target.shR = s * 0.95;
        target.elL = 1.25 + Math.max(0, s) * 0.3; target.elR = 1.25 + Math.max(0, -s) * 0.3;
        target.torso = -0.26; target.twist = s * 0.12;
        target.headX = 0.12;
        target.bodyY = Math.abs(Math.cos(ph)) * 0.075 - 0.02;
        break;
      }
      case 'stumble': {
        const s = Math.sin(ph);
        target.thighL = s * 0.6; target.thighR = -s * 0.6;
        target.kneeL = -0.6; target.kneeR = -0.6;
        target.shL = -2.2 + Math.sin(t * 20) * 0.6; target.shR = -2.0 + Math.cos(t * 20) * 0.6;
        target.torso = 0.25; target.armOut = 0.6; target.headX = -0.3;
        break;
      }
      case 'jump': {
        const up = st.vy > 0;
        target.thighL = up ? 1.3 : 0.7; target.thighR = up ? -0.35 : 0.25;
        target.kneeL = -1.6; target.kneeR = up ? -1.3 : -0.7;
        target.footL = 0.4; target.footR = 0.3;
        target.shL = -2.5; target.shR = 1.0; target.elL = 0.4; target.elR = 0.9;
        target.torso = -0.15; target.armOut = 0.3; target.headX = 0.1;
        break;
      }
      case 'slide': {
        target.thighL = 0.62; target.thighR = 0.4; target.kneeL = -0.15; target.kneeR = -0.75;
        target.shL = 0.7; target.shR = 0.4; target.elL = 0.2; target.elR = 0.5; target.armOut = 0.35;
        target.bodyRot = 1.05; target.bodyY = -0.55; target.headX = -0.65;
        break;
      }
      case 'fly': {
        target.shL = -2.95; target.shR = -2.95; target.elL = 0.15; target.elR = 0.15;
        target.thighL = 0.3 + Math.sin(t * 3) * 0.2; target.thighR = 0.1 + Math.sin(t * 3 + 1) * 0.2;
        target.kneeL = -0.5; target.kneeR = -0.7; target.armOut = 0.05; target.footL = 0.5; target.footR = 0.5;
        break;
      }
      case 'ride': {
        // braced on the worm's back, hooks held high
        target.thighL = 0.55; target.thighR = -0.25; target.kneeL = -0.9; target.kneeR = -0.5;
        target.shL = -2.6 + Math.sin(t * 2.4) * 0.08; target.shR = -2.3; target.elL = 0.35; target.elR = 0.5;
        target.torso = -0.12 + Math.sin(t * 2.4) * 0.04; target.armOut = 0.25; target.twist = 0.15;
        target.bodyY = Math.sin(t * 2.4) * 0.05 - 0.08;
        break;
      }
      case 'dead': {
        target.bodyRot = 1.4; target.bodyY = -0.75; target.shL = -1.6; target.shR = -1.2;
        target.thighL = 0.4; target.thighR = 0.9; target.kneeL = -0.8; target.kneeR = -0.3; target.armOut = 0.9;
        break;
      }
      case 'idle':
      default: {
        const b = Math.sin(t * 1.6);
        target.shL = 0.05; target.shR = -0.05; target.elL = 0.25 + b * 0.03; target.elR = 0.25;
        target.torso = b * 0.02; target.bodyY = b * 0.01; target.head = Math.sin(t * 0.5) * 0.25;
      }
    }
    const r = this.r;
    for (const key in target) r[key] = r[key] === undefined ? target[key] : damp(r[key], target[key], 18, dt);

    const [L, R] = this.legs;
    L.thigh.rotation.x = r.thighL; R.thigh.rotation.x = r.thighR;
    L.knee.rotation.x = r.kneeL; R.knee.rotation.x = r.kneeR;
    L.foot.rotation.x = r.footL; R.foot.rotation.x = r.footR;
    const [AL, AR] = this.arms;
    AL.sh.rotation.x = r.shL; AR.sh.rotation.x = r.shR;
    AL.sh.rotation.z = -r.armOut; AR.sh.rotation.z = r.armOut;
    AL.el.rotation.x = r.elL; AR.el.rotation.x = r.elR;
    this.torso.rotation.x = r.torso;
    this.torso.rotation.y = r.twist;
    this.head.rotation.y = r.head - r.twist * 0.8;
    this.head.rotation.x = r.headX - r.torso * 0.6;
    this.body.rotation.x = r.bodyRot;
    this.body.position.y = r.bodyY;

    // cloak: pinned at the shoulders, billowing with speed
    const flow = st.mode === 'idle' ? 0.06 : st.mode === 'slide' ? 0.2 : st.mode === 'fly' || st.mode === 'ride' ? 0.75 : 0.38 + sp * 0.013;
    const pos = this.cloak.geometry.attributes.position;
    const base = this.cloakBase;
    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 3], by = base[i * 3 + 1];
      const d = Math.max(0, -by / 1.12);
      const wave = Math.sin(t * 11 + d * 6 + bx * 5) * 0.05 + Math.sin(t * 17 + d * 9 - bx * 3) * 0.025;
      const z = Math.pow(d, 1.3) * flow * 1.1 + wave * d * (0.4 + flow);
      const lift = Math.pow(d, 2) * flow * 0.45;
      const sway = Math.sin(ph * 0.5) * 0.04 * d;
      const wrap = (bx / 0.3) ** 2 * (0.16 - d * 0.1) - Math.sin(bx * 34) * 0.024 * (0.3 + d);
      pos.setXYZ(i, bx + sway, by + lift, z - wrap);
    }
    pos.needsUpdate = true;
    this.cloak.geometry.computeVertexNormals();

    const spos = this.scarf.geometry.attributes.position;
    const sb = this.scarfBase;
    for (let i = 0; i < spos.count; i++) {
      const bx = sb[i * 3], by = sb[i * 3 + 1];
      const d = -by / 0.55;
      spos.setXYZ(i, bx + Math.sin(t * 14 + d * 5) * 0.05 * d, by * (1 - flow * 0.5) + d * d * flow * 0.1, d * flow * 0.5 + Math.sin(t * 9 + d * 4) * 0.04 * d);
    }
    spos.needsUpdate = true;
    this.scarf.geometry.computeVertexNormals();

    const su = this.shield.material.uniforms;
    su.uTime.value = t;
    su.uAlpha.value = damp(su.uAlpha.value, this.shieldOn ? 1 : 0, 8, dt);
    this.shield.visible = su.uAlpha.value > 0.02;
    this.shield.scale.setScalar(1 + Math.sin(t * 5) * 0.02);
  }
}
