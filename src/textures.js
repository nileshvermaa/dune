import * as THREE from 'three';
import { mulberry32 } from './noise.js';

// Procedural textures generated at startup so the game ships with zero image assets.

const TAU = Math.PI * 2;

function dataTexture(data, size) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// Height field (row 0 = v 0) -> tangent-space normal map.
function normalFromHeight(h, size, strength) {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x];
      const dn = h[((y + 1) % size) * size + x];
      let nx = (l - r) * strength, ny = (u - dn) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  return dataTexture(d, size);
}

export function createSandTextures(size = 512) {
  const rnd = mulberry32(7);
  const h = new Float32Array(size * size);
  const col = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      // Integer frequencies keep the pattern tileable.
      const warp = 0.35 * Math.sin(TAU * (2 * u + v)) + 0.18 * Math.sin(TAU * (3 * u - 2 * v) + 1.3) + 0.08 * Math.sin(TAU * (7 * u + 3 * v) + 0.4);
      let r = Math.sin(TAU * (9 * v + 2 * u + warp)) * 0.5 + 0.5;
      r = Math.pow(r, 1.6);
      const r2 = 0.5 + 0.5 * Math.sin(TAU * (17 * v - 5 * u + warp * 1.7));
      const grain = rnd();
      const i = y * size + x;
      h[i] = r * 0.75 + r2 * 0.15 + grain * 0.1;
      const b = 0.84 + r * 0.1 + grain * 0.06;
      col[i * 4] = Math.min(255, b * 255);
      col[i * 4 + 1] = b * 0.97 * 255;
      col[i * 4 + 2] = b * 0.93 * 255;
      col[i * 4 + 3] = 255;
    }
  }
  const map = dataTexture(col, size);
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, normalMap: normalFromHeight(h, size, 3.2) };
}

export function createStoneTextures(size = 512) {
  const rnd = mulberry32(11);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#5b4631';
  g.fillRect(0, 0, size, size);
  const rows = 8, rowH = size / rows;
  for (let r = 0; r < rows; r++) {
    let x = rnd() * size;
    const end = x + size;
    while (x < end - 1) {
      let w = 60 + rnd() * 90;
      if (end - x - w < 50) w = end - x;
      const shade = 0.82 + rnd() * 0.26;
      g.fillStyle = `rgb(${Math.floor(200 * shade)},${Math.floor(160 * shade)},${Math.floor(114 * shade)})`;
      for (const ox of [0, -size]) g.fillRect(x + ox + 2, r * rowH + 2, w - 4, rowH - 4);
      // worn edges
      g.fillStyle = 'rgba(70,50,30,0.25)';
      for (const ox of [0, -size]) g.fillRect(x + ox + 2, r * rowH + rowH - 7, w - 4, 5);
      x += w;
    }
  }
  // cracks
  g.strokeStyle = 'rgba(60,40,24,0.7)';
  g.lineWidth = 1.2;
  for (let k = 0; k < 26; k++) {
    let px = rnd() * size, py = rnd() * size;
    g.beginPath();
    g.moveTo(px, py);
    for (let s = 0; s < 8; s++) { px += (rnd() - 0.5) * 22; py += (rnd() - 0.5) * 22; g.lineTo(px, py); }
    g.stroke();
  }
  const img = g.getImageData(0, 0, size, size);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = (rnd() - 0.5) * 28;
      img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
      img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
      img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n * 0.8));
      const lum = (img.data[i] * 0.3 + img.data[i + 1] * 0.59 + img.data[i + 2] * 0.11) / 255;
      // canvas row 0 is the top (v=1 once flipped); the DataTexture normal has row 0 at v=0
      h[(size - 1 - y) * size + x] = lum;
    }
  }
  g.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  return { map, normalMap: normalFromHeight(h, size, 5) };
}

export function createGlowTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Painted arrow used on junction floors.
export function createArrowTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  g.fillStyle = '#ffffff';
  g.shadowColor = '#ffffff';
  g.shadowBlur = 18;
  g.beginPath();
  g.moveTo(size * 0.82, size * 0.5);
  g.lineTo(size * 0.5, size * 0.2);
  g.lineTo(size * 0.5, size * 0.38);
  g.lineTo(size * 0.18, size * 0.38);
  g.lineTo(size * 0.18, size * 0.62);
  g.lineTo(size * 0.5, size * 0.62);
  g.lineTo(size * 0.5, size * 0.8);
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
