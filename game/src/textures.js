// BRISA BAY — procedural textures. Every surface is painted on a canvas
// at load time, so the game ships no image files and loads nothing over
// the network. Seeded canvases keep the city identical on every run.
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
// and a coloured awning stripe at street level.
export function facadeTexture(base, seed) {
  const rng = mulberry32(seed);
  const c = makeCanvas(256, 256);
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  speckle(g, rng, 256, 256, 900, 'rgba(255,255,255,0.05)', 'rgba(0,0,0,0.06)');
  // Window grid: 4 columns, 6 rows.
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 4; col++) {
      const x = 18 + col * 58;
      const y = 16 + row * 40;
      const lit = rng() < 0.4;
      g.fillStyle = '#20242c';
      g.fillRect(x - 2, y - 2, 34, 28);
      g.fillStyle = lit ? '#ffd98a' : (rng() < 0.5 ? '#3d5a73' : '#2b3542');
      g.fillRect(x, y, 30, 24);
      // Sun glint across the top of the pane.
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(x, y, 30, 3);
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
  return paintTexture(c);
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
  return tex;
}
