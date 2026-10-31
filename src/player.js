import * as THREE from 'three';
import { damp } from './noise.js';
import { mats } from './props.js';

// Procedurally animated desert runner in a stillsuit and cloak.

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

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

export class Runner {
  constructor() {
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);

    const suit = new THREE.MeshStandardMaterial({ color: '#3a2f27', roughness: 0.75, metalness: 0.15 });
    const suitLight = new THREE.MeshStandardMaterial({ color: '#5a4a3c', roughness: 0.8 });
    const cloakMat = new THREE.MeshStandardMaterial({ color: '#6e5238', roughness: 0.95, side: THREE.DoubleSide });
    const skin = new THREE.MeshStandardMaterial({ color: '#b98a66', roughness: 0.7 });
    const boot = new THREE.MeshStandardMaterial({ color: '#241c16', roughness: 0.8 });
    this.cloakMat = cloakMat;

    const hips = new THREE.Group();
    hips.position.y = 0.95;
    this.body.add(hips);
    this.hips = hips;
    const pelvis = mesh(new THREE.BoxGeometry(0.34, 0.2, 0.2), suit);
    hips.add(pelvis);
    const belt = mesh(new THREE.BoxGeometry(0.37, 0.07, 0.23), suitLight, 0, 0.08, 0);
    hips.add(belt);

    const limb = (r, len) => new THREE.CapsuleGeometry(r, len, 4, 8);
    this.legs = [];
    for (const side of [-1, 1]) {
      const thigh = new THREE.Group();
      thigh.position.set(side * 0.1, -0.02, 0);
      thigh.add(mesh(limb(0.078, 0.34), suit, 0, -0.22, 0));
      const knee = new THREE.Group();
      knee.position.y = -0.45;
      knee.add(mesh(limb(0.066, 0.34), suit, 0, -0.22, 0));
      knee.add(mesh(new THREE.BoxGeometry(0.13, 0.11, 0.26), boot, 0, -0.47, -0.04));
      thigh.add(knee);
      hips.add(thigh);
      this.legs.push({ thigh, knee, side });
    }

    const torso = new THREE.Group();
    torso.position.y = 0.06;
    hips.add(torso);
    this.torso = torso;
    torso.add(mesh(limb(0.17, 0.3), suit, 0, 0.33, 0));
    torso.add(mesh(new THREE.BoxGeometry(0.3, 0.32, 0.12), suitLight, 0, 0.36, 0.14));
    for (const side of [-1, 1]) {
      const tube = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.4, 5), suitLight, side * 0.09, 0.42, -0.15);
      tube.rotation.x = 0.2;
      torso.add(tube);
    }

    const head = new THREE.Group();
    head.position.y = 0.68;
    torso.add(head);
    this.head = head;
    head.add(mesh(new THREE.SphereGeometry(0.12, 16, 12), skin));
    const hood = mesh(new THREE.SphereGeometry(0.145, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), cloakMat, 0, 0.01, 0.015);
    hood.rotation.x = -0.35;
    head.add(hood);
    const mask = mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.09, 10), suit, 0, -0.06, -0.08);
    mask.rotation.x = Math.PI / 2 - 0.2;
    head.add(mask);
    const noseTube = mesh(new THREE.TorusGeometry(0.06, 0.012, 5, 10, Math.PI), suitLight, 0, -0.04, -0.1);
    head.add(noseTube);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), mats.ibadGlow);
      eye.position.set(side * 0.045, 0.025, -0.108);
      head.add(eye);
    }

    this.arms = [];
    for (const side of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(side * 0.22, 0.52, 0);
      sh.add(mesh(limb(0.058, 0.25), suit, 0, -0.17, 0));
      const el = new THREE.Group();
      el.position.y = -0.34;
      el.add(mesh(limb(0.052, 0.23), suit, 0, -0.15, 0));
      el.add(mesh(new THREE.SphereGeometry(0.055, 8, 6), suitLight, 0, -0.31, 0));
      sh.add(el);
      torso.add(sh);
      this.arms.push({ sh, el, side });
    }

    // cloak cloth simulated with a cheap wave function
    const cg = new THREE.PlaneGeometry(0.42, 0.9, 4, 10);
    cg.translate(0, -0.45, 0);
    this.cloakBase = cg.attributes.position.array.slice();
    this.cloak = new THREE.Mesh(cg, cloakMat);
    this.cloak.position.set(0, 0.58, 0.19);
    this.cloak.castShadow = true;
    torso.add(this.cloak);

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
    const k = 18;
    const target = {
      thighL: 0, thighR: 0, kneeL: -0.1, kneeR: -0.1,
      shL: 0, shR: 0, elL: 0.3, elR: 0.3, torso: 0, bodyRot: 0, bodyY: 0, head: 0, armOut: 0.08,
    };
    switch (st.mode) {
      case 'run': {
        const s = Math.sin(ph);
        target.thighL = s * 0.95; target.thighR = -s * 0.95;
        target.kneeL = -Math.max(0, Math.sin(ph + 1.3)) * 1.5 - 0.15;
        target.kneeR = -Math.max(0, Math.sin(ph + 1.3 + Math.PI)) * 1.5 - 0.15;
        target.shL = -s * 0.85; target.shR = s * 0.85;
        target.elL = 1.1; target.elR = 1.1;
        target.torso = -0.22;
        target.bodyY = Math.abs(Math.cos(ph)) * 0.08;
        break;
      }
      case 'stumble': {
        const s = Math.sin(ph);
        target.thighL = s * 0.6; target.thighR = -s * 0.6;
        target.kneeL = -0.6; target.kneeR = -0.6;
        target.shL = -2.2 + Math.sin(t * 20) * 0.6; target.shR = -2.0 + Math.cos(t * 20) * 0.6;
        target.torso = 0.25; target.armOut = 0.6;
        break;
      }
      case 'jump': {
        const up = st.vy > 0;
        target.thighL = up ? 1.2 : 0.6; target.thighR = up ? -0.3 : 0.2;
        target.kneeL = -1.5; target.kneeR = up ? -1.2 : -0.6;
        target.shL = -2.4; target.shR = 0.9; target.elL = 0.4; target.elR = 0.8;
        target.torso = -0.1; target.armOut = 0.25;
        break;
      }
      case 'slide': {
        target.thighL = 1.45; target.thighR = 1.3; target.kneeL = -0.25; target.kneeR = -0.5;
        target.shL = 0.6; target.shR = 0.6; target.elL = 0.2; target.elR = 0.2;
        target.bodyRot = 1.05; target.bodyY = -0.55; target.head = -0.6;
        break;
      }
      case 'fly': {
        target.shL = -2.9; target.shR = -2.9; target.elL = 0.15; target.elR = 0.15;
        target.thighL = 0.3 + Math.sin(t * 3) * 0.2; target.thighR = 0.1 + Math.sin(t * 3 + 1) * 0.2;
        target.kneeL = -0.5; target.kneeR = -0.7; target.armOut = 0.05;
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
        target.shL = 0.05; target.shR = -0.05; target.elL = 0.2 + b * 0.03; target.elR = 0.2;
        target.torso = b * 0.02; target.bodyY = b * 0.01; target.head = Math.sin(t * 0.5) * 0.2;
      }
    }
    const r = this.r;
    for (const key in target) r[key] = r[key] === undefined ? target[key] : damp(r[key], target[key], k, dt);

    this.legs[0].thigh.rotation.x = r.thighL; this.legs[1].thigh.rotation.x = r.thighR;
    this.legs[0].knee.rotation.x = r.kneeL; this.legs[1].knee.rotation.x = r.kneeR;
    this.arms[0].sh.rotation.x = r.shL; this.arms[1].sh.rotation.x = r.shR;
    this.arms[0].sh.rotation.z = -r.armOut; this.arms[1].sh.rotation.z = r.armOut;
    this.arms[0].el.rotation.x = r.elL; this.arms[1].el.rotation.x = r.elR;
    this.torso.rotation.x = r.torso;
    this.head.rotation.y = r.head * (st.mode === 'idle' ? 1 : 0);
    this.head.rotation.x = st.mode === 'slide' ? r.head : 0;
    this.body.rotation.x = r.bodyRot;
    this.body.position.y = r.bodyY;

    // cloak flutter
    const pos = this.cloak.geometry.attributes.position;
    const base = this.cloakBase;
    const flow = st.mode === 'idle' ? 0.05 : st.mode === 'slide' ? 0.15 : 0.35 + sp * 0.012;
    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 3], by = base[i * 3 + 1];
      const d = -by;
      const z = Math.pow(d, 1.4) * flow + Math.sin(t * 13 + d * 6 + bx * 4) * 0.045 * d * (0.4 + flow);
      pos.setXYZ(i, bx * (1 + d * 0.35), by + Math.pow(d, 2) * flow * 0.35, z);
    }
    pos.needsUpdate = true;
    this.cloak.geometry.computeVertexNormals();

    const su = this.shield.material.uniforms;
    su.uTime.value = t;
    su.uAlpha.value = damp(su.uAlpha.value, this.shieldOn ? 1 : 0, 8, dt);
    this.shield.visible = su.uAlpha.value > 0.02;
    this.shield.scale.setScalar(1 + Math.sin(t * 5) * 0.02);
  }
}
