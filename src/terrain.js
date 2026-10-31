import * as THREE from 'three';
import { createNoise2D, smoothstep, hash2, mulberry32 } from './noise.js';
import { tex, makeRock, makeWormSkeleton, makeStoneCircle, makeSietch } from './props.js';
import { detailed } from './materials.js';

// Infinite dune field streamed in chunks around the player.
// Dunes flatten into a sand bed along the causeway so the track always reads clearly.

export const CHUNK = 96;
const RES = 48;
const N = RES + 1;
const P = N + 2;
const STEP = CHUNK / RES;
export const SAND_BED = -2.6;

const C_TROUGH = new THREE.Color('#b47643');
const C_CREST = new THREE.Color('#f2cd94');
const C_BED = new THREE.Color('#a8774c');
const C_RUST = new THREE.Color('#b0603a');
const C_PALE = new THREE.Color('#f3dcb4');

export class Terrain {
  constructor(scene, lines) {
    this.scene = scene;
    this.lines = lines; // shared array of track centerlines {ax,az,bx,bz,minx,minz,maxx,maxz}
    this.noise = createNoise2D(1337);
    this.chunks = new Map();
    this.radius = 400;
    this.castShadow = false;
    this.material = detailed(new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: tex.sand.map,
      normalMap: tex.sand.normalMap,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 1,
      metalness: 0,
    }), { scale: 0.035, strength: 0.18, bump: 0, sparkle: 1.4 });
    const idx = new Uint16Array(RES * RES * 6);
    let k = 0;
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
    }
    this.index = new THREE.BufferAttribute(idx, 1);
    this._cand = [];
  }

  rawHeight(x, z) {
    const n = this.noise;
    const wx = x + n(x * 0.0025, z * 0.0025) * 70;
    const wz = z + n(x * 0.0025 + 31.7, z * 0.0025 + 17.3) * 70;
    const big = (n(wx * 0.0022, wz * 0.0022) * 0.5 + 0.5) * 26;
    const rr = 1 - Math.abs(n(wx * 0.0085, wz * 0.0145));
    const dune = rr * rr * rr * 18 * (0.55 + 0.45 * (n(x * 0.005 + 9, z * 0.005 - 4) * 0.5 + 0.5));
    return big + dune + n(x * 0.035, z * 0.035) * 0.7 - 3;
  }

  heightWithDist(x, z, d) {
    const f = smoothstep(9, 62, d);
    const base = SAND_BED + this.noise(x * 0.07, z * 0.07) * 0.25;
    if (f <= 0) return base;
    return base + (this.rawHeight(x, z) - base) * f;
  }

  collect(minx, minz, maxx, maxz, pad, out) {
    out.length = 0;
    for (const l of this.lines) {
      if (l.maxx + pad < minx || l.minx - pad > maxx || l.maxz + pad < minz || l.minz - pad > maxz) continue;
      out.push(l);
    }
    return out;
  }

  static distTo(x, z, cand) {
    let best = 1e9;
    for (let i = 0; i < cand.length; i++) {
      const l = cand[i];
      const dx = l.bx - l.ax, dz = l.bz - l.az;
      const len2 = dx * dx + dz * dz;
      let t = ((x - l.ax) * dx + (z - l.az) * dz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = l.ax + dx * t - x, pz = l.az + dz * t - z;
      const d = px * px + pz * pz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  trackDistance(x, z) {
    return Terrain.distTo(x, z, this.collect(x, z, x, z, 80, this._cand));
  }

  heightAt(x, z) {
    return this.heightWithDist(x, z, this.trackDistance(x, z));
  }

  buildChunk(cx, cz, existing) {
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const cand = this.collect(ox, oz, ox + CHUNK, oz + CHUNK, 70, []);
    const H = new Float32Array(P * P);
    const D = new Float32Array(P * P);
    for (let j = 0; j < P; j++) {
      for (let i = 0; i < P; i++) {
        const x = ox + (i - 1) * STEP, z = oz + (j - 1) * STEP;
        const d = cand.length ? Terrain.distTo(x, z, cand) : 1e9;
        D[j * P + i] = d;
        H[j * P + i] = this.heightWithDist(x, z, d);
      }
    }
    const pos = new Float32Array(N * N * 3);
    const nor = new Float32Array(N * N * 3);
    const col = new Float32Array(N * N * 3);
    const uv = new Float32Array(N * N * 2);
    const c = new THREE.Color();
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = (j + 1) * P + (i + 1);
        const v = j * N + i;
        const h = H[k];
        pos[v * 3] = i * STEP; pos[v * 3 + 1] = h; pos[v * 3 + 2] = j * STEP;
        let nx = H[k - 1] - H[k + 1], ny = 2 * STEP, nz = H[k - P] - H[k + P];
        const len = Math.hypot(nx, ny, nz);
        nx /= len; ny /= len; nz /= len;
        nor[v * 3] = nx; nor[v * 3 + 1] = ny; nor[v * 3 + 2] = nz;
        uv[v * 2] = (ox + i * STEP) / 6; uv[v * 2 + 1] = (oz + j * STEP) / 6;
        const t = Math.pow(Math.min(1, Math.max(0, (h + 3) / 38)), 0.8);
        c.copy(C_TROUGH).lerp(C_CREST, t);
        // windward slopes lighter, lee slopes darker
        const lee = Math.max(0, nx * 0.7 - nz * 0.3);
        c.multiplyScalar(1 - (1 - ny) * 0.25 - lee * 0.12);
        const wx = ox + i * STEP, wz = oz + j * STEP;
        const macro = this.noise(wx * 0.0016 + 50, wz * 0.0016 - 20);
        c.lerp(C_RUST, Math.max(0, macro) * 0.32);
        c.lerp(C_PALE, Math.max(0, -macro - 0.2) * 0.3 * t);
        c.lerp(C_BED, 1 - smoothstep(6, 40, D[k]));
        col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
      }
    }
    let mesh = existing;
    if (mesh) {
      mesh.geometry.dispose();
      for (let i = mesh.children.length - 1; i >= 0; i--) mesh.remove(mesh.children[i]);
    } else {
      mesh = new THREE.Mesh(undefined, this.material);
      mesh.position.set(ox, 0, oz);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    mesh.geometry = g;
    this.addLandmarks(mesh, cx, cz, H, D);
    return mesh;
  }

  // Deterministic giant rock formations far from the causeway.
  addLandmarks(mesh, cx, cz, H, D) {
    const kc = (Math.floor(N / 2) + 1) * P + (Math.floor(N / 2) + 1);
    const big = hash2(cx, cz, 555);
    if (D[kc] > 170 && big < 0.09) {
      const lm = big < 0.035 ? makeWormSkeleton() : big < 0.065 ? makeStoneCircle() : makeSietch();
      lm.position.set(CHUNK / 2, H[kc] + (big < 0.035 ? 3 : 0.5), CHUNK / 2);
      lm.rotation.y = hash2(cx, cz, 77) * Math.PI * 2;
      lm.traverse((o) => { o.matrixAutoUpdate = false; });
      lm.traverse((o) => o.updateMatrix());
      mesh.add(lm);
      return;
    }
    const r = hash2(cx, cz, 99);
    const rnd = mulberry32((hash2(cx, cz, 7) * 1e9) | 0);
    const tries = r < 0.18 ? 1 : r < 0.3 ? 2 : 0;
    for (let t = 0; t < tries; t++) {
      const i = 6 + Math.floor(rnd() * (RES - 12)), j = 6 + Math.floor(rnd() * (RES - 12));
      const k = (j + 1) * P + (i + 1);
      if (D[k] < 120) continue;
      let rock;
      if (r < 0.18) {
        const w = 28 + rnd() * 45;
        rock = makeRock('mesa', Math.floor(rnd() * 4), w, 35 + rnd() * 55, w * (0.6 + rnd() * 0.6));
        rock.position.set(i * STEP, H[k] - 5, j * STEP);
      } else {
        const s = 6 + rnd() * 10;
        rock = makeRock('spire', Math.floor(rnd() * 4), s, s * (2.5 + rnd() * 2), s);
        rock.position.set(i * STEP, H[k] - 1.5, j * STEP);
      }
      rock.rotation.y = rnd() * Math.PI * 2;
      rock.castShadow = false;
      rock.matrixAutoUpdate = false;
      rock.updateMatrix();
      mesh.add(rock);
    }
  }

  markDirty(minx, minz, maxx, maxz) {
    for (const ch of this.chunks.values()) {
      const ox = ch.cx * CHUNK, oz = ch.cz * CHUNK;
      if (ox > maxx || ox + CHUNK < minx || oz > maxz || oz + CHUNK < minz) continue;
      ch.dirty = true;
    }
  }

  update(px, pz, budget = 2) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    const rc = Math.ceil(this.radius / CHUNK) + 1;
    const want = [];
    const lim = this.radius + CHUNK * 0.75;
    for (let dz = -rc; dz <= rc; dz++) {
      for (let dx = -rc; dx <= rc; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        const ccx = (cx + 0.5) * CHUNK - px, ccz = (cz + 0.5) * CHUNK - pz;
        const d = Math.hypot(ccx, ccz);
        if (d > lim) continue;
        const key = cx + ',' + cz;
        const ch = this.chunks.get(key);
        if (!ch || ch.dirty) want.push({ cx, cz, key, d, ch });
      }
    }
    want.sort((a, b) => a.d - b.d);
    let built = 0;
    for (const w of want) {
      if (built >= budget) break;
      const mesh = this.buildChunk(w.cx, w.cz, w.ch && w.ch.mesh);
      if (w.ch) w.ch.dirty = false;
      else this.chunks.set(w.key, { cx: w.cx, cz: w.cz, mesh, dirty: false });
      built++;
    }
    const drop = this.radius + CHUNK * 1.6;
    for (const [key, ch] of this.chunks) {
      const d = Math.hypot((ch.cx + 0.5) * CHUNK - px, (ch.cz + 0.5) * CHUNK - pz);
      if (d > drop) {
        this.scene.remove(ch.mesh);
        ch.mesh.geometry.dispose();
        this.chunks.delete(key);
      }
    }
  }

  buildAll(px, pz) {
    this.update(px, pz, 1e6);
  }

  clear() {
    for (const ch of this.chunks.values()) {
      this.scene.remove(ch.mesh);
      ch.mesh.geometry.dispose();
    }
    this.chunks.clear();
  }
}
