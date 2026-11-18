// BRISA BAY — small math and random helpers shared by every system.

// Deterministic RNG so a scene can be re-staged exactly (screenshots).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
// Frame-rate independent smoothing: damp(current, target, lambda, dt).
export function damp(a, b, lambda, dt) { return lerp(a, b, 1 - Math.exp(-lambda * dt)); }
export function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); }

// Shortest signed turn from angle `from` to angle `to`.
export function angleDiff(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export function angleLerp(a, b, t) { return a + angleDiff(a, b) * t; }

export function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
export function fmtMoney(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
export function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

// Offscreen canvas used to paint procedural textures.
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Heading helpers: headings are radians, 0 = facing -Z (north on the map).
export function headingToVector(h) { return { x: Math.sin(h), z: Math.cos(h) }; }
export function vectorToHeading(x, z) { return Math.atan2(x, z); }
