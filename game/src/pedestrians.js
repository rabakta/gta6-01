// BRISA BAY — pedestrians: beach-goers and city folk who stroll the
// sidewalks, scatter when a car mounts the kerb, and (in missions) fight back
// as guards and rivals.
import * as THREE from 'three';
import { clamp, mulberry32, pick, dist2 } from './utils.js';
import { resolveCircleCollisions } from './city.js';

const SHIRTS = [0xd94f43, 0x4a6fa5, 0xe8c84a, 0x5a7d5a, 0xd98ab0, 0x7a5aa0, 0xe8e2d0, 0x3a3a3a];
const SKINS = [0xc98d64, 0x8a5a3b, 0xe8b88a, 0x6b4226];

function makePedMesh(shirtColor, skinColor) {
  const g = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: shirtColor });
  const skin = new THREE.MeshLambertMaterial({ color: skinColor });
  const pants = new THREE.MeshLambertMaterial({ color: pick(mulberry32(shirtColor), [0x2b3a55, 0x3a3a3a, 0x5a4a38]) });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.8, 0.3), shirt);
  body.position.y = 1.0;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.36), skin);
  head.position.y = 1.62;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.65, 0.24), pants);
  legL.position.set(-0.14, 0.32, 0);
  const legR = legL.clone();
  legR.position.x = 0.14;
  g.add(body, head, legL, legR);
  g.userData = { legL, legR };
  return g;
}

export class Ped {
  constructor(scene, x, z, opts = {}) {
    this.mesh = makePedMesh(opts.shirt ?? pick(mulberry32((x * 13 + z * 7) | 0), SHIRTS), opts.skin ?? pick(mulberry32((x * 7 + z * 13) | 0), SKINS));
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
    this.phase = Math.random() * 6;
    this.shootTimer = 0;
    this.mesh.position.copy(this.pos);
    scene.add(this.mesh);
  }

  update(dt, world, danger) {
    if (this.dead) return;
    // Flee from nearby danger (a speeding car, gunfire, an explosion).
    if (danger && dist2(this.pos.x, this.pos.z, danger.x, danger.z) < danger.r) {
      this.fleeing = true;
      this.fleeFrom = danger;
    }
    if (this.fleeing) {
      const dx = this.pos.x - this.fleeFrom.x, dz = this.pos.z - this.fleeFrom.z;
      const d = Math.hypot(dx, dz) || 1;
      this.heading = Math.atan2(dx / d, dz / d);
      this.speed = 4.5;
      if (dist2(this.pos.x, this.pos.z, this.fleeFrom.x, this.fleeFrom.z) > 30) this.fleeing = false;
    } else if (this.hostile) {
      // Guards hold their post and strafe a little; they shoot in combat.js.
      this.speed = 0;
      this.phase += dt * 2;
      this.pos.x += Math.sin(this.phase) * 0.15 * dt;
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
    this.mesh.userData.legL.rotation.x = swing;
    this.mesh.userData.legR.rotation.x = -swing;
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
}

export class PedManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.peds = [];
  }

  spawn(count, center, radius) {
    const lines = this.world.roads;
    for (let i = 0; i < count; i++) {
      const line = pick(mulberry32(i * 977 + 13), lines);
      const along = (Math.random() * 2 - 1) * radius + center.z;
      const onXRoad = Math.random() < 0.5;
      const x = onXRoad ? line + 9 : along;
      const z = onXRoad ? along : line + 9;
      this.peds.push(new Ped(this.scene, x, z));
    }
  }

  spawnGuards(positions, health = 60) {
    const guards = [];
    for (const p of positions) {
      const g = new Ped(this.scene, p.x, p.z, { hostile: true, role: 'guard', health, shirt: 0x1d2733 });
      guards.push(g);
      this.peds.push(g);
    }
    return guards;
  }

  update(dt, danger) {
    for (const p of this.peds) p.update(dt, this.world, danger);
    // Prune the long-dead far from the player to keep the scene light.
    if (this.peds.length > 90) {
      this.peds = this.peds.filter((p) => !p.dead || Math.random() < 0.5);
    }
  }

  remove(ped) {
    this.scene.remove(ped.mesh);
    this.peds = this.peds.filter((p) => p !== ped);
  }
}
