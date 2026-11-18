// BRISA BAY — procedural textures. Every surface is painted on a canvas at
// load time, so the game ships no image files and loads nothing over the net.
import * as THREE from 'three';
import { makeCanvas, mulberry32, pick } from './utils.js';

function canvasTexture(canvas, repeatX = 1, repeatY = 1) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A building face: warm stucco, rows of lit and dark windows, a cornice.
export function facadeTexture(base, seed) {
  const rng = mulberry32(seed);
  const c = makeCanvas(256, 256);
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  // Sun-bleached noise.
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    g.fillRect(rng() * 256, rng() * 256, 2 + rng() * 4, 2 + rng() * 4);
  }
  // Window grid: 4 columns, 6 rows.
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 4; col++) {
      const x = 18 + col * 58, y = 16 + row * 40;
      const lit = rng() < 0.4;
      g.fillStyle = '#20242c';
      g.fillRect(x - 2, y - 2, 34, 28);
      g.fillStyle = lit ? '#ffd98a' : (rng() < 0.5 ? '#3d5a73' : '#2b3542');
      g.fillRect(x, y, 30, 24);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(x, y, 30, 3);
    }
  }
  // Cornice + ground-floor awning stripe.
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 0, 256, 8);
  g.fillStyle = pick(rng, ['#c94f43', '#2e7d6b', '#d9a441', '#4a6fa5']);
  g.fillRect(0, 226, 256, 30);
  return canvasTexture(c);
}

// Asphalt with a dashed centre line and worn edges.
export function roadTexture() {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d');
  g.fillStyle = '#2b2e33';
  g.fillRect(0, 0, 128, 128);
  const rng = mulberry32(7);
  for (let i = 0; i < 500; i++) {
    g.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.12)';
    g.fillRect(rng() * 128, rng() * 128, 2, 2);
  }
  g.fillStyle = '#e8d24a';
  g.fillRect(62, 8, 4, 40);
  g.fillRect(62, 72, 4, 40);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillRect(6, 0, 3, 128);
  g.fillRect(119, 0, 3, 128);
  return canvasTexture(c, 1, 4);
}

// Pavement slabs.
export function pavementTexture() {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d');
  g.fillStyle = '#8f8578';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 128); g.stroke();
    g.beginPath(); g.moveTo(0, i * 32); g.lineTo(128, i * 32); g.stroke();
  }
  return canvasTexture(c, 6, 6);
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
  return canvasTexture(c, 10, 10);
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
