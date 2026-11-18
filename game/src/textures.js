// BRISA BAY v5 — procedural textures. Every surface is painted on a canvas
// at load time, so the game ships no image files and loads nothing over the
// network. Seeded canvases keep the city identical on every run. v2 adds a
// glow sprite for lamps and pickups, neon shop signs, and the striped
// roadblock barrier face. v3 reuses the same glow sprite for the taxi
// beacons and the collectible parcels. v5: facades are painted per storey
// (floors/cols matched to the building, so tall towers stop stretching six
// window rows), windows get a recessed frame, sill and painted balcony,
// and every facade paints a second canvas — an emissive map — so its lit
// windows actually glow at sunset instead of being yellow paint.
import * as THREE from 'three';
import { makeCanvas, mulberry32, pick } from './utils.js';

// Wrap a painted canvas as a repeatable, colour-correct texture.
function paintTexture(canvas, repeatX = 1, repeatY = 1) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Sprinkle sun-bleach / grime specks over a filled canvas.
function speckle(g, rng, w, h, count, light, dark) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = rng() < 0.5 ? light : dark;
    g.fillRect(rng() * w, rng() * h, 2 + rng() * 4, 2 + rng() * 4);
  }
}

// A building face: warm stucco, rows of lit and dark windows, a cornice
// and a coloured awning stripe at street level. `floors` is the storey
// count (window rows above the ground floor), `cols` the window count
// across — the caller matches both to the building's size, so a tall
// tower gets more rows instead of taller windows. Returns the colour map
// and an emissive map (black except the lit windows), painted from the
// same seeded stream so the glow lands on exactly the windows that are lit.
export function facadeTexture(base, seed, floors = 6, cols = 4) {
  const rows = Math.max(1, floors - 1);
  const rng = mulberry32(seed);
  const c = makeCanvas(256, 256);
  const g = c.getContext('2d');
  const e = makeCanvas(256, 256);
  const eg = e.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  eg.fillStyle = '#000000';
  eg.fillRect(0, 0, 256, 256);
  speckle(g, rng, 256, 256, 900, 'rgba(255,255,255,0.05)', 'rgba(0,0,0,0.06)');
  // Faint floor lines across the window zone: the facade keeps its rhythm
  // even where a storey has no window.
  g.fillStyle = 'rgba(0,0,0,0.10)';
  for (let y = 40; y < 200; y += 26) g.fillRect(0, y, 256, 2);
  // Window grid: cols across, rows of storeys above the ground floor.
  const colW = 256 / cols;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = Math.round(col * colW + colW * 0.16);
      const y = 14 + row * 26;
      const w = Math.round(colW * 0.68);
      const h = 20;
      const lit = rng() < 0.4;
      // Recess: dark frame, then glass, then a sun glint and a sill.
      g.fillStyle = '#1a1e24';
      g.fillRect(x - 2, y - 2, w + 4, h + 4);
      g.fillStyle = lit ? '#ffd98a' : (rng() < 0.5 ? '#3d5a73' : '#2b3542');
      g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(x, y, w, 3);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(x - 2, y + h + 2, w + 4, 2);
      if (lit) {
        eg.fillStyle = '#ffca7a';
        eg.fillRect(x, y, w, h);
      }
      // Painted balcony on some windows: a slab, two rails, soft shadow.
      if (rng() < 0.35) {
        g.fillStyle = 'rgba(0,0,0,0.28)';
        g.fillRect(x - 4, y + h + 6, w + 8, 4);
        g.fillStyle = 'rgba(255,255,255,0.28)';
        g.fillRect(x - 4, y + h + 4, w + 8, 3);
        g.fillStyle = 'rgba(20,22,28,0.85)';
        g.fillRect(x - 2, y + h + 7, 2, 10);
        g.fillRect(x + w, y + h + 7, 2, 10);
      }
    }
  }
  // Cornice shadow, awning stripe, and a ground-floor door.
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 0, 256, 8);
  g.fillStyle = pick(rng, ['#c94f43', '#2e7d6b', '#d9a441', '#4a6fa5']);
  g.fillRect(0, 226, 256, 30);
  g.fillStyle = '#1d2733';
  g.fillRect(108, 196, 40, 60);
  g.fillStyle = 'rgba(255,217,138,0.85)';
  g.fillRect(112, 200, 32, 26);
  return { map: paintTexture(c), emissiveMap: paintTexture(e) };
}

// Asphalt with a dashed centre line and worn white edges.
export function roadTexture() {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d');
  g.fillStyle = '#2b2e33';
  g.fillRect(0, 0, 128, 128);
  speckle(g, mulberry32(7), 128, 128, 500, 'rgba(255,255,255,0.04)', 'rgba(0,0,0,0.12)');
  g.fillStyle = '#e8d24a';
  g.fillRect(62, 8, 4, 40);
  g.fillRect(62, 72, 4, 40);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillRect(6, 0, 3, 128);
  g.fillRect(119, 0, 3, 128);
  return paintTexture(c, 1, 4);
}

// Pavement slabs in a 4x4 grid.
export function pavementTexture() {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d');
  g.fillStyle = '#8f8578';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    g.beginPath();
    g.moveTo(i * 32, 0);
    g.lineTo(i * 32, 128);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i * 32);
    g.lineTo(128, i * 32);
    g.stroke();
  }
  return paintTexture(c, 6, 6);
}

// Beach sand with a few shells.
export function sandTexture() {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d');
  g.fillStyle = '#d9b380';
  g.fillRect(0, 0, 128, 128);
  const rng = mulberry32(21);
  for (let i = 0; i < 700; i++) {
    g.fillStyle = rng() < 0.5 ? 'rgba(255,240,200,0.35)' : 'rgba(120,90,50,0.25)';
    g.fillRect(rng() * 128, rng() * 128, 2, 2);
  }
  return paintTexture(c, 10, 10);
}

// A shop sign / billboard with big painted letters.
export function signTexture(text, bg, fg) {
  const c = makeCanvas(512, 128);
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = fg;
  g.lineWidth = 6;
  g.strokeRect(6, 6, 500, 116);
  g.fillStyle = fg;
  g.font = 'bold 64px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// A tall roadside billboard: sunburst background, two lines of copy.
export function billboardTexture(line1, line2) {
  const c = makeCanvas(512, 256);
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#ff9a3d');
  grad.addColorStop(1, '#d94f43');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = 'rgba(255,255,255,0.16)';
  for (let i = 0; i < 12; i++) {
    g.beginPath();
    g.moveTo(256, 256);
    g.lineTo(i * 48 - 24, 0);
    g.lineTo(i * 48 + 24, 0);
    g.fill();
  }
  g.strokeStyle = '#fff3d6';
  g.lineWidth = 8;
  g.strokeRect(10, 10, 492, 236);
  g.fillStyle = '#fff3d6';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '900 84px Arial, sans-serif';
  g.fillText(line1, 256, 96);
  g.font = '700 44px Arial, sans-serif';
  g.fillText(line2, 256, 182);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Flat pastel colour with a hint of vertical gradient, for rooftops.
export function roofTexture(base) {
  const c = makeCanvas(64, 64);
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, base);
  grad.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------------------------------------------------------------------------
// v2 additions.
// ---------------------------------------------------------------------------

// Glow sprite: a soft radial blob, used for street lamps, pickup halos,
// the sun disc glow and the lighthouse lamp. One texture, many sprites.
// v3 reuses it for the taxi beacons and the collectible parcels, so the
// new systems add no new texture code.
export function glowTexture() {
  const c = makeCanvas(64, 64);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Neon sign: dark plate, glowing tube lettering with a halo. Used for the
// shop fronts and the two neon billboards by the casino and the marina.
export function neonSignTexture(lines, color = '#ff4fd8', bg = '#12081a') {
  const c = makeCanvas(512, 128);
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = color;
  g.lineWidth = 3;
  g.globalAlpha = 0.5;
  g.strokeRect(10, 10, 492, 108);
  g.globalAlpha = 1;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 18;
  g.fillStyle = color;
  const n = lines.length;
  lines.forEach((line, i) => {
    g.font = `bold ${i === 0 ? 44 : 28}px Arial, sans-serif`;
    g.fillText(line, 256, 64 + (i - (n - 1) / 2) * 38);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Striped red/white barricade face for the police roadblocks.
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
  tex.anisotropy = 4;
  return tex;
}

// ---------------------------------------------------------------------------
// v5 additions: the ground stops being one flat slab.
// ---------------------------------------------------------------------------

// Zebra crossing: worn white bars on asphalt, one tile per intersection.
export function crosswalkTexture() {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d');
  g.fillStyle = '#2b2e33';
  g.fillRect(0, 0, 128, 128);
  speckle(g, mulberry32(11), 128, 128, 300, 'rgba(255,255,255,0.04)', 'rgba(0,0,0,0.12)');
  g.fillStyle = 'rgba(240,238,230,0.92)';
  for (let i = 0; i < 5; i++) {
    g.fillRect(8 + i * 24, 10, 14, 108);
  }
  return paintTexture(c);
}

// Plaza tiles: a pastel checkerboard for the four central intersections.
export function plazaTexture() {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d');
  for (let r = 0; r < 4; r++) {
    for (let col = 0; col < 4; col++) {
      g.fillStyle = (r + col) % 2 === 0 ? '#d8c9a8' : '#b8a888';
      g.fillRect(col * 32, r * 32, 32, 32);
    }
  }
  speckle(g, mulberry32(13), 128, 128, 350, 'rgba(255,255,255,0.06)', 'rgba(0,0,0,0.08)');
  g.strokeStyle = 'rgba(0,0,0,0.22)';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    g.beginPath();
    g.moveTo(i * 32, 0);
    g.lineTo(i * 32, 128);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i * 32);
    g.lineTo(128, i * 32);
    g.stroke();
  }
  return paintTexture(c, 2, 2);
}

// Kerb: pale concrete with a dark road-side edge and a pale top line.
export function kerbTexture() {
  const c = makeCanvas(128, 32);
  const g = c.getContext('2d');
  g.fillStyle = '#a89c86';
  g.fillRect(0, 0, 128, 32);
  speckle(g, mulberry32(17), 128, 32, 150, 'rgba(255,255,255,0.06)', 'rgba(0,0,0,0.10)');
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, 26, 128, 6);
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.fillRect(0, 0, 128, 3);
  return paintTexture(c, 8, 1);
}

// Wet sand: darker and denser than the dry beach, for the waterline band.
export function wetSandTexture() {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d');
  g.fillStyle = '#b98f5e';
  g.fillRect(0, 0, 128, 128);
  const rng = mulberry32(23);
  for (let i = 0; i < 600; i++) {
    g.fillStyle = rng() < 0.5 ? 'rgba(255,230,180,0.25)' : 'rgba(90,60,30,0.22)';
    g.fillRect(rng() * 128, rng() * 128, 2, 2);
  }
  return paintTexture(c, 8, 4);
}
