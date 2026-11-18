// BRISA BAY v4 — pedestrians: beach-goers and city walkers, plus the armed
// guards missions spawn. A ped is a low-poly figure (torso, head, legs)
// that strolls the sidewalks; danger nearby (a speeding car, gunfire, an
// explosion) makes it flee, and a fleeing ped spreads the panic to the
// walkers around it. v2: corpses far from the player clear first, so the
// streets stay tidy where Rio actually is. v4: the crowd gets jobs —
// joggers, walking groups, bus-stop waiters, vendors, a street performer
// with a watching crowd, and beachgoers who stop to watch the sea.
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
    this.phase = Math.random() * 6;
    this.shootTimer = 0;
    // v4: group followers walk with their leader; watchers face their
    // performer; waiters remember which stop they wait at; beachgoers
    // sometimes just stand and watch the sea.
    this.groupLeader = opts.groupLeader || null;
    this.groupSide = opts.groupSide || 0;
    this.performer = opts.performer || null;
    this.stop = opts.stop || null;
    this.pauseTimer = 0;
    // Build the figure: box torso and head, two legs that swing as it walks.
    const rng = mulberry32((x * 13 + z * 7) | 0);
    const shirt = new THREE.MeshLambertMaterial({ color: opts.shirt ?? pick(rng, SHIRTS) });
    const skin = new THREE.MeshLambertMaterial({ color: opts.skin ?? pick(rng, SKINS) });
    const pants = new THREE.MeshLambertMaterial({ color: pick(rng, PANTS_COLOURS) });
    this.mesh = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.8, 0.3), shirt);
    body.position.y = 1.0;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.36), skin);
    head.position.y = 1.62;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.65, 0.24), pants);
    legL.position.set(-0.14, 0.32, 0);
    const legR = legL.clone();
    legR.position.x = 0.14;
    this.mesh.add(body, head, legL, legR);
    // v4: a hat on some heads — caps, a sun hat, a beanie — so the crowd
    // reads as individuals at a glance, not a clone army.
    if (opts.hat !== false && rng() < 0.45) {
      const hatCols = [0xd21f2b, 0xf2c230, 0x2e7d6b, 0x2b3a55, 0xe8e2d0];
      const hat = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.12, 0.42), new THREE.MeshLambertMaterial({ color: pick(rng, hatCols) }));
      hat.position.y = 1.86;
      this.mesh.add(hat);
    }
    this.legs = [legL, legR];
    this.mesh.position.copy(this.pos);
    scene.add(this.mesh);
  }

  update(dt, world, danger) {
    if (this.dead) return;
    // Flee from a danger zone (speeding car, gunfire, explosion): the
    // caller passes {x, z, r} or null.
    if (danger && dist2(this.pos.x, this.pos.z, danger.x, danger.z) < danger.r) {
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
    } else if (this.hostile) {
      // Guards hold their post and strafe a little; they shoot in main.js.
      this.speed = 0;
      this.phase += dt * 2;
      this.pos.x += Math.sin(this.phase) * 0.15 * dt;
    } else if (this.role === 'waiter' || this.role === 'vendor' || this.role === 'performer') {
      // v4: the rooted roles stand their ground — a waiter at the stop, a
      // vendor behind the stall, the performer holding court. A little
      // sway so they are alive, not statues.
      this.speed = 0;
      this.phase += dt * 1.5;
      this.pos.x += Math.sin(this.phase) * 0.08 * dt;
    } else if (this.role === 'watcher') {
      // v4: the crowd around the performer faces them and sways to the
      // music nobody else can hear. If the performer is gone, they
      // wander off like anyone else.
      if (this.performer && !this.performer.dead) {
        this.speed = 0;
        this.heading = Math.atan2(this.performer.pos.x - this.pos.x, this.performer.pos.z - this.pos.z);
        this.phase += dt * 1.5;
      } else {
        if (Math.random() < dt * 0.15) this.heading += (Math.random() - 0.5) * 1.6;
        this.speed = this.walkSpeed;
      }
    } else if (this.role === 'group' && this.groupLeader && !this.groupLeader.dead) {
      // v4: walk with the leader — same heading, same pace, a step behind
      // and to the side. The lerp pulls the follower into its slot; the
      // forward step below keeps pace with the leader.
      const l = this.groupLeader;
      this.heading = l.heading;
      this.speed = l.speed;
      const bx = l.pos.x - Math.sin(l.heading) * 1.1 + Math.cos(l.heading) * (this.groupSide || 0);
      const bz = l.pos.z - Math.cos(l.heading) * 1.1 - Math.sin(l.heading) * (this.groupSide || 0);
      this.pos.x += (bx - this.pos.x) * Math.min(1, dt * 3);
      this.pos.z += (bz - this.pos.z) * Math.min(1, dt * 3);
    } else if (this.role === 'jogger') {
      // v4: a jogger runs the sidewalks at twice a walk, turning less.
      if (Math.random() < dt * 0.08) this.heading += (Math.random() - 0.5) * 1.0;
      this.speed = this.walkSpeed * 2.4;
    } else if (this.role === 'beachgoer') {
      // v4: beachgoers amble, then stop and stare at the sea for a while.
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
    const swing = Math.sin(this.phase + dt * this.speed * 4) * 0.4;
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.heading;
    this.phase += dt * this.speed * 2;
  }

  // Knocked down: fall over and stay down. Returns true on a kill.
  hit(damage, fromX, fromZ) {
    this.health -= damage;
    this.fleeing = true;
    this.fleeFrom = { x: fromX, z: fromZ, r: 40 };
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

  // Scatter peds on the sidewalks (9m off a road line) around a centre.
  // v2: when the centre is on the beach, scatter walkers on the sand
  // instead — the umbrellas and the pier need people too.
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
      // v4: about one walker in six is out for a run.
      const role = Math.random() < 0.16 ? 'jogger' : 'walker';
      this.peds.push(new Ped(this.scene, x, z, { role }));
    }
  }

  // Armed guards for a mission step, standing at fixed posts.
  // (The taxi passenger is not a Ped — it is a static figure owned by
  // taxi.js, with no AI, no health and no flee behaviour.)
  spawnGuards(positions, health = 60) {
    const guards = [];
    for (const p of positions) {
      const g = new Ped(this.scene, p.x, p.z, { hostile: true, role: 'guard', health, shirt: 0x1d2733, hat: false });
      guards.push(g);
      this.peds.push(g);
    }
    return guards;
  }

  // v4: a walking group — a leader plus followers a step behind. The
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

  // v4: waiters at a bus stop — they stand by the bench until a bus
  // dwells there, then board (see boardWaiters).
  spawnWaiters(stop, count = 2) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const p = new Ped(this.scene, stop.waitX + (Math.random() - 0.5) * 2, stop.waitZ + 1.5 + i * 1.2, { role: 'waiter', stop });
      this.peds.push(p);
      out.push(p);
    }
    return out;
  }

  // v4: vendors behind their stalls, one ped per stall, facing the road.
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

  // v4: the street performer and their crowd — the performer holds the
  // spot, four watchers ring them facing in.
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

  // v4: board the waiters standing at a stop — the bus takes them.
  // Returns how many boarded. Only waiters for that stop board, never
  // passers-by: the role and the stop both have to match.
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
    for (const p of this.peds) p.update(dt, this.world, danger);
    // Panic chain: a fleeing ped spooks every walker within 6m, so the
    // crowd bolts together instead of strolling through a shootout.
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
    // Corpses clear themselves after 25s so the streets don't pile up.
    // v2: a corpse far from the player clears first — no reason to keep a
    // body three blocks away while the street Rio stands on fills up.
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
  }

  remove(ped) {
    ped.dispose();
    this.peds = this.peds.filter((p) => p !== ped);
  }
}
