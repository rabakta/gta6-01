// BRISA BAY — Rio on foot: third-person movement, camera rig, entering cars.
// The camera orbits with the mouse (drag) and settles behind Rio when he runs.
import * as THREE from 'three';
import { clamp, damp, angleLerp } from './utils.js';
import { resolveCircleCollisions } from './city.js';

function makeRioMesh() {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0xc98d64 });
  const shirt = new THREE.MeshLambertMaterial({ color: 0x2e7d6b });
  const pants = new THREE.MeshLambertMaterial({ color: 0x2b3a55 });
  const hair = new THREE.MeshLambertMaterial({ color: 0x1a1210 });
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
  g.add(body, head, hairM, legL, legR, armL, armR);
  g.userData = { legL, legR, armL, armR };
  return g;
}

export class Player {
  constructor(scene, x, z) {
    this.mesh = makeRioMesh();
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
    this.mesh.position.copy(this.pos);
    scene.add(this.mesh);
  }

  // Move on foot. `move` is {x, z} in camera space, -1..1 each axis.
  updateOnFoot(dt, move, running, colliders) {
    const speed = running ? 8.5 : 4.6;
    const mx = move.x, mz = move.z;
    const len = Math.hypot(mx, mz);
    if (len > 0.01) {
      const nx = mx / len, nz = mz / len;
      const targetHeading = Math.atan2(nx, nz);
      this.heading = angleLerp(this.heading, targetHeading, 1 - Math.exp(-12 * dt));
      this.speed = damp(this.speed, speed, 10, dt);
      this.pos.x += Math.sin(this.heading) * this.speed * dt;
      this.pos.z += Math.cos(this.heading) * this.speed * dt;
      this.walkPhase += dt * this.speed * 1.6;
    } else {
      this.speed = damp(this.speed, 0, 10, dt);
    }
    resolveCircleCollisions(colliders, this.pos, 0.6);
    this.pos.x = clamp(this.pos.x, -215, 260);
    this.pos.z = clamp(this.pos.z, -215, 215);
    // Walk-cycle swing.
    const swing = Math.sin(this.walkPhase) * clamp(this.speed / 8.5, 0, 1) * 0.55;
    this.mesh.userData.legL.rotation.x = swing;
    this.mesh.userData.legR.rotation.x = -swing;
    this.mesh.userData.armL.rotation.x = -swing * 0.8;
    this.mesh.userData.armR.rotation.x = swing * 0.8;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.heading;
  }

  // Third-person camera: behind the car when driving, behind Rio on foot.
  // Returns the camera position to look from; the caller sets lookAt.
  updateCamera(dt, camera, target) {
    let desiredDist = this.inCar ? 10.5 : 7.5;
    let desiredPitch = this.inCar ? 0.30 : 0.34;
    if (this.inCar) {
      // Chase cam: yaw follows the car's heading, mouse can offset it.
      this.camYaw = angleLerp(this.camYaw, this.inCar.heading + Math.PI, 1 - Math.exp(-2.2 * dt));
    }
    const yaw = this.camYaw;
    const pitch = this.camPitch;
    const dist = damp(this.camDist, desiredDist, 4, dt);
    this.camDist = dist;
    const cx = target.x + Math.sin(yaw) * Math.cos(pitch) * dist;
    const cz = target.z + Math.cos(yaw) * Math.cos(pitch) * dist;
    const cy = target.y + 2.2 + Math.sin(pitch) * dist;
    camera.position.set(cx, cy, cz);
    camera.lookAt(target.x, target.y + 1.6, target.z);
  }

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
}
