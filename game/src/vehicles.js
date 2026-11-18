// BRISA BAY — cars: the player's ride, city traffic and the BCPD.
// Arcade handling (no physics engine): each car is a heading + speed on the
// road grid, with circle-vs-box building collision and circle-vs-circle
// car collision. Traffic follows the road lines; police pursue the player
// and the helicopter orbits from three stars up.
import * as THREE from 'three';
import { CAR_DEFS } from './config.js';
import { clamp, angleDiff, dist2, pick, randomPointInCircle } from './utils.js';
import { nearestRoadCoord, resolveCircleCollisions } from './city.js';

const CAR_COLORS = { police: 0x1d2733 };

// Box-built car: body, cabin, wheels, headlights and taillights; trucks and
// vans get a long body and a cargo box, police get a flashing light bar,
// taxis a roof sign. Forward is local +Z: the mesh is rotated by the
// heading and drive() moves it along (sin h, cos h), so the nose (+Z) leads.
export function makeCarMesh(defKey, colorHex) {
  const def = CAR_DEFS[defKey];
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: colorHex });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x16181d });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x9fc4d8 });
  const isTruck = defKey === 'caminar';
  const isVan = defKey === 'carguero';
  const longBody = isTruck || isVan;
  const bodyLen = longBody ? 5.4 : 4.4;

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.62, bodyLen), bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  g.add(body);
  // The respray shop repaints this mesh by reference, not by child index.
  g.userData.body = body;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, isTruck ? 1.4 : 2.1), isTruck ? bodyMat : glassMat);
  cabin.position.set(0, 1.1, isTruck ? 1.6 : -0.15);
  cabin.castShadow = true;
  g.add(cabin);
  if (isVan) {
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(1.85, 1.1, 2.6), bodyMat);
    cargo.position.set(0, 1.15, -1.1);
    cargo.castShadow = true;
    g.add(cargo);
  }
  // Wheels.
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x0c0d10 });
  const wheelZ = longBody ? [-1.7, 1.7] : [-1.45, 1.45];
  for (const z of wheelZ) {
    for (const x of [-0.95, 0.95]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, 0.36, z);
      g.add(w);
    }
  }
  // Headlights on the nose (+Z, the direction of travel) and taillights
  // on the rear (-Z). The first build had these swapped — white lights
  // shining out of the boot.
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xd21f2b });
  const lightZ = longBody ? 2.72 : 2.22;
  for (const x of [-0.6, 0.6]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.06), headMat);
    h.position.set(x, 0.6, lightZ);
    g.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.06), tailMat);
    t.position.set(x, 0.6, -lightZ);
    g.add(t);
  }
  if (defKey === 'police') {
    // Light bar: blue left, red right. The manager flashes them by
    // swapping the two materials' colours each half-second; the meshes are
    // kept in userData so the flash can find them.
    const blueMat = new THREE.MeshBasicMaterial({ color: 0x2b6fd6 });
    const redMat = new THREE.MeshBasicMaterial({ color: 0xd21f2b });
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.14, 0.4), blueMat);
    blue.position.set(-0.28, 1.45, -0.1);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.42), redMat);
    red.position.set(0.28, 1.45, -0.1);
    g.add(blue, red);
    g.userData.lightBars = [blue, red];
    g.userData.lightMats = [blueMat, redMat];
  }
  if (defKey === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.3), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
    sign.position.set(0, 1.5, -0.15);
    g.add(sign);
  }
  g.userData.length = bodyLen;
  return g;
}

export class Car {
  constructor(defKey, colorHex, x, z, heading) {
    this.defKey = defKey;
    this.def = CAR_DEFS[defKey];
    this.mesh = makeCarMesh(defKey, colorHex);
    this.pos = new THREE.Vector3(x, 0, z);
    this.heading = heading;
    this.speed = 0;
    this.steer = 0;
    this.health = 100;
    this.smoking = false;
    this.dead = false;
    this.kind = 'traffic';
    this.driver = null; // 'player' when the player sits in it
    this.ai = null; // traffic / police brain state
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = heading;
  }

  get length() { return this.mesh.userData.length; }

  // Arcade step: throttle -1..1, steer -1..1. Collides with buildings.
  drive(dt, throttle, steerInput, colliders) {
    const def = this.def;
    const target = throttle * (throttle >= 0 ? def.topSpeed : def.topSpeed * 0.32);
    const rate = throttle >= 0 ? def.accel : def.brake;
    if (throttle !== 0) {
      this.speed += clamp(target - this.speed, -rate * dt, rate * dt);
    } else {
      this.speed = Math.abs(this.speed) < 0.2 ? 0 : this.speed - Math.sign(this.speed) * 8 * dt;
    }
    const speedNorm = clamp(Math.abs(this.speed) / def.topSpeed, 0, 1);
    this.steer = steerInput * (0.55 + 0.45 * (1 - speedNorm));
    // Heading decreases when steering right (D): forward is (sin h, cos h),
    // so turning right from south swings the nose toward the west.
    const turn = this.steer * (1.9 - speedNorm * 0.9) * Math.sign(this.speed || 1) * dt;
    this.heading -= turn;
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += Math.cos(this.heading) * this.speed * dt;
    // Buildings: slide along them, lose a little speed on impact.
    const before = { x: this.pos.x, z: this.pos.z };
    if (resolveCircleCollisions(colliders, this.pos, 1.9)) {
      const moved = dist2(before.x, before.z, this.pos.x, this.pos.z);
      if (moved < Math.abs(this.speed) * dt * 0.5) this.speed *= 0.55;
    }
    this.syncMesh();
  }

  syncMesh() {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.heading;
    // Lean into the turn, like a car body does.
    this.mesh.rotation.z = -this.steer * clamp(Math.abs(this.speed) / 20, 0, 1) * 0.05;
  }

  damage(amount) {
    this.health -= amount;
    if (this.health <= 30 && !this.smoking) this.smoking = true;
    if (this.health <= 0 && !this.dead) { this.dead = true; return true; }
    return false;
  }
}

// --- Traffic ----------------------------------------------------------------
// A traffic car cruises one road line, turns at intersections, brakes for the
// car ahead. Routes are road coordinates, never free driving, so traffic
// always looks like it belongs on the street.
export class TrafficManager {
  constructor(scene, world, rng) {
    this.scene = scene;
    this.world = world;
    this.rng = rng;
    this.cars = [];
    this.keys = ['brisa', 'vento', 'carguero', 'caminar', 'taxi'];
  }

  spawn(count, center, radius) {
    const lines = this.world.roads;
    for (let i = 0; i < count; i++) {
      const key = pick(this.rng, this.keys);
      const def = CAR_DEFS[key];
      const color = pick(this.rng, def.colors);
      const axis = this.rng() < 0.5 ? 'x' : 'z';
      const line = pick(this.rng, lines);
      const along = (this.rng() * 2 - 1) * radius + (axis === 'x' ? center.z : center.x);
      // A touch of lateral jitter so traffic doesn't look glued to the line.
      const lateral = (this.rng() - 0.5) * 2.4;
      const x = axis === 'x' ? line + lateral : along;
      const z = axis === 'x' ? along : line + lateral;
      const dir = this.rng() < 0.5 ? 1 : -1;
      const heading = axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
      const car = new Car(key, color, x, z, heading);
      car.kind = 'traffic';
      car.ai = { axis, dir, targetSpeed: 7 + this.rng() * 4, wait: 0 };
      this.scene.add(car.mesh);
      this.cars.push(car);
    }
  }

  update(dt, playerPos, allCars) {
    const lines = this.world.roads;
    for (const car of this.cars) {
      if (car.dead) continue;
      const ai = car.ai;
      if (ai.wait > 0) { ai.wait -= dt; car.drive(dt, 0, 0, this.world.colliders); continue; }
      // Car ahead on the same lane? Brake.
      let blocked = false;
      for (const other of allCars) {
        if (other === car || other.dead) continue;
        const dx = other.pos.x - car.pos.x, dz = other.pos.z - car.pos.z;
        const ahead = dx * Math.sin(car.heading) + dz * Math.cos(car.heading);
        const side = Math.abs(dx * Math.cos(car.heading) - dz * Math.sin(car.heading));
        if (ahead > 0 && ahead < 9 && side < 2.2) { blocked = true; break; }
      }
      // Player crossing in front? Brake too.
      if (playerPos) {
        const dx = playerPos.x - car.pos.x, dz = playerPos.z - car.pos.z;
        const ahead = dx * Math.sin(car.heading) + dz * Math.cos(car.heading);
        const side = Math.abs(dx * Math.cos(car.heading) - dz * Math.sin(car.heading));
        if (ahead > 0 && ahead < 8 && side < 2.4) blocked = true;
      }
      const throttle = blocked ? -0.4 : (car.speed < ai.targetSpeed ? 0.6 : 0.1);
      car.drive(dt, throttle, 0, this.world.colliders);
      // At an intersection, sometimes turn onto the crossing road.
      const onLine = ai.axis === 'x'
        ? Math.abs(car.pos.z - nearestRoadCoord(car.pos.z)) < 1.2
        : Math.abs(car.pos.x - nearestRoadCoord(car.pos.x)) < 1.2;
      if (onLine && this.rng() < dt * 0.25) {
        const turn = this.rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
        ai.axis = ai.axis === 'x' ? 'z' : 'x';
        ai.dir = 1;
        car.heading += turn;
        if (this.rng() < 0.35) ai.wait = 1 + this.rng() * 2; // pause at the light
      }
      // Keep traffic inside the city; clamp far cars back in.
      if (Math.abs(car.pos.x) > 240 || Math.abs(car.pos.z) > 240) {
        car.pos.x = clamp(car.pos.x, -200, 200);
        car.pos.z = clamp(car.pos.z, -200, 200);
      }
    }
  }
}

// --- Police -----------------------------------------------------------------
export class PoliceManager {
  constructor(scene, world, rng) {
    this.scene = scene;
    this.world = world;
    this.rng = rng;
    this.cars = [];
    this.heli = null;
    this.heliLight = null;
    this.spawnTimer = 0;
    this.flashPhase = 0;
  }

  wantedToCount(wanted) {
    return wanted <= 0 ? 0 : wanted <= 1 ? 1 : wanted <= 2 ? 2 : wanted <= 3 ? 3 : 4;
  }

  // Spawn one unit immediately, ignoring the 2.5s pacing — used by the
  // screenshot staging, which needs a fixed number of cars in frame.
  spawnOne(playerPos) {
    const spot = randomPointInCircle(this.rng, playerPos.x, playerPos.z, 90);
    const car = new Car('police', CAR_COLORS.police, clamp(spot.x, -200, 200), clamp(spot.z, -200, 200), 0);
    car.kind = 'police';
    this.scene.add(car.mesh);
    this.cars.push(car);
    return car;
  }

  update(dt, wanted, playerPos, playerInCar, allCars) {
    const want = this.wantedToCount(wanted);
    // Spawn / despawn to match the wanted level (one new unit per 2.5s).
    this.spawnTimer -= dt;
    if (this.cars.length < want && this.spawnTimer <= 0) {
      this.spawnTimer = 2.5;
      this.spawnOne(playerPos);
    }
    while (this.cars.length > want) {
      const c = this.cars.pop();
      this.scene.remove(c.mesh);
    }
    // Chase: steer at the player's predicted position, ram on contact.
    for (const car of this.cars) {
      if (car.dead) continue;
      const dx = playerPos.x - car.pos.x, dz = playerPos.z - car.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz) || 1;
      const targetHeading = Math.atan2(dx, dz);
      // Steer sign matches drive(): heading decreases on a right turn, so a
      // target to the left (positive angleDiff) needs negative steer.
      const steer = clamp(-angleDiff(car.heading, targetHeading) * 1.6, -1, 1);
      const throttle = d > 6 ? 1 : 0.4;
      car.drive(dt, throttle, steer, this.world.colliders);
      // Ram the player.
      if (d < 3.4) {
        car.speed *= 0.4;
      }
    }
    // Flash the light bars: blue and red alternate every half second.
    this.flashPhase += dt;
    const blueOn = Math.floor(this.flashPhase * 2) % 2 === 0;
    for (const car of this.cars) {
      const mats = car.mesh.userData.lightMats;
      if (!mats) continue;
      mats[0].color.setHex(blueOn ? 0x2b6fd6 : 0x0a2a55);
      mats[1].color.setHex(blueOn ? 0x5a0f16 : 0xd21f2b);
    }
    // Helicopter from 3 stars up.
    if (wanted >= 3 && !this.heli) this.spawnHeli();
    if (wanted < 3 && this.heli) {
      this.scene.remove(this.heli);
      if (this.heliLight) this.scene.remove(this.heliLight);
      this.heli = null; this.heliLight = null;
    }
    if (this.heli) {
      const t = performance.now() / 1000;
      this.heli.position.set(
        playerPos.x + Math.sin(t * 0.5) * 14,
        42 + Math.sin(t * 0.8) * 2,
        playerPos.z + Math.cos(t * 0.4) * 14,
      );
      this.heli.rotation.y = Math.atan2(playerPos.x - this.heli.position.x, playerPos.z - this.heli.position.z);
      // Children: 0 body, 1 tail, 2 rotor group, 3 glass — spin the rotor.
      this.heli.children[2].rotation.y += dt * 22;
      if (this.heliLight) {
        this.heliLight.position.copy(this.heli.position);
        this.heliLight.target.position.set(playerPos.x, 0, playerPos.z);
        this.heliLight.target.updateMatrixWorld();
      }
    }
  }

  spawnHeli() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x1d2733 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.4, 6.5), bodyMat);
    body.castShadow = true;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 5), bodyMat);
    tail.position.set(0, 0.4, 5);
    const rotor = new THREE.Group();
    const bladeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    for (let i = 0; i < 2; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(11, 0.08, 0.5), bladeMat);
      blade.rotation.y = (i * Math.PI) / 2;
      rotor.add(blade);
    }
    rotor.position.y = 1.2;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1, 1.6), new THREE.MeshLambertMaterial({ color: 0x9fc4d8 }));
    glass.position.set(0, 0.2, -2.6);
    g.add(body, tail, rotor, glass);
    this.heli = g;
    this.scene.add(g);
    const spot = new THREE.SpotLight(0xfff2c0, 900, 120, 0.32, 0.5, 1.2);
    spot.target.position.set(0, 0, 0);
    this.scene.add(spot.target);
    this.heliLight = spot;
    this.scene.add(spot);
  }

  nearestPoliceDist(playerPos) {
    let best = Infinity;
    for (const c of this.cars) {
      if (c.dead) continue;
      best = Math.min(best, dist2(c.pos.x, c.pos.z, playerPos.x, playerPos.z));
    }
    return best;
  }
}
