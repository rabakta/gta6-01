// BRISA BAY — Rio on foot: third-person movement, camera rig, entering
// cars. The camera orbits with the mouse (drag) and settles behind Rio
// when he runs; driving adds a walk bob on foot and a speed FOV kick in
// a car. v8: SPACE (or the touch JUMP button) hops — a small vertical hop
// with gravity, purely visual: collisions stay on the ground plane.
import * as THREE from 'three';
import { clamp, damp, angleLerp, lerp } from './utils.js';
import { resolveCircleCollisions } from './city.js';
import { CAMERA_FOV } from './config.js';

export class Player {
  constructor(scene, x, z) {
    this.pos = new THREE.Vector3(x, 0, z);
    this.heading = 0;
    this.speed = 0;
    this.health = 100;
    this.armor = 0;
    this.inCar = null; // Car instance when driving
    this.camYaw = 0;
    this.camPitch = 0.32;
    this.camDist = 7.5;
    this.walkPhase = 0;
    this.jumpY = 0; // hop height above the ground, 0 when grounded
    this.jumpV = 0;
    // Rio: teal shirt, jeans, dark hair. Box-built, arms and legs swing.
    const skin = new THREE.MeshLambertMaterial({ color: 0xc98d64 });
    const shirt = new THREE.MeshLambertMaterial({ color: 0x2e7d6b });
    const pants = new THREE.MeshLambertMaterial({ color: 0x2b3a55 });
    const hair = new THREE.MeshLambertMaterial({ color: 0x1a1210 });
    this.mesh = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.34), shirt);
    body.position.y = 1.05;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.4), skin);
    head.position.y = 1.72;
    head.castShadow = true;
    const hairM = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, 0.44), hair);
    hairM.position.y = 1.95;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.7, 0.28), pants);
    legL.position.set(-0.16, 0.35, 0);
    const legR = legL.clone();
    legR.position.x = 0.16;
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.22), shirt);
    armL.position.set(-0.42, 1.05, 0);
    const armR = armL.clone();
    armR.position.x = 0.42;
    this.mesh.add(body, head, hairM, legL, legR, armL, armR);
    this.limbs = { legL, legR, armL, armR };
    this.mesh.position.copy(this.pos);
    scene.add(this.mesh);
  }

  // Hop: only from the ground, never from a car. The hop is visual —
  // Rio's feet leave the ground for ~0.7 s; his collisions and his
  // position on the map never leave the ground plane.
  jump() {
    if (this.jumpY > 0 || this.inCar) return;
    this.jumpV = 7.5;
  }

  // Move on foot. `move` is {x, z} in camera space, -1..1 each axis.
  updateOnFoot(dt, move, running, colliders, bounds) {
    const speed = running ? 8.5 : 4.6;
    const len = Math.hypot(move.x, move.z);
    if (len > 0.01) {
      const nx = move.x / len;
      const nz = move.z / len;
      const targetHeading = Math.atan2(nx, nz);
      this.heading = angleLerp(this.heading, targetHeading, 1 - Math.exp(-12 * dt));
      this.speed = damp(this.speed, speed, 10, dt);
      this.pos.x += Math.sin(this.heading) * this.speed * dt;
      this.pos.z += Math.cos(this.heading) * this.speed * dt;
      this.walkPhase += dt * this.speed * 1.6;
    } else {
      this.speed = damp(this.speed, 0, 10, dt);
    }
    if (this.jumpV !== 0 || this.jumpY > 0) {
      this.jumpY += this.jumpV * dt;
      this.jumpV -= 22 * dt;
      if (this.jumpY <= 0) { this.jumpY = 0; this.jumpV = 0; }
    }
    resolveCircleCollisions(colliders, this.pos, 0.6);
    // bounds override (interiors): default is the city edge.
    const b = bounds || { minX: -215, maxX: 260, minZ: -215, maxZ: 215 };
    this.pos.x = clamp(this.pos.x, b.minX, b.maxX);
    this.pos.z = clamp(this.pos.z, b.minZ, b.maxZ);
    // Walk-cycle swing, scaled by how fast Rio is actually moving.
    const swing = Math.sin(this.walkPhase) * clamp(this.speed / 8.5, 0, 1) * 0.55;
    this.limbs.legL.rotation.x = swing;
    this.limbs.legR.rotation.x = -swing;
    this.limbs.armL.rotation.x = -swing * 0.8;
    this.limbs.armR.rotation.x = swing * 0.8;
    this.mesh.position.copy(this.pos);
    this.mesh.position.y = this.jumpY;
    this.mesh.rotation.y = this.heading;
  }

  // Third-person camera: behind the car when driving, behind Rio on foot.
  // `target` is a plain {x, y, z}. Adds a walk bob on foot and a speed
  // FOV kick while driving. The chase cam sits at heading + PI — the
  // same convention shots.js stages with, so a staged frame never catches
  // the camera mid-swing.
  updateCamera(dt, camera, target) {
    const desiredDist = this.inCar ? 10.5 : 7.5;
    if (this.inCar) {
      // Chase cam: yaw follows the car's heading, mouse can offset it.
      this.camYaw = angleLerp(this.camYaw, this.inCar.heading + Math.PI, 1 - Math.exp(-2.2 * dt));
    }
    const yaw = this.camYaw;
    const pitch = this.camPitch;
    const dist = damp(this.camDist, desiredDist, 4, dt);
    this.camDist = dist;
    // Gentle bob while walking; steady while driving.
    const bob = this.inCar ? 0 : Math.sin(this.walkPhase) * 0.12;
    const cx = target.x + Math.sin(yaw) * Math.cos(pitch) * dist;
    const cz = target.z + Math.cos(yaw) * Math.cos(pitch) * dist;
    const cy = target.y + 2.2 + Math.sin(pitch) * dist + bob;
    camera.position.set(cx, cy, cz);
    camera.lookAt(target.x, target.y + 1.6, target.z);
    // FOV kick at speed: the world rushes a little when the car is flat out.
    // Reads the effective top speed, so a tuned engine still kicks.
    const topSpeed = this.inCar ? (this.inCar.eff ? this.inCar.eff.topSpeed : this.inCar.def.topSpeed) : 0;
    const speedNorm = this.inCar ? clamp(Math.abs(this.inCar.speed) / topSpeed, 0, 1) : 0;
    const wantFov = CAMERA_FOV + speedNorm * 9;
    if (Math.abs(camera.fov - wantFov) > 0.1) {
      camera.fov = lerp(camera.fov, wantFov, dt * 4);
      camera.updateProjectionMatrix();
    }
  }

  // Damage eats armour first, then health. Returns true when Rio dies.
  damage(amount) {
    let rest = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, rest);
      this.armor -= absorbed;
      rest -= absorbed;
    }
    this.health -= rest;
    return this.health <= 0;
  }

  heal(amount) { this.health = clamp(this.health + amount, 0, 100); }

  // Respawn Rio at a place (hospital after WASTED, precinct after BUSTED):
  // full health, on foot, facing north.
  reset(x, z) {
    this.pos.set(x, 0, z);
    this.heading = 0;
    this.health = 100;
    this.inCar = null;
    this.jumpY = 0;
    this.jumpV = 0;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = 0;
    this.mesh.visible = true;
  }
}
