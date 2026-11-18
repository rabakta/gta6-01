// BRISA BAY — combat: fists, guns, muzzle flashes, tracers, explosions and
// the particle system that sells all of them (skid smoke, sparks, fire).
import * as THREE from 'three';
import { WEAPONS } from './config.js';
import { clamp } from './utils.js';

// --- Particles ---------------------------------------------------------------
// One Points cloud, recycled: each particle is a position + velocity + life.
export class ParticleSystem {
  constructor(scene, max = 900) {
    this.max = max;
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.head = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const mat = new THREE.PointsMaterial({ size: 0.55, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, life, r, g, b) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.positions[i * 3] = x; this.positions[i * 3 + 1] = y; this.positions[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.colors[i * 3] = r; this.colors[i * 3 + 1] = g; this.colors[i * 3 + 2] = b;
    this.life[i] = life; this.maxLife[i] = life;
  }

  burst(pos, count, color, speed, life, up = 2) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.spawn(pos.x, pos.y, pos.z, Math.sin(a) * s, up * Math.random(), Math.cos(a) * s, life * (0.6 + Math.random() * 0.8), color.r, color.g, color.b);
    }
  }

  smoke(pos, count = 1) {
    for (let i = 0; i < count; i++) {
      this.spawn(pos.x + (Math.random() - 0.5), pos.y + 0.4, pos.z + (Math.random() - 0.5),
        (Math.random() - 0.5) * 0.5, 1.2 + Math.random(), (Math.random() - 0.5) * 0.5,
        1.6, 0.35, 0.33, 0.32);
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.positions[i * 3 + 1] = -999; continue; }
      this.life[i] -= dt;
      this.positions[i * 3] += this.vel[i * 3] * dt;
      this.positions[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3 + 1] -= 2.5 * dt;
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      this.colors[i * 3] *= (0.6 + 0.4 * f);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

// --- Shooting ----------------------------------------------------------------
export class Combat {
  constructor(scene, particles) {
    this.scene = scene;
    this.particles = particles;
    this.cooldown = 0;
    this.tracer = null;
    this.tracerLife = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.tracer = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 }));
    this.tracer.frustumCulled = false;
    scene.add(this.tracer);
    this.flash = new THREE.PointLight(0xffc860, 0, 9, 1.8);
    scene.add(this.flash);
  }

  // Fire `weaponKey` from `origin` along `dir`. Hits the nearest ped / car /
  // guard in range. Returns a hit report for wanted + mission hooks.
  fire(weaponKey, origin, dir, targets, audio) {
    if (this.cooldown > 0) return null;
    const w = WEAPONS[weaponKey];
    this.cooldown = w.rate;
    const pellets = w.pellets || 1;
    let hitReport = null;
    for (let p = 0; p < pellets; p++) {
      const spread = w.spread * (Math.random() * 2 - 1);
      const dx = dir.x + Math.cos(Math.atan2(dir.x, dir.z) + Math.PI / 2) * spread;
      const dz = dir.z + Math.sin(Math.atan2(dir.x, dir.z) + Math.PI / 2) * spread;
      const len = Math.hypot(dx, dz) || 1;
      const d = { x: dx / len, z: dz / len };
      let best = null, bestT = w.range;
      for (const t of targets) {
        if (t.dead) continue;
        const px = t.pos.x - origin.x, pz = t.pos.z - origin.z;
        const along = px * d.x + pz * d.z;
        if (along < 0 || along > bestT) continue;
        const side = Math.abs(px * d.z - pz * d.x);
        const radius = t.kind === 'car' ? 2.2 : 0.9;
        if (side < radius) { best = t; bestT = along; }
      }
      if (best) {
        const hitPos = { x: origin.x + d.x * bestT, y: 1.2, z: origin.z + d.z * bestT };
        this.particles.burst(hitPos, 8, new THREE.Color(0xffd34d), 4, 0.5);
        const killed = typeof best.damage === 'function' ? best.damage(w.damage) : best.hit(w.damage, origin.x, origin.z);
        hitReport = { target: best, killed, hitPos };
      } else {
        // Impact puff at max range / wall.
        const end = { x: origin.x + d.x * w.range, y: 1.0, z: origin.z + d.z * w.range };
        this.particles.burst(end, 3, new THREE.Color(0x9a938a), 1.5, 0.4);
      }
      // Tracer from the muzzle to the hit (or max range).
      const endX = origin.x + d.x * bestT, endZ = origin.z + d.z * bestT;
      const pos = this.tracer.geometry.attributes.position.array;
      pos[0] = origin.x; pos[1] = 1.35; pos[2] = origin.z;
      pos[3] = endX; pos[4] = 1.2; pos[5] = endZ;
      this.tracer.geometry.attributes.position.needsUpdate = true;
      this.tracerLife = 0.06;
    }
    this.flash.position.set(origin.x + dir.x * 1.2, 1.4, origin.z + dir.z * 1.2);
    this.flash.intensity = 60;
    if (audio) audio.gunshot();
    return hitReport;
  }

  explode(pos, radius, targets, audio) {
    this.particles.burst(pos, 60, new THREE.Color(0xff7a1a), 9, 0.9, 4);
    this.particles.burst(pos, 30, new THREE.Color(0x3a3a3a), 4, 1.6, 3);
    this.flash.position.set(pos.x, pos.y + 1, pos.z);
    this.flash.intensity = 400;
    if (audio) audio.explosion();
    const out = [];
    for (const t of targets) {
      if (t.dead) continue;
      const d = Math.hypot(t.pos.x - pos.x, t.pos.z - pos.z);
      if (d < radius) {
        const killed = typeof t.damage === 'function' ? t.damage(120) : t.hit(120, pos.x, pos.z);
        out.push({ target: t, killed });
      }
    }
    return out;
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.tracerLife -= dt;
    this.tracer.visible = this.tracerLife > 0;
    this.flash.intensity = Math.max(0, this.flash.intensity - dt * 900);
  }
}
