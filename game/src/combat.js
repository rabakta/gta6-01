// BRISA BAY v3 — combat: fists, guns, muzzle flashes, tracers, explosions
// and the particle system that sells all of them (skid smoke, sparks,
// fire). v2 adds explosion debris — heavy chunks that arc and fall — and a
// puff of muzzle smoke with every shot, so gunfire reads in daylight.
import * as THREE from 'three';
import { WEAPONS } from './config.js';

// ---------------------------------------------------------------------------
// Particles: one recycled Points cloud. Each particle is a position,
// a velocity, a colour and a remaining life.
// ---------------------------------------------------------------------------
export class ParticleSystem {
  constructor(scene, max = 1200) {
    // v2 raises the cap from 900: exhaust, dust, flame and debris all draw
    // from this one cloud, and a chase can fire several at once.
    this.max = max;
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.baseColors = new Float32Array(max * 3);
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
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.colors[i * 3] = r;
    this.colors[i * 3 + 1] = g;
    this.colors[i * 3 + 2] = b;
    // Keep the un-faded colour so the fade below scales from the original
    // instead of compounding to black frame after frame.
    this.baseColors[i * 3] = r;
    this.baseColors[i * 3 + 1] = g;
    this.baseColors[i * 3 + 2] = b;
    this.life[i] = life;
    this.maxLife[i] = life;
  }

  // A radial burst: sparks, fire, impact debris.
  burst(pos, count, color, speed, life, up = 2) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.spawn(
        pos.x, pos.y, pos.z,
        Math.sin(a) * s, up * Math.random(), Math.cos(a) * s,
        life * (0.6 + Math.random() * 0.8),
        color.r, color.g, color.b,
      );
    }
  }

  // Short golden sparks for metal-on-metal hits.
  sparks(pos, count = 8) {
    this.burst(pos, count, new THREE.Color(0xffd34d), 5, 0.4, 2.5);
  }

  // Grey smoke puffs: exhaust, skid, a dying engine.
  smoke(pos, count = 1) {
    for (let i = 0; i < count; i++) {
      this.spawn(
        pos.x + (Math.random() - 0.5), pos.y + 0.4, pos.z + (Math.random() - 0.5),
        (Math.random() - 0.5) * 0.5, 1.2 + Math.random(), (Math.random() - 0.5) * 0.5,
        1.6, 0.35, 0.33, 0.32,
      );
    }
  }

  // v2: heavy debris — dark chunks that arc up and fall fast, for wrecks
  // and explosions. Same cloud, different recipe: high launch, short life.
  debris(pos, count = 18) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 3 + Math.random() * 6;
      this.spawn(
        pos.x, pos.y + 0.5, pos.z,
        Math.sin(a) * s, 5 + Math.random() * 5, Math.cos(a) * s,
        0.9 + Math.random() * 0.7,
        0.16, 0.14, 0.13,
      );
    }
  }

  // v2: orange exhaust flame for a tuned engine under full throttle.
  flame(pos, count = 2) {
    for (let i = 0; i < count; i++) {
      this.spawn(
        pos.x + (Math.random() - 0.5) * 0.3, pos.y + 0.35, pos.z + (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.8, 0.5 + Math.random(), (Math.random() - 0.5) * 0.8,
        0.28, 1.0, 0.48, 0.16,
      );
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.positions[i * 3 + 1] = -999; // park the dead below the world
        continue;
      }
      this.life[i] -= dt;
      this.positions[i * 3] += this.vel[i * 3] * dt;
      this.positions[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3 + 1] -= 2.5 * dt;
      // Fade out as life runs down, scaling from the stored base colour.
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      this.colors[i * 3] = this.baseColors[i * 3] * f;
      this.colors[i * 3 + 1] = this.baseColors[i * 3 + 1] * f;
      this.colors[i * 3 + 2] = this.baseColors[i * 3 + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Shooting: hitscan with spread, tracers, muzzle flash and explosions.
// ---------------------------------------------------------------------------
export class Combat {
  constructor(scene, particles) {
    this.scene = scene;
    this.particles = particles;
    this.cooldown = 0;
    this.tracerLife = 0;
    this.tracerMaxLife = 0.06;
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
  // Targets include the Grand Prix rivals (kind 'race'): shooting one
  // during the race is allowed, it just slows them down — a dead rival
  // is skipped by the race update instead of ending the race.
  fire(weaponKey, origin, dir, targets, audio) {
    if (this.cooldown > 0) return null;
    const w = WEAPONS[weaponKey];
    this.cooldown = w.rate;
    const pellets = w.pellets || 1;
    const heading = Math.atan2(dir.x, dir.z);
    let hitReport = null;
    for (let p = 0; p < pellets; p++) {
      const spread = w.spread * (Math.random() * 2 - 1);
      // Perpendicular to the aim, for the spread offset.
      const px = -Math.sin(heading) * spread;
      const pz = Math.cos(heading) * spread;
      const len = Math.hypot(dir.x + px, dir.z + pz) || 1;
      const d = { x: (dir.x + px) / len, z: (dir.z + pz) / len };
      let best = null;
      let bestT = w.range;
      for (const t of targets) {
        if (t.dead) continue;
        const relX = t.pos.x - origin.x;
        const relZ = t.pos.z - origin.z;
        const along = relX * d.x + relZ * d.z;
        if (along < 0 || along > bestT) continue;
        const side = Math.abs(relX * d.z - relZ * d.x);
        const radius = t.kind === 'car' ? 2.2 : 0.9;
        if (side < radius) { best = t; bestT = along; }
      }
      const endX = origin.x + d.x * bestT;
      const endZ = origin.z + d.z * bestT;
      if (best) {
        const hitPos = { x: endX, y: 1.2, z: endZ };
        this.particles.burst(hitPos, 8, new THREE.Color(0xffd34d), 4, 0.5);
        const killed = typeof best.damage === 'function'
          ? best.damage(w.damage)
          : best.hit(w.damage, origin.x, origin.z);
        hitReport = { target: best, killed, hitPos };
      } else {
        // Impact puff at max range / wall.
        this.particles.burst({ x: endX, y: 1, z: endZ }, 3, new THREE.Color(0x9a938a), 1.5, 0.4);
      }
      // Tracer from the muzzle to the hit (or max range), fading fast.
      const pos = this.tracer.geometry.attributes.position.array;
      pos[0] = origin.x; pos[1] = 1.35; pos[2] = origin.z;
      pos[3] = endX; pos[4] = 1.2; pos[5] = endZ;
      this.tracer.geometry.attributes.position.needsUpdate = true;
      this.tracerLife = this.tracerMaxLife;
      this.tracer.material.opacity = 0.9;
    }
    this.flash.position.set(origin.x + dir.x * 1.2, 1.4, origin.z + dir.z * 1.2);
    this.flash.intensity = 60;
    // v2: a puff of muzzle smoke, so a shot leaves a mark in the air.
    this.particles.smoke({ x: origin.x + dir.x * 1.2, y: 1.35, z: origin.z + dir.z * 1.2 }, 1);
    if (audio) audio.gunshot();
    return hitReport;
  }

  explode(pos, radius, targets, audio) {
    this.particles.burst(pos, 60, new THREE.Color(0xff7a1a), 9, 0.9, 4);
    this.particles.burst(pos, 30, new THREE.Color(0x3a3a3a), 4, 1.6, 3);
    // v2: heavy debris arcs out of the blast.
    this.particles.debris(pos, 18);
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
    if (this.tracerLife > 0) {
      // Fade the tracer out over its short life instead of snapping off.
      this.tracer.material.opacity = 0.9 * (this.tracerLife / this.tracerMaxLife);
      this.tracer.visible = true;
    } else {
      this.tracer.visible = false;
    }
    this.flash.intensity = Math.max(0, this.flash.intensity - dt * 900);
  }
}
