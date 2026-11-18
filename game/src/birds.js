// BRISA BAY — birds. Two flocks circle the lighthouse and the pier: simple
// V-shaped gulls on slow orbits, wings flapping, far above the traffic.
// Pure ambience — no collision, no AI, no save — but a sky with birds in
// it reads as a living city at a glance, and the lighthouse flock gives
// the north beach a reason to look up.
import * as THREE from 'three';
import { BIRD_FLOCKS } from './config.js';

// One gull: a small dark body and two thin wings that flap. The whole
// bird is a group so the flock can place it on its orbit and yaw it
// along the flight path.
function makeBirdMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x2a2d33, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.18, 1.1), mat);
  g.add(body);
  const wingGeo = new THREE.BoxGeometry(1.5, 0.06, 0.5);
  const wingL = new THREE.Mesh(wingGeo, mat);
  wingL.position.set(-0.85, 0, 0);
  const wingR = new THREE.Mesh(wingGeo, mat);
  wingR.position.set(0.85, 0, 0);
  g.add(wingL, wingR);
  g.userData.wings = [wingL, wingR];
  return g;
}

export class BirdFlock {
  // `flock` is one entry of BIRD_FLOCKS: an anchor, a count, an orbit
  // radius and a height. Each bird gets its own angle, radius and speed
  // so the flock never flies in formation like a drill team.
  constructor(scene, flock) {
    this.scene = scene;
    this.anchor = { x: flock.x, z: flock.z };
    this.height = flock.height;
    this.birds = [];
    for (let i = 0; i < flock.count; i++) {
      const mesh = makeBirdMesh();
      scene.add(mesh);
      this.birds.push({
        mesh,
        angle: (i / flock.count) * Math.PI * 2,
        radius: flock.radius * (0.7 + Math.random() * 0.6),
        speed: 0.12 + Math.random() * 0.08,
        bob: Math.random() * Math.PI * 2,
        flap: Math.random() * Math.PI * 2,
      });
    }
    // Place them on their orbits now: the menu state never calls update,
    // and a flock sitting at the origin would read as birds on the ground
    // at the Plaza.
    this.update(0, 0);
  }

  get count() { return this.birds.length; }

  update(dt, elapsed) {
    for (const b of this.birds) {
      b.angle += dt * b.speed;
      b.flap += dt * 9;
      const x = this.anchor.x + Math.sin(b.angle) * b.radius;
      const z = this.anchor.z + Math.cos(b.angle) * b.radius;
      const y = this.height + Math.sin(elapsed * 0.7 + b.bob) * 2;
      b.mesh.position.set(x, y, z);
      // Face along the orbit: the tangent of the circle at this angle.
      b.mesh.rotation.y = Math.atan2(Math.cos(b.angle), -Math.sin(b.angle));
      // Wings flap in opposite phase, so the gull banks as it beats.
      const flap = Math.sin(b.flap) * 0.55;
      b.mesh.userData.wings[0].rotation.z = flap;
      b.mesh.userData.wings[1].rotation.z = -flap;
    }
  }
}

// Both flocks, built from config. Kept in one manager so the game loop
// has a single update call and the shots can count the birds.
export class Birds {
  constructor(scene) {
    this.scene = scene;
    this.flocks = BIRD_FLOCKS.map((f) => new BirdFlock(scene, f));
  }

  get count() {
    return this.flocks.reduce((n, f) => n + f.count, 0);
  }

  // Where every bird is right now — for the live probe, which checks the
  // flocks are actually in the air above their anchors, not on the ground.
  positions() {
    const out = [];
    for (const f of this.flocks) {
      for (const b of f.birds) out.push({ x: b.mesh.position.x, y: b.mesh.position.y, z: b.mesh.position.z });
    }
    return out;
  }

  update(dt, elapsed) {
    for (const f of this.flocks) f.update(dt, elapsed);
  }
}
