// BRISA BAY — small shared helpers: seeded randomness, angles, clamps and
// formatting. Nothing in here knows about the game itself, so every system
// can import it without pulling in the world: pure functions only, no DOM,
// no three.js. Headings are radians, 0 = +Z, forward = (sin h, cos h).

import { CITY } from './config.js';

// ---------------------------------------------------------------------------
// Deterministic random
// ---------------------------------------------------------------------------

// mulberry32: a tiny seeded PRNG. Anything staged from a seed (city layout,
// screenshots) comes out identical on every run.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Uniform float in [lo, hi) and integer in [lo, hi] from a seeded stream.
export function randRange(rng, lo, hi) { return lo + rng() * (hi - lo); }
export function randInt(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }

// True with probability `p` (0..1).
export function chance(rng, p) { return rng() < p; }

export function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

// A random point inside a disc of `radius` around (cx, cz), uniform by area.
export function randomPointInCircle(rng, cx, cz, radius) {
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * radius;
  return { x: cx + Math.sin(a) * r, z: cz + Math.cos(a) * r };
}

// ---------------------------------------------------------------------------
// Clamping, interpolation, angles
// ---------------------------------------------------------------------------

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// Linear blend and its frame-rate independent cousin: damp moves `a` toward
// `b` so the gap shrinks by a fixed fraction per second, whatever the fps.
export function lerp(a, b, t) { return a + (b - a) * t; }
export function damp(a, b, lambda, dt) { return lerp(a, b, 1 - Math.exp(-lambda * dt)); }

// Smooth 0..1 ramp between two edges (handy for fades and falloff).
export function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

// Flat distance on the ground plane; the city is a 2D map with height paint.
// Despite the name, this is the real Euclidean distance, not the squared
// one — every caller compares it against a radius in metres.
export function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// Shortest signed turn from angle `from` to angle `to`, in (-PI, PI].
export function angleDiff(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export function angleLerp(a, b, t) { return a + angleDiff(a, b) * t; }

// ---------------------------------------------------------------------------
// Headings: radians, 0 = facing +Z (forward is (sin h, cos h); the minimap
// draws +Z down, so north on the map is -Z). A chase camera sits at
// heading + PI, behind the car.
// ---------------------------------------------------------------------------

export function headingToVector(h) { return { x: Math.sin(h), z: Math.cos(h) }; }
export function vectorToHeading(x, z) { return Math.atan2(x, z); }

// ---------------------------------------------------------------------------
// Formatting and DOM
// ---------------------------------------------------------------------------

export function fmtMoney(n) { return '$' + Math.round(n).toLocaleString('en-US'); }

export function fmtTime(sec) {
  // A clock, not a stopwatch: 18:24, not 1104:02.
  const h = Math.floor(sec / 3600) % 24;
  const m = Math.floor(sec / 60) % 60;
  return h + ':' + String(m).padStart(2, '0');
}

// Offscreen canvas for painting procedural textures onto.
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// The city edge, for clamps that live outside the city module.
export function cityBounds() { return { min: -CITY.half - 5, max: CITY.beachEnd + 50 }; }
