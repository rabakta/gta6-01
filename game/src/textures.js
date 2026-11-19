// BRISA BAY — procedural textures HD: every surface painted on canvas at load.
// Zero external assets. Seeded canvases = deterministic city.
// HD UPGRADE: 512×512 albedo, 256×256 normals, height maps, detail normals, AO, clearcoat normals.
import * as THREE from 'three';
import { makeCanvas, mulberry32, pick } from './utils.js';

// ─── HD CONFIG ──────────────────────────────────────────────
const HD = {
  ALBEDO: 512,      // color/emissive
  NORMAL: 256,      // macro normal
  DETAIL: 512,      // detail normal (high-freq)
  HEIGHT: 256,      // height/displacement
  ROUGHNESS: 512,   // roughness
  METALNESS: 512,   // metalness
  AO: 256,          // ambient occlusion
  CLEARCOAT: 512,   // car clearcoat normal
  ANISO: 16,        // max anisotropy
};

// ─── CACHES ─────────────────────────────────────────────────
const caches = {
  albedo: new Map(),
  emissive: new Map(),
  roughness: new Map(),
  metalness: new Map(),
  normal: new Map(),
  detailNormal: new Map(),
  height: new Map(),
  ao: new Map(),
  clearcoatNormal: new Map(),
};

// ─── TEXTURE WRAPPERS ───────────────────────────────────────
function makeTex(canvas, colorSpace, repeat = [1, 1]) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(...repeat);
  tex.anisotropy = HD.ANISO;
  tex.colorSpace = colorSpace;
  tex.needsUpdate = true;
  return tex;
}
const srgbTex = (c, r) => makeTex(c, THREE.SRGBColorSpace, r);
const linTex = (c, r) => makeTex(c, THREE.LinearSRGBColorSpace, r);

// ─── NOISE HELPERS ──────────────────────────────────────────
function simplex2D(x, y, rng) {
  const n = (a, b) => Math.sin(a * 12.9898 + b * 78.233 + rng() * 43758.5453) * 43758.5453;
  return (n(x, y) + n(x * 2, y * 2) * 0.5 + n(x * 4, y * 4) * 0.25) / 1.75;
}

function perlin2D(x, y, rng) {
  const hash = (ix, iy) => mulberry32((ix * 1315423911) ^ (iy * 2654435761) ^ Math.floor(rng() * 1e9))();
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const lerp = (a, b, t) => a + (b - a) * t;
  return lerp(
    lerp(hash(ix, iy), hash(ix + 1, iy), u),
    lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), u),
    v
  );
}

function fbm(x, y, octaves, rng, scale = 1) {
  let v = 0, a = 1, f = scale;
  for (let i = 0; i < octaves; i++) {
    v += a * simplex2D(x * f, y * f, rng);
    a *= 0.5;
    f *= 2;
  }
  return v;
}

// ─── ROUGHNESS / METALNESS ──────────────────────────────────
function generateRoughnessMap(baseRoughness, variation, seed, w = HD.ROUGHNESS, h = HD.ROUGHNESS) {
  const key = `rough_${baseRoughness}_${variation}_${seed}_${w}_${h}`;
  let tex = caches.roughness.get(key);
  if (tex) return tex;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const rng = mulberry32(seed);
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < w * h; i++) {
    const x = i % w, y = Math.floor(i / w);
    const noise = simplex2D(x * 0.02, y * 0.02, rng);
    const v = Math.max(0, Math.min(1, baseRoughness + (noise - 0.5) * variation));
    const val = Math.round(v * 255);
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = val;
    d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  tex = linTex(c);
  caches.roughness.set(key, tex);
  return tex;
}

function generateMetalnessMap(isMetal, seed, w = HD.METALNESS, h = HD.METALNESS) {
  const key = `metal_${isMetal}_${seed}_${w}_${h}`;
  let tex = caches.metalness.get(key);
  if (tex) return tex;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const rng = mulberry32(seed);
  const img = g.createImageData(w, h);
  const d = img.data;
  const base = isMetal ? 1 : 0;
  for (let i = 0; i < w * h; i++) {
    const x = i % w, y = Math.floor(i / w);
    let v = base;
    if (isMetal) {
      const edge = Math.min(x / 10, (w - x) / 10, y / 10, (h - y) / 10);
      const scratch = simplex2D(x * 0.05, y * 0.01, rng) > 0.98 ? 0.3 : 0;
      v = Math.max(0, base - edge * 0.2 - scratch);
    }
    const val = Math.round(v * 255);
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = val;
    d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  tex = linTex(c);
  caches.metalness.set(key, tex);
  return tex;
}

// ─── NORMAL MAPS (macro + detail) ───────────────────────────
function generateNormalMap(heightFn, seed, w = HD.NORMAL, h = HD.NORMAL, strength = 1.0) {
  const key = `normal_${seed}_${w}_${h}_${strength}`;
  let tex = caches.normal.get(key);
  if (tex) return tex;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;
  const heights = new Float32Array(w * h);
  const rng = mulberry32(seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      heights[y * w + x] = heightFn(x, y, rng);
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hL = heights[y * w + Math.max(0, x - 1)];
      const hR = heights[y * w + Math.min(w - 1, x + 1)];
      const hU = heights[Math.max(0, y - 1) * w + x];
      const hD = heights[Math.min(h - 1, y + 1) * w + x];
      const nx = (hL - hR) * strength;
      const ny = (hU - hD) * strength;
      const nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const i = (y * w + x) * 4;
      d[i] = Math.round((nx / len * 0.5 + 0.5) * 255);
      d[i + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      d[i + 2] = Math.round((nz / len * 0.5 + 0.5) * 255);
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  tex = linTex(c);
  caches.normal.set(key, tex);
  return tex;
}

// High-frequency detail normal (for close-up micro detail)
function generateDetailNormal(seed, w = HD.DETAIL, h = HD.DETAIL, strength = 0.3) {
  const key = `detailN_${seed}_${w}_${h}_${strength}`;
  let tex = caches.detailNormal.get(key);
  if (tex) return tex;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;
  const rng = mulberry32(seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n1 = simplex2D(x * 0.1, y * 0.1, rng);
      const n2 = simplex2D(x * 0.2, y * 0.05, rng);
      const nx = (n1 - 0.5) * strength;
      const ny = (n2 - 0.5) * strength;
      const nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const i = (y * w + x) * 4;
      d[i] = Math.round((nx / len * 0.5 + 0.5) * 255);
      d[i + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      d[i + 2] = Math.round((nz / len * 0.5 + 0.5) * 255);
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  tex = linTex(c);
  caches.detailNormal.set(key, tex);
  return tex;
}

// ─── HEIGHT / DISPLACEMENT ──────────────────────────────────
function generateHeightMap(heightFn, seed, w = HD.HEIGHT, h = HD.HEIGHT) {
  const key = `height_${seed}_${w}_${h}`;
  let tex = caches.height.get(key);
  if (tex) return tex;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;
  const rng = mulberry32(seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const h = heightFn(x, y, rng);
      const val = Math.round(Math.max(0, Math.min(1, h)) * 255);
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = val;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  tex = linTex(c);
  caches.height.set(key, tex);
  return tex;
}

// ─── AMBIENT OCCLUSION ──────────────────────────────────────
function generateAOMap(occlusionFn, seed, w = HD.AO, h = HD.AO) {
  const key = `ao_${seed}_${w}_${h}`;
  let tex = caches.ao.get(key);
  if (tex) return tex;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;
  const rng = mulberry32(seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ao = occlusionFn(x, y, rng);
      const val = Math.round(Math.max(0, Math.min(1, ao)) * 255);
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = val;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  tex = linTex(c);
  caches.ao.set(key, tex);
  return tex;
}

// ─── CLEARCOAT NORMAL (car paint orange peel) ───────────────
function generateClearcoatNormal(seed, w = HD.CLEARCOAT, h = HD.CLEARCOAT) {
  const key = `ccNormal_${seed}_${w}_${h}`;
  let tex = caches.clearcoatNormal.get(key);
  if (tex) return tex;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;
  const rng = mulberry32(seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = simplex2D(x * 0.04, y * 0.04, rng);
      const nx = (n - 0.5) * 0.08;
      const ny = (simplex2D(x * 0.04 + 100, y * 0.04, rng) - 0.5) * 0.08;
      const nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const i = (y * w + x) * 4;
      d[i] = Math.round((nx / len * 0.5 + 0.5) * 255);
      d[i + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      d[i + 2] = Math.round((nz / len * 0.5 + 0.5) * 255);
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  tex = linTex(c);
  caches.clearcoatNormal.set(key, tex);
  return tex;
}

// ─── SPECKLE ────────────────────────────────────────────────
function speckle(g, rng, w, h, count, light, dark) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = rng() < 0.5 ? light : dark;
    g.fillRect(rng() * w, rng() * h, 2 + rng() * 4, 2 + rng() * 4);
  }
}

// ─── FACADE TEXTURE (HD) ────────────────────────────────────
export function facadeTexture(base, seed, floors = 6, cols = 4) {
  const rows = Math.max(1, floors - 1);
  const rng = mulberry32(seed);
  const W = HD.ALBEDO, H = HD.ALBEDO;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const e = makeCanvas(W, H);
  const eg = e.getContext('2d');

  // Albedo
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  eg.fillStyle = '#000000';
  eg.fillRect(0, 0, W, H);

  // Subtle grime variation
  speckle(g, rng, W, H, 3000, 'rgba(255,255,255,0.03)', 'rgba(0,0,0,0.04)');

  // Floor lines
  g.fillStyle = 'rgba(0,0,0,0.08)';
  for (let y = 60; y < H - 40; y += 40) g.fillRect(0, y, W, 2);

  // Window grid
  const colW = W / cols;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = Math.round(col * colW + colW * 0.16);
      const y = 20 + row * 40;
      const w = Math.round(colW * 0.68);
      const h = 32;
      const lit = rng() < 0.4;
      g.fillStyle = '#1a1e24';
      g.fillRect(x - 3, y - 3, w + 6, h + 6);
      g.fillStyle = lit ? pick(rng, ['#ffd98a', '#ffb45e', '#ffe9b8']) : pick(rng, ['#3d5a73', '#2b3542', '#4a6b52']);
      g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(255,255,255,0.2)';
      g.fillRect(x, y, w, 4);
      g.fillStyle = 'rgba(255,255,255,0.3)';
      g.fillRect(x - 3, y + h + 3, w + 6, 3);
      if (lit) {
        eg.fillStyle = '#ffca7a';
        eg.fillRect(x, y, w, h);
      }
      if (rng() < 0.35) {
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(x - 5, y + h + 9, w + 10, 5);
        g.fillStyle = 'rgba(255,255,255,0.2)';
        g.fillRect(x - 5, y + h + 6, w + 10, 4);
        g.fillStyle = 'rgba(20,22,28,0.8)';
      }
    }
  }

  // ─── Height map (window recesses, cornices, balcony slabs) ───
  const heightFn = (x, y, r) => {
    let h = 0;
    // Window recesses
    const colW2 = W / cols;
    const cIdx = Math.floor((x % colW2) / colW2 * cols);
    const rIdx = Math.floor(y / 40);
    if (rIdx < rows && cIdx < cols) {
      const wx = Math.round(cIdx * colW2 + colW2 * 0.16);
      const wy = 20 + rIdx * 40;
      const ww = Math.round(colW2 * 0.68);
      const wh = 32;
      if (x >= wx - 3 && x <= wx + ww + 3 && y >= wy - 3 && y <= wy + wh + 3) h = 0.02;
      if (x >= wx && x <= wx + ww && y >= wy && y <= wy + wh) h = -0.04;
    }
    // Cornice lines
    for (let ry = 60; ry < H - 40; ry += 40) {
      if (Math.abs(y - ry) < 2) h = Math.max(h, 0.015);
    }
    return Math.max(-0.1, Math.min(0.1, h));
  };

  // ─── AO map (window frames, corners) ───
  const aoFn = (x, y, r) => {
    let ao = 1;
    // Window frame occlusion
    const colW2 = W / cols;
    const cIdx = Math.floor((x % colW2) / colW2 * cols);
    const rIdx = Math.floor(y / 40);
    if (rIdx < rows && cIdx < cols) {
      const wx = Math.round(cIdx * colW2 + colW2 * 0.16);
      const wy = 20 + rIdx * 40;
      const ww = Math.round(colW2 * 0.68);
      const wh = 32;
      const dx = Math.max(wx - 3 - x, 0, x - (wx + ww + 3));
      const dy = Math.max(wy - 3 - y, 0, y - (wy + wh + 3));
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 8) ao = Math.min(ao, 0.4 + 0.6 * (d / 8));
    }
    return ao;
  };

  // ─── Generate all maps ───
  const albedo = srgbTex(c);
  const emissive = srgbTex(e);
  const roughness = generateRoughnessMap(0.85, 0.15, seed + 1);
  const metalness = generateMetalnessMap(false, seed + 2);
  const normal = generateNormalMap(heightFn, seed + 3);
  const detailNormal = generateDetailNormal(seed + 4);
  const height = generateHeightMap(heightFn, seed + 5);
  const ao = generateAOMap(aoFn, seed + 6);
  const clearcoatNormal = generateClearcoatNormal(seed + 7);

  // Cache albedo/emissive
  caches.albedo.set(`facade_${base}_${seed}_${floors}_${cols}`, albedo);
  caches.emissive.set(`facade_${base}_${seed}_${floors}_${cols}`, emissive);

  return {
    map: albedo,
    emissiveMap: emissive,
    roughnessMap: roughness,
    metalnessMap: metalness,
    normalMap: normal,
    detailNormalMap: detailNormal,
    displacementMap: height,
    displacementScale: 0.05,
    aoMap: ao,
    clearcoatNormalMap: clearcoatNormal,
  };
}

// ─── ROAD TEXTURE (HD) ──────────────────────────────────────
export function roadTexture() {
  const seed = 20261120;
  const rng = mulberry32(seed);
  const W = HD.ALBEDO, H = HD.ALBEDO;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');

  g.fillStyle = '#2a2d33';
  g.fillRect(0, 0, W, H);

  // Asphalt aggregate
  for (let i = 0; i < 15000; i++) {
    const x = rng() * W, y = rng() * H;
    const v = 35 + rng() * 15;
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(x, y, 1 + rng() * 2, 1 + rng() * 2);
  }
  // Tire wear strips
  g.fillStyle = 'rgba(15,15,15,0.4)';
  for (let y = H * 0.3; y < H * 0.7; y += 40) g.fillRect(0, y, W, 2);

  const heightFn = (x, y) => {
    let h = 0;
    // Aggregate bumps
    h += fbm(x * 0.05, y * 0.05, 3, mulberry32(x * 1000 + y)) * 0.008;
    // Tire grooves
    for (let gy = H * 0.3; gy < H * 0.7; gy += 40) {
      if (Math.abs(y - gy) < 1) h = -0.01;
    }
    return h;
  };

  const aoFn = (x, y) => {
    let ao = 1;
    for (let gy = H * 0.3; gy < H * 0.7; gy += 40) {
      if (Math.abs(y - gy) < 2) ao = Math.min(ao, 0.6);
    }
    return ao;
  };

  return {
    map: srgbTex(c),
    roughnessMap: generateRoughnessMap(0.95, 0.05, seed + 1),
    metalnessMap: generateMetalnessMap(false, seed + 2),
    normalMap: generateNormalMap(heightFn, seed + 3, HD.NORMAL, HD.NORMAL, 0.8),
    detailNormalMap: generateDetailNormal(seed + 4, HD.DETAIL, HD.DETAIL, 0.4),
    displacementMap: generateHeightMap(heightFn, seed + 5),
    displacementScale: 0.02,
    aoMap: generateAOMap(aoFn, seed + 6),
    clearcoatNormalMap: generateClearcoatNormal(seed + 7),
  };
}

// ─── PAVEMENT TEXTURE (HD) ──────────────────────────────────
export function pavementTexture() {
  const seed = 20261121;
  const rng = mulberry32(seed);
  const W = HD.ALBEDO, H = HD.ALBEDO;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');

  g.fillStyle = '#bfb49e';
  g.fillRect(0, 0, W, H);
  speckle(g, rng, W, H, 5000, 'rgba(220,210,190,0.3)', 'rgba(160,150,130,0.3)');

  // Paver grid lines
  g.fillStyle = 'rgba(120,110,90,0.4)';
  for (let x = 0; x < W; x += 64) g.fillRect(x, 0, 1, H);
  for (let y = 0; y < H; y += 64) g.fillRect(0, y, W, 1);

  const heightFn = (x, y) => {
    let h = 0;
    // Paver edges
    if (x % 64 < 2 || (64 - x % 64) < 2 || y % 64 < 2 || (64 - y % 64) < 2) h = 0.01;
    return h;
  };

  const aoFn = (x, y) => {
    let ao = 1;
    if (x % 64 < 3 || y % 64 < 3) ao = 0.7;
    return ao;
  };

  return {
    map: srgbTex(c),
    roughnessMap: generateRoughnessMap(0.88, 0.08, seed + 1),
    metalnessMap: generateMetalnessMap(false, seed + 2),
    normalMap: generateNormalMap(heightFn, seed + 3, HD.NORMAL, HD.NORMAL, 0.6),
    detailNormalMap: generateDetailNormal(seed + 4, HD.DETAIL, HD.DETAIL, 0.3),
    displacementMap: generateHeightMap(heightFn, seed + 5),
    displacementScale: 0.015,
    aoMap: generateAOMap(aoFn, seed + 6),
    clearcoatNormalMap: generateClearcoatNormal(seed + 7),
  };
}

// ─── SAND TEXTURE (HD) ──────────────────────────────────────
export function sandTexture() {
  const seed = 20261122;
  const rng = mulberry32(seed);
  const W = HD.ALBEDO, H = HD.ALBEDO;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');

  g.fillStyle = '#d9b380';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 40000; i++) {
    const x = rng() * W, y = rng() * H;
    const v = 180 + rng() * 60;
    g.fillStyle = `rgb(${v},${Math.round(v*0.85)},${Math.round(v*0.6)})`;
    g.fillRect(x, y, 1, 1);
  }

  const heightFn = (x, y) => fbm(x * 0.08, y * 0.08, 4, mulberry32(x * 100 + y)) * 0.02;
  const aoFn = () => 1;

  return {
    map: srgbTex(c),
    roughnessMap: generateRoughnessMap(0.98, 0.02, seed + 1),
    metalnessMap: generateMetalnessMap(false, seed + 2),
    normalMap: generateNormalMap(heightFn, seed + 3, HD.NORMAL, HD.NORMAL, 0.7),
    detailNormalMap: generateDetailNormal(seed + 4, HD.DETAIL, HD.DETAIL, 0.5),
    displacementMap: generateHeightMap(heightFn, seed + 5),
    displacementScale: 0.03,
    aoMap: generateAOMap(aoFn, seed + 6),
    clearcoatNormalMap: generateClearcoatNormal(seed + 7),
  };
}

// ─── ROOF TEXTURE (HD) ──────────────────────────────────────
export function roofTexture(hex) {
  const seed = Math.abs(parseInt(hex.replace('#', ''), 16) + 3000);
  const rng = mulberry32(seed);
  const W = HD.ALBEDO, H = HD.ALBEDO;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');

  const base = parseInt(hex.replace('#', ''), 16);
  const r = (base >> 16) & 255, gC = (base >> 8) & 255, b = base & 255;
  g.fillStyle = hex;
  g.fillRect(0, 0, W, H);

  // Tile pattern
  g.fillStyle = `rgba(${Math.max(0,r-30)},${Math.max(0,gC-30)},${Math.max(0,b-30)},0.4)`;
  for (let y = 0; y < H; y += 48) {
    for (let x = (y / 48 % 2) * 32; x < W; x += 64) {
      g.fillRect(x, y, 32, 24);
    }
  }
  speckle(g, rng, W, H, 2000, 'rgba(255,255,255,0.05)', 'rgba(0,0,0,0.08)');

  const heightFn = (x, y) => {
    let h = 0;
    const tileX = Math.floor(x / 64), tileY = Math.floor(y / 48);
    if ((tileX + tileY) % 2 === 0) {
      const lx = x % 64, ly = y % 48;
      if (lx < 32 && ly < 24) h = 0.02;
    }
    return h;
  };

  const aoFn = (x, y) => {
    const lx = x % 64, ly = y % 48;
    if (lx < 2 || lx > 62 || ly < 2 || ly > 46) return 0.5;
    return 1;
  };

  return {
    map: srgbTex(c),
    roughnessMap: generateRoughnessMap(0.85, 0.1, seed + 1),
    metalnessMap: generateMetalnessMap(false, seed + 2),
    normalMap: generateNormalMap(heightFn, seed + 3, HD.NORMAL, HD.NORMAL, 0.9),
    detailNormalMap: generateDetailNormal(seed + 4, HD.DETAIL, HD.DETAIL, 0.4),
    displacementMap: generateHeightMap(heightFn, seed + 5),
    displacementScale: 0.025,
    aoMap: generateAOMap(aoFn, seed + 6),
    clearcoatNormalMap: generateClearcoatNormal(seed + 7),
  };
}

// ─── WET SAND TEXTURE (HD) ──────────────────────────────────
export function wetSandTexture() {
  const seed = 20261123;
  const rng = mulberry32(seed);
  const W = HD.ALBEDO, H = HD.ALBEDO;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');

  g.fillStyle = '#8a7a5a';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 30000; i++) {
    const x = rng() * W, y = rng() * H;
    const v = 100 + rng() * 50;
    g.fillStyle = `rgb(${v},${Math.round(v*0.9)},${Math.round(v*0.7)})`;
    g.fillRect(x, y, 1, 1);
  }

  const heightFn = (x, y) => {
    // Wet ripples
    return Math.sin(x * 0.2) * Math.cos(y * 0.15) * 0.01 + fbm(x * 0.1, y * 0.1, 3, mulberry32(x + y)) * 0.008;
  };

  return {
    map: srgbTex(c),
    roughnessMap: generateRoughnessMap(0.3, 0.15, seed + 1), // Wet = smoother
    metalnessMap: generateMetalnessMap(false, seed + 2),
    normalMap: generateNormalMap(heightFn, seed + 3, HD.NORMAL, HD.NORMAL, 1.2),
    detailNormalMap: generateDetailNormal(seed + 4, HD.DETAIL, HD.DETAIL, 0.6),
    displacementMap: generateHeightMap(heightFn, seed + 5),
    displacementScale: 0.02,
    aoMap: generateAOMap(() => 1, seed + 6),
    clearcoatNormalMap: generateClearcoatNormal(seed + 7),
  };
}

// ─── KERB TEXTURE (HD) ──────────────────────────────────────
export function kerbTexture() {
  const seed = 20261124;
  const W = HD.ALBEDO, H = HD.ALBEDO;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');

  g.fillStyle = '#5a5f66';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#7a8a9a';
  for (let x = 0; x < W; x += 32) g.fillRect(x, 0, 2, H);

  const heightFn = (x, y) => (x % 32 < 3 ? 0.03 : 0);
  const aoFn = (x, y) => (x % 32 < 4 ? 0.6 : 1);

  return {
    map: srgbTex(c),
    roughnessMap: generateRoughnessMap(0.75, 0.1, seed + 1),
    metalnessMap: generateMetalnessMap(false, seed + 2),
    normalMap: generateNormalMap(heightFn, seed + 3, HD.NORMAL, HD.NORMAL, 1.0),
    detailNormalMap: generateDetailNormal(seed + 4, HD.DETAIL, HD.DETAIL, 0.4),
    displacementMap: generateHeightMap(heightFn, seed + 5),
    displacementScale: 0.04,
    aoMap: generateAOMap(aoFn, seed + 6),
    clearcoatNormalMap: generateClearcoatNormal(seed + 7),
  };
}

// ─── CROSSWALK / PLAZA (HD) ─────────────────────────────────
export function crosswalkTexture() {
  const seed = 20261125;
  const W = HD.ALBEDO, H = HD.ALBEDO;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');

  g.fillStyle = '#2a2d33';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#e8e8e0';
  for (let x = 0; x < W; x += 40) g.fillRect(x, 0, 20, H);

  const heightFn = (x, y) => (Math.floor(x / 20) % 2 === 0 ? 0.015 : -0.005);
  const aoFn = (x, y) => (x % 40 < 2 || x % 40 > 38 ? 0.6 : 1);

  return {
    map: srgbTex(c),
    roughnessMap: generateRoughnessMap(0.85, 0.1, seed + 1),
    metalnessMap: generateMetalnessMap(false, seed + 2),
    normalMap: generateNormalMap(heightFn, seed + 3, HD.NORMAL, HD.NORMAL, 0.8),
    detailNormalMap: generateDetailNormal(seed + 4, HD.DETAIL, HD.DETAIL, 0.3),
    displacementMap: generateHeightMap(heightFn, seed + 5),
    displacementScale: 0.02,
    aoMap: generateAOMap(aoFn, seed + 6),
    clearcoatNormalMap: generateClearcoatNormal(seed + 7),
  };
}

export function plazaTexture() {
  const seed = 20261126;
  const W = HD.ALBEDO, H = HD.ALBEDO;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');

  g.fillStyle = '#c8b8a8';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#a89888';
  for (let x = 0; x < W; x += 32) g.fillRect(x, 0, 1, H);
  for (let y = 0; y < H; y += 32) g.fillRect(0, y, W, 1);

  const heightFn = (x, y) => {
    if (x % 32 < 2 || y % 32 < 2) return 0.01;
    return 0;
  };
  const aoFn = (x, y) => (x % 32 < 3 || y % 32 < 3 ? 0.5 : 1);

  return {
    map: srgbTex(c),
    roughnessMap: generateRoughnessMap(0.8, 0.1, seed + 1),
    metalnessMap: generateMetalnessMap(false, seed + 2),
    normalMap: generateNormalMap(heightFn, seed + 3, HD.NORMAL, HD.NORMAL, 0.7),
    detailNormalMap: generateDetailNormal(seed + 4, HD.DETAIL, HD.DETAIL, 0.3),
    displacementMap: generateHeightMap(heightFn, seed + 5),
    displacementScale: 0.015,
    aoMap: generateAOMap(aoFn, seed + 6),
    clearcoatNormalMap: generateClearcoatNormal(seed + 7),
  };
}

// ─── GLOW TEXTURE (unchanged) ───────────────────────────────
export function glowTexture() {
  const c = makeCanvas(64, 64);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.3)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// ─── SIGN / BILLBOARD / NEON (unchanged) ────────────────────
export function signTexture(title, bg = '#1d2733', fg = '#ffd98a') {
  const c = makeCanvas(512, 128);
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 128);
  g.font = 'bold 48px Arial'; g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(title, 256, 64);
  return srgbTex(c);
}

export function billboardTexture(top, bottom) {
  const c = makeCanvas(512, 256);
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#1a1218'); grad.addColorStop(1, '#0d080c');
  g.fillStyle = grad; g.fillRect(0, 0, 512, 256);
  g.font = 'bold 72px Arial'; g.fillStyle = '#ffd34d'; g.textAlign = 'center';
  g.fillText(top, 256, 90);
  g.font = '40px Arial'; g.fillStyle = '#ffb84f';
  g.fillText(bottom, 256, 170);
  return srgbTex(c);
}

export function neonSignTexture(lines, color = '#ff4fd8') {
  const c = makeCanvas(512, 64 * lines.length);
  const g = c.getContext('2d');
  g.fillStyle = '#0d080c'; g.fillRect(0, 0, 512, c.height);
  g.font = 'bold 36px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => {
    const y = 32 + i * 64;
    // Glow
    g.shadowColor = color; g.shadowBlur = 20;
    g.fillStyle = color; g.fillText(l, 256, y);
    g.shadowBlur = 0;
    g.fillStyle = '#fff'; g.fillText(l, 256, y);
  });
  return srgbTex(c);
}

export function barrierTexture() {
  const c = makeCanvas(128, 32);
  const g = c.getContext('2d');
  g.fillStyle = '#e8e2d0';
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#c22e2e';
  for (let x = -32; x < 128; x += 32) {
    g.beginPath();
    g.moveTo(x, 32); g.lineTo(x + 16, 0); g.lineTo(x + 32, 0); g.lineTo(x + 16, 32);
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = HD.ANISO;
  return tex;
}