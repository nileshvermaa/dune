import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { damp, smoothstep } from '../../engine/noise.js';
import { $ } from '../dom.js';
import { SHIMMER, SUNSHAFTS, GRADE } from '../shaders.js';

// Rendering: quality presets, the post-processing chain, sun shafts and the performance governor.
// Installed on Game.prototype (see game/Game.js), so `this` is the Game.
export const RenderSystem = {
  applyQuality(changed = false) {
    const high = this.quality === 'high';
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, high ? 1.75 : 1));
    this.renderer.shadowMap.enabled = high;
    this.sky.setShadows(high);
    this.terrain.radius = high ? 430 : 300;
    this.track.ahead = high ? 650 : 480;
    if (high && !this.composer) {
      const w = window.innerWidth, h = window.innerHeight;
      this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType }));
      // the plain render pass draws until N8AO (loaded on demand: it is large) takes over
      this.renderPass = new RenderPass(this.scene, this.camera);
      this.composer.addPass(this.renderPass);
      this.loadAO(w, h);
      this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.5, 0.9);
      this.composer.addPass(this.bloom);
      this.shimmer = new ShaderPass(SHIMMER);
      this.composer.addPass(this.shimmer);
      this.shafts = new ShaderPass(SUNSHAFTS);
      this.composer.addPass(this.shafts);
      this.composer.addPass(new OutputPass());
      this.grade = new ShaderPass(GRADE);
      this.composer.addPass(this.grade);
      // anti-aliasing: the canvas's own MSAA does not survive a post chain (loaded on demand)
      import('three/addons/postprocessing/SMAAPass.js').then(({ SMAAPass }) => {
        const pr = this.renderer.getPixelRatio();
        this.smaa = new SMAAPass(window.innerWidth * pr, window.innerHeight * pr);
        this.composer.addPass(this.smaa);
      }).catch((err) => console.warn('SMAA unavailable', err));
      this.perf = { avg: 16, slowFor: 0, step: 0 };
    }
    if (changed) {
      this.scene.traverse((o) => {
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; });
      });
      this.resize();
    }
    $('quality-btn').textContent = `Quality · ${high ? 'High' : 'Low'}`;
    this.app.classList.toggle('css-grade', !high);
  },

  // N8AO renders the scene and adds contact shadows where props meet the sand
  loadAO(w, h) {
    import('n8ao').then(({ N8AOPass }) => {
      if (this.aoOff || !this.composer) return;
      const ao = new N8AOPass(this.scene, this.camera, w, h);
      Object.assign(ao.configuration, {
        aoRadius: 4, distanceFalloff: 2, intensity: 5, halfRes: true, depthAwareUpsampling: true,
        gammaCorrection: false, color: new THREE.Color(0.16, 0.08, 0.035),
      });
      ao.setQualityMode('Low');
      this.composer.insertPass(ao, 0);
      this.renderPass.enabled = false;
      this.ao = ao;
      this.resize();
    }).catch((err) => console.warn('Ambient occlusion unavailable', err));
  },

  // aim the rays at the sun's place on screen; strongest low in the sky, gone at night and in storms
  updateSunShafts(dt) {
    if (!this.shafts || !this.shafts.enabled) return;
    const sun = this.sky.uniforms.uSunDir.value;
    const sp = (this._sunScreen || (this._sunScreen = new THREE.Vector3())).copy(sun).multiplyScalar(1000).add(this.camera.position).project(this.camera);
    const inFront = sp.z < 1 ? 1 : 0;
    const onScreen = 1 - smoothstep(0.85, 1.7, Math.max(Math.abs(sp.x), Math.abs(sp.y)));
    const up = smoothstep(-0.04, 0.06, sun.y);
    const low = 1 - smoothstep(0.25, 0.75, sun.y);
    const want = inFront * onScreen * up * (0.7 + 0.9 * low) * (1 - this.atmo.haze * 0.85);
    const u = this.shafts.uniforms;
    u.uSun.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
    u.uStrength.value = damp(u.uStrength.value, want, 3, dt);
    u.uColor.value.copy(this.sky.uniforms.uSunColor.value);
  },

  // If high quality can't hold its frame rate, shed cost in steps: AO, then resolution, then rays.
  governPerformance(rawDt) {
    const pf = this.perf;
    if (!pf || this.quality !== 'high' || pf.hold || this.state !== 'running' || document.hidden || rawDt > 0.25) return;
    pf.avg += (rawDt * 1000 - pf.avg) * 0.05;
    pf.slowFor = pf.avg > 24 ? pf.slowFor + rawDt : Math.max(0, pf.slowFor - rawDt * 0.5);
    if (pf.slowFor < 3 || pf.step >= 3) return;
    pf.step++;
    pf.slowFor = 0;
    if (pf.step === 1) { if (this.ao) this.ao.enabled = false; this.renderPass.enabled = true; this.aoOff = true; }
    else if (pf.step === 2) { this.renderer.setPixelRatio(1); this.resize(); }
    else this.shafts.enabled = false;
  },

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
    const px = this.renderer.domElement.height * 0.85;
    this.dust.setScale(px);
    this.dustPool.setScale(px);
    this.glowPool.setScale(px);
    this.sandPool.setScale(px);
  },
};
