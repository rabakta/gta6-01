// BRISA BAY — pedestrians: walkers, joggers, groups, waiters, vendors,
// performer, beachgoers, armed guards. Danger makes them flee.
import * as THREE from 'three';
import { clamp, mulberry32, pick, dist2 } from './utils.js';
import { resolveCircleCollisions } from './city.js';

const SHIRTS = [0xd94f43, 0x4a6fa5, 0xe8c84a, 0x5a7d5a, 0xd98ab0, 0x7a5aa0, 0xe8e2d0, 0x3a3a3a];
const SKINS = [0xc98d64, 0x8a5a3b, 0xe8b88a, 0x6b4226];
const PANTS_COLOURS = [0x2b3a55, 0x3a3a3a, 0x5a4a38];

export class Ped {
  constructor(scene, x, z, opts = {}) {
    this.scene = scene;
    this.pos = new THREE.Vector3(x, 0, z);
    this.heading = Math.random() * Math.PI * 2;
    this.speed = 0;
    this.walkSpeed = 1.2 + Math.random() * 0.8;
    this.health = opts.health ?? 100;
    this.hostile = !!opts.hostile;
    this.role = opts.role || 'walker';
    this.dead = false;
    this.fleeing = false;
    this.fleeFrom = null;
    this.deadTimer = 0; // seconds since death; corpses are cleared by the manager
    this.age = 0; // seconds alive; the manager despawns old far walkers
    this.phase = Math.random() * 6;
    this.shootTimer = 0;
    // Followers walk with their leader; watchers face the performer.
    this.groupLeader = opts.groupLeader || null;
    this.groupSide = opts.groupSide || 0;
    this.performer = opts.performer || null;
    this.stop = opts.stop || null;
    this.pauseTimer = 0;
    // Segmented figure: hips, chest, head, swinging arms/legs, shoes.
    const rng = mulberry32((x * 13 + z * 7) | 0);
    const shirt = new THREE.MeshLambertMaterial({ color: opts.shirt ?? pick(rng, SHIRTS) });
    const skin = new THREE.MeshLambertMaterial({ color: opts.skin ?? pick(rng, SKINS) });
    const pants = new THREE.MeshLambertMaterial({ color: pick(rng, PANTS_COLOURS) });
    const shoeMat = new THREE.MeshLambertMaterial({ color: this.role === 'jogger' ? 0xe8e2d0 : 0x1a1a1a });
    this.mesh = new THREE.Group();
    const hips = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.3), pants);
    hips.position.y = 0.78;
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.3), shirt);
    chest.position.y = 1.18;
    chest.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.36), skin);
    head.position.y = 1.62;
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.4), new THREE.MeshLambertMaterial({ color: pick(rng, [0x1a1210, 0x3a2a1a, 0x5a4a38]) }));
    hair.position.y = 1.85;
    this.mesh.add(hips, chest, head, hair);
    const legGeo = new THREE.BoxGeometry(0.2, 0.65, 0.24);
    legGeo.translate(0, -0.325, 0);
    const legL = new THREE.Mesh(legGeo, pants);
    legL.position.set(-0.14, 0.65, 0);
    const legR = legL.clone();
    legR.position.x = 0.14;
    if (this.role !== 'beachgoer') {
      for (const leg of [legL, legR]) {
        const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.32), shoeMat);
        shoe.position.set(0, -0.6, 0.03);
        leg.add(shoe);
      }
    }
    const armGeo = new THREE.BoxGeometry(0.16, 0.62, 0.2);
    armGeo.translate(0, -0.31, 0);
    const armL = new THREE.Mesh(armGeo, shirt);
    armL.position.set(-0.37, 1.42, 0);
    const armR = armL.clone();
    armR.position.x = 0.37;
    this.mesh.add(legL, legR, armL, armR);
    // A hat on some heads, so the crowd reads as individuals.
    if (opts.hat !== false && rng() < 0.45) {
      const hatCols = [0xd21f2b, 0xf2c230, 0x2e7d6b, 0x2b3a55, 0xe8e2d0];
      const hat = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.12, 0.42), new THREE.MeshLambertMaterial({ color: pick(rng, hatCols) }));
      hat.position.y = 1.86;
      this.mesh.add(hat);
    }
    this.legs = [legL, legR];
    this.arms = [armL, armR];
    this.mesh.position.copy(this.pos);
    scene.add(this.mesh);
  }

  update(dt, world, danger) {
    if (this.dead) return;
    this.age += dt;
    // Flee a danger zone {x, z, r} (speeding car, gunfire, explosion).
    // Gang muscle does not run.
    if (danger && this.role !== 'gang' && dist2(this.pos.x, this.pos.z, danger.x, danger.z) < danger.r) {
      this.fleeing = true;
      this.fleeFrom = danger;
    }
    if (this.fleeing) {
      const dx = this.pos.x - this.fleeFrom.x;
      const dz = this.pos.z - this.fleeFrom.z;
      const d = Math.hypot(dx, dz) || 1;
      this.heading = Math.atan2(dx / d, dz / d);
      this.speed = 4.5;
      if (dist2(this.pos.x, this.pos.z, this.fleeFrom.x, this.fleeFrom.z) > 30) this.fleeing = false;
    } else if (this.role === 'gang' && this.targetPos) {
      // Gang muscle: chase in turf, patrol outside it.
      const aggro = this.aggro || 26;
      const turf = this.turf || { x0: -210, z0: -210, x1: 210, z1: 210, hx: 0, hz: 0 };
      const d = dist2(this.pos.x, this.pos.z, this.targetPos.x, this.targetPos.z);
      if (d < aggro) {
        this.heading = Math.atan2(this.targetPos.x - this.pos.x, this.targetPos.z - this.pos.z);
        this.speed = 4.2;
      } else {
        if (Math.random() < dt * 0.15) this.heading += (Math.random() - 0.5) * 1.6;
        this.speed = this.walkSpeed;
        if (this.pos.x < turf.x0 || this.pos.x > turf.x1 || this.pos.z < turf.z0 || this.pos.z > turf.z1) {
          this.heading = Math.atan2(turf.hx - this.pos.x, turf.hz - this.pos.z);
        }
      }
    } else if (this.hostile) {
      // Guards hold their post and strafe a little; they shoot in main.js.
      this.speed = 0;
      this.phase += dt * 2;
      this.pos.x += Math.sin(this.phase) * 0.15 * dt;
    } else if (this.role === 'waiter' || this.role === 'vendor' || this.role === 'performer') {
      // Rooted roles stand their ground, swaying a little.
      this.speed = 0;
      this.phase += dt * 1.5;
      this.pos.x += Math.sin(this.phase) * 0.08 * dt;
    } else if (this.role === 'watcher') {
      // Watchers face the performer; if they are gone, they wander off.
      if (this.performer && !this.performer.dead) {
        this.speed = 0;
        this.heading = Math.atan2(this.performer.pos.x - this.pos.x, this.performer.pos.z - this.pos.z);
        this.phase += dt * 1.5;
      } else {
        if (Math.random() < dt * 0.15) this.heading += (Math.random() - 0.5) * 1.6;
        this.speed = this.walkSpeed;
      }
    } else if (this.role === 'group' && this.groupLeader && !this.groupLeader.dead) {
      // Walk with the leader: same heading and pace, a step behind.
      const l = this.groupLeader;
      this.heading = l.heading;
      this.speed = l.speed;
      const bx = l.pos.x - Math.sin(l.heading) * 1.1 + Math.cos(l.heading) * (this.groupSide || 0);
      const bz = l.pos.z - Math.cos(l.heading) * 1.1 - Math.sin(l.heading) * (this.groupSide || 0);
      this.pos.x += (bx - this.pos.x) * Math.min(1, dt * 3);
      this.pos.z += (bz - this.pos.z) * Math.min(1, dt * 3);
    } else if (this.role === 'jogger') {
      // A jogger runs the sidewalks at twice a walk, turning less.
      if (Math.random() < dt * 0.08) this.heading += (Math.random() - 0.5) * 1.0;
      this.speed = this.walkSpeed * 2.4;
    } else if (this.role === 'beachgoer') {
      // Beachgoers amble, then stop and stare at the sea for a while.
      if (this.pauseTimer > 0) {
        this.pauseTimer -= dt;
        this.speed = 0;
      } else {
        if (Math.random() < dt * 0.15) this.heading += (Math.random() - 0.5) * 1.6;
        this.speed = this.walkSpeed * 0.7;
        if (Math.random() < dt * 0.05) this.pauseTimer = 3 + Math.random() * 4;
      }
    } else {
      // Stroll: wander the sidewalks, turn at random.
      if (Math.random() < dt * 0.15) this.heading += (Math.random() - 0.5) * 1.6;
      this.speed = this.walkSpeed;
    }
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += Math.cos(this.heading) * this.speed * dt;
    resolveCircleCollisions(world.colliders, this.pos, 0.5);
    this.pos.x = clamp(this.pos.x, -210, 250);
    this.pos.z = clamp(this.pos.z, -210, 210);
    // Walk-cycle swing, scaled by speed; arms oppose the legs.
    const swing = Math.sin(this.phase + dt * this.speed * 4) * 0.4 * clamp(this.speed / 2, 0, 1);
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    if (this.arms) {
      this.arms[0].rotation.x = -swing;
      this.arms[1].rotation.x = swing;
    }
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.heading;
    this.phase += dt * this.speed * 2;
  }

  // Knocked down: fall over and stay down. Returns true on a kill.
  hit(damage, fromX, fromZ) {
    this.health -= damage;
    // Gang muscle does not run when shot — it gets angry. Everyone else flees.
    if (this.role !== 'gang') { this.fleeing = true; this.fleeFrom = { x: fromX, z: fromZ, r: 40 }; }
    if (this.health <= 0 && !this.dead) {
      this.dead = true;
      this.mesh.rotation.x = Math.PI / 2;
      this.mesh.position.y = 0.35;
      return true;
    }
    return false;
  }

  dispose() {
    this.scene.remove(this.mesh);
  }
}

export class PedManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.peds = [];
  }

  // Scatter peds on sidewalks (9 m off a road line) around a centre.
  spawn(count, center, radius) {
    const lines = this.world.roads;
    const onBeach = center.x > 205;
    for (let i = 0; i < count; i++) {
      if (onBeach) {
        const x = 214 + Math.random() * 30;
        const z = center.z + (Math.random() * 2 - 1) * radius;
        this.peds.push(new Ped(this.scene, x, z, { role: 'beachgoer' }));
        continue;
      }
      const line = pick(mulberry32(i * 977 + 13), lines);
      const along = (Math.random() * 2 - 1) * radius + center.z;
      const onXRoad = Math.random() < 0.5;
      const x = onXRoad ? line + 9 : along;
      const z = onXRoad ? along : line + 9;
      // About one walker in six is out for a run.
      const role = Math.random() < 0.16 ? 'jogger' : 'walker';
      this.peds.push(new Ped(this.scene, x, z, { role }));
    }
  }

  // Armed guards for a mission step, standing at fixed posts.
  spawnGuards(positions, health = 60) {
    const guards = [];
    for (const p of positions) {
      const g = new Ped(this.scene, p.x, p.z, { hostile: true, role: 'guard', health, shirt: 0x1d2733, hat: false });
      guards.push(g);
      this.peds.push(g);
    }
    return guards;
  }

  // Gang muscle for a turf: hostile, gang colours, half of them armed.
  // They chase Rio in their turf (see Ped.update) and main.js fights them.
  spawnGang(gang, count = 3) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const p = new Ped(this.scene, gang.hx + (Math.random() - 0.5) * 24, gang.hz + (Math.random() - 0.5) * 24,
        { hostile: true, role: 'gang', health: 80, shirt: gang.color, hat: false });
      resolveCircleCollisions(this.world.colliders, p.pos, 0.6);
      p.gang = gang;
      p.turf = gang;
      p.aggro = 26;
      p.armed = Math.random() < 0.5;
      this.peds.push(p);
      out.push(p);
    }
    return out;
  }

  // A walking group — a leader plus followers a step behind. The
  // followers carry the leader, so the group holds together for as long
  // as the leader lives.
  spawnGroup(x, z, size = 3) {
    const leader = new Ped(this.scene, x, z, { role: 'group' });
    this.peds.push(leader);
    const group = [leader];
    for (let i = 1; i < size; i++) {
      const side = i % 2 === 0 ? 1.1 : -1.1;
      const f = new Ped(this.scene, x + side, z + 1, { role: 'group', groupLeader: leader, groupSide: side });
      this.peds.push(f);
      group.push(f);
    }
    return group;
  }

  // Waiters at a bus stop, queued clear of the bench and pole.
  spawnWaiters(stop, count = 2) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const p = new Ped(this.scene, stop.waitX + (Math.random() - 0.5) * 2, stop.waitZ - 1.5 - i * 1.2, { role: 'waiter', stop });
      this.peds.push(p);
      out.push(p);
    }
    return out;
  }

  // Vendors behind their stalls, one ped per stall, facing the road.
  spawnVendors(spots) {
    const out = [];
    for (const s of spots) {
      const p = new Ped(this.scene, s.x, s.z + 2.2, { role: 'vendor', shirt: s.color, hat: false });
      // Face the road: toward the city centre from the stall.
      p.heading = Math.atan2(-s.x, -s.z);
      this.peds.push(p);
      out.push(p);
    }
    return out;
  }

  // The street performer and their crowd of four watchers.
  spawnPerformer(x, z) {
    const performer = new Ped(this.scene, x, z, { role: 'performer', shirt: 0xf2c230, hat: false });
    this.peds.push(performer);
    const watchers = [];
    const ring = [[2.5, 0], [0, 2.5], [-2.5, 0], [0, -2.5]];
    for (const [dx, dz] of ring) {
      const w = new Ped(this.scene, x + dx, z + dz, { role: 'watcher', performer });
      this.peds.push(w);
      watchers.push(w);
    }
    return { performer, watchers };
  }

  // Board the waiters for that stop; returns how many boarded.
  boardWaiters(stop, radius = 9) {
    let n = 0;
    for (const p of [...this.peds]) {
      if (p.dead || p.role !== 'waiter' || p.stop !== stop) continue;
      if (dist2(p.pos.x, p.pos.z, stop.waitX, stop.waitZ) > radius) continue;
      this.remove(p);
      n++;
    }
    return n;
  }

  // Waiters currently standing at any stop.
  waiters() {
    return this.peds.filter((p) => !p.dead && p.role === 'waiter');
  }

  update(dt, danger, playerPos = null) {
    for (const p of this.peds) {
      if (p.role === 'gang') p.targetPos = playerPos;
      p.update(dt, this.world, danger);
    }
    // Panic chain: a fleeing ped spooks walkers within 6 m.
    const runners = this.peds.filter((p) => !p.dead && p.fleeing && p.fleeFrom);
    for (const p of this.peds) {
      if (p.dead || p.fleeing || p.hostile) continue;
      for (const r of runners) {
        if (dist2(p.pos.x, p.pos.z, r.pos.x, r.pos.z) < 36) {
          p.fleeing = true;
          p.fleeFrom = r.fleeFrom;
          break;
        }
      }
    }
    // Corpses clear after 25 s (far ones first).
    for (const p of [...this.peds]) {
      if (p.dead) {
        p.deadTimer += dt;
        const far = playerPos ? dist2(p.pos.x, p.pos.z, playerPos.x, playerPos.z) > 120 : false;
        if (p.deadTimer > 25 || (far && p.deadTimer > 8)) this.remove(p);
      }
    }
    // Prune the long-dead far from the player to keep the scene light.
    if (this.peds.length > 90) {
      this.peds = this.peds.filter((p) => !p.dead || Math.random() < 0.5);
    }
    // Despawn: old ambient walkers far from the player leave. Rooted roles stay.
    const ambient = (r) => r === 'walker' || r === 'jogger' || r === 'beachgoer';
    if (playerPos) {
      for (const p of [...this.peds]) {
        if (!p.dead && ambient(p.role) && p.age > 10 && dist2(p.pos.x, p.pos.z, playerPos.x, playerPos.z) > 150) this.remove(p);
      }
    }
    // No two walkers share the same space: push overlapping amblers apart.
    const live = this.peds.filter((p) => !p.dead && ambient(p.role));
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.49) {
          const d = Math.sqrt(d2);
          const push = (0.7 - d) / 2;
          const nx = d > 0.01 ? dx / d : 1, nz = d > 0.01 ? dz / d : 0;
          a.pos.x -= nx * push; a.pos.z -= nz * push;
          b.pos.x += nx * push; b.pos.z += nz * push;
          a.mesh.position.copy(a.pos); b.mesh.position.copy(b.pos);
        }
      }
    }
  }

  remove(ped) {
    ped.dispose();
    this.peds = this.peds.filter((p) => p !== ped);
  }
}
