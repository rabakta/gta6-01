// BRISA BAY — distinct districts + the Club Solmar interior.
// Districts reuse the city as built: gate signs + centre glows, no new
// textures, no new shadow casters, no per-frame work beyond one lookup
// and a HUD string. The club is plain boxes at (600,600), far outside
// the city, so no city system ever touches it.
import * as THREE from 'three';
import { dist2 } from './utils.js';
import { neonSignTexture, glowTexture } from './textures.js';

export const DISTRICTS = [
  { id: 0, name: 'CENTRAL', color: '#ffd98a', cx: 0, cz: 30 },
  { id: 1, name: 'MARINA', color: '#4fd8ff', cx: 200, cz: 60 },
  { id: 2, name: 'DOCKS', color: '#ff8c42', cx: 150, cz: -130 },
  { id: 3, name: 'DOWNTOWN', color: '#ffd34d', cx: 0, cz: -140 },
  { id: 4, name: 'AIRFIELD', color: '#ff5a4d', cx: -150, cz: -150 },
  { id: 5, name: 'OLD TOWN', color: '#7ee2a8', cx: -140, cz: 120 },
];

export function districtAt(x, z) {
  if (x >= 90 && z <= -60) return DISTRICTS[2];
  if (x >= 150) return DISTRICTS[1];
  if (z <= -90 && x > -90 && x < 90) return DISTRICTS[3];
  if (x <= -90 && z <= -60) return DISTRICTS[4];
  if (x <= -90 && z >= 60) return DISTRICTS[5];
  return DISTRICTS[0];
}

// Club Solmar: the casino's south face is the door; the room itself is
// built far away at (600,600) so traffic, peds and missions never see it.
export const CLUB = { doorX: 0, doorZ: -165.5, roomX: 600, roomZ: 600, wallH: 5 };
export const ROOM = { minX: 589, maxX: 611, minZ: 593, maxZ: 607 };
const ENTER_SPOT = { x: 600, z: 600 };
const EXIT_SPOT = { x: 600, z: 606 };

// District gates: a neon sign where each district starts. Towers fill
// every block, so the spot is nudged until it clears every collider.
const GATES = [
  { d: 1, x: 150, z: 30 },
  { d: 2, x: 150, z: -90 },
  { d: 3, x: 30, z: -150 },
  { d: 4, x: -150, z: -150 },
  { d: 5, x: -150, z: 90 },
];
const NUDGES = [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6], [12, 0], [-12, 0], [0, 12], [0, -12], [6, 6], [-6, -6], [6, -6], [-6, 6]];
function freeSpot(colliders, x, z, r) {
  for (const [dx, dz] of NUDGES) {
    const px = x + dx, pz = z + dz;
    if (!colliders.some((c) => px > c.minX - r && px < c.maxX + r && pz > c.minZ - r && pz < c.maxZ + r)) return { x: px, z: pz };
  }
  return { x, z };
}

export class DistrictsManager {
  constructor(game) {
    this.game = game;
    this.inside = false;
    this.savedPos = null;
    this.current = districtAt(game.player.pos.x, game.player.pos.z).id;
    this.roomColliders = [];
    this.gateSpots = [];
    this.buildGates(game.scene, game.world.colliders);
    this.buildClub(game.scene);
  }

  buildGates(scene, colliders) {
    const haloTex = glowTexture();
    for (const gate of GATES) {
      const d = DISTRICTS[gate.d];
      const spot = freeSpot(colliders, gate.x, gate.z, 3);
      this.gateSpots.push({ x: spot.x, z: spot.z, name: d.name });
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.4, 5, 8),
        new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.9 }),
      );
      post.position.set(spot.x, 2.5, spot.z);
      scene.add(post);
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(9, 2.25),
        new THREE.MeshBasicMaterial({ map: neonSignTexture([d.name], d.color) }),
      );
      sign.position.set(spot.x, 4.6, spot.z);
      sign.rotation.y = Math.atan2(-spot.x, -spot.z);
      scene.add(sign);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: haloTex, color: new THREE.Color(d.color), transparent: true, opacity: 0.45,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      halo.position.set(spot.x, 4.6, spot.z);
      halo.scale.setScalar(12);
      scene.add(halo);
    }
    // One soft glow at each district centre, so the palette reads at night.
    for (const d of DISTRICTS) {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: haloTex, color: new THREE.Color(d.color), transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.position.set(d.cx, 6, d.cz);
      glow.scale.setScalar(18);
      scene.add(glow);
    }
  }

  buildClub(scene) {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x5a1f24, roughness: 0.85 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x2e2013, roughness: 0.8 });
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0x0e0e14, roughness: 0.9 });
    const barMat = new THREE.MeshStandardMaterial({ color: 0x1c1206, roughness: 0.4 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.25, metalness: 0.85 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x14141c, roughness: 0.7 });
    const bottleMats = [0x2a7a3a, 0xc98a2a, 0xdddddd].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.2 }));
    const { roomX: X, roomZ: Z, wallH: H } = CLUB;
    const add = (mat, sx, sy, sz, x, y, z) => {
      const m = new THREE.Mesh(box, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      scene.add(m);
      return m;
    };
    add(floorMat, 24.6, 0.2, 16.6, X, -0.1, Z);
    add(ceilMat, 24.6, 0.2, 16.6, X, H + 0.1, Z);
    add(wallMat, 24.6, H, 0.6, X, H / 2, Z - 8);
    add(wallMat, 0.6, H, 16.6, X + 12, H / 2, Z);
    add(wallMat, 0.6, H, 16.6, X - 12, H / 2, Z);
    add(wallMat, 10.5, H, 0.6, X - 6.75, H / 2, Z + 8);
    add(wallMat, 10.5, H, 0.6, X + 6.75, H / 2, Z + 8);
    add(wallMat, 3, 2, 0.6, X, 4, Z + 8);
    // Bar against the north wall, stools in front, bottles on top.
    add(barMat, 8, 1.1, 1, X - 6, 0.55, Z - 6.2);
    this.roomColliders.push({ minX: 590, maxX: 598, minZ: 593.3, maxZ: 594.3 });
    const stoolGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.6, 8);
    for (const sx of [591.5, 593.5, 595.5, 597.5]) {
      const stool = new THREE.Mesh(stoolGeo, chromeMat);
      stool.position.set(sx, 0.3, 596);
      scene.add(stool);
    }
    const bottleGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.5, 6);
    for (let i = 0; i < 8; i++) {
      const bottle = new THREE.Mesh(bottleGeo, bottleMats[i % 3]);
      bottle.position.set(591 + i, 1.35, 593.8);
      scene.add(bottle);
    }
    // Three tables with legs and chairs; dance floor + disco ball.
    const topGeo = new THREE.CylinderGeometry(1, 1, 0.12, 12);
    const legGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.8, 6);
    for (const [tx, tz] of [[606, 596], [606, 603], [594, 603]]) {
      const top = new THREE.Mesh(topGeo, darkMat);
      top.position.set(tx, 0.8, tz);
      scene.add(top);
      const leg = new THREE.Mesh(legGeo, chromeMat);
      leg.position.set(tx, 0.4, tz);
      scene.add(leg);
      this.roomColliders.push({ minX: tx - 1, maxX: tx + 1, minZ: tz - 1, maxZ: tz + 1 });
      for (const cx of [tx - 1.6, tx + 1.6]) {
        add(darkMat, 0.5, 0.5, 0.5, cx, 0.25, tz);
      }
    }
    add(darkMat, 6, 0.1, 4, X + 3, 0.05, Z);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8), chromeMat);
    ball.position.set(X + 3, 3.8, Z);
    scene.add(ball);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6), chromeMat);
    rod.position.set(X + 3, 4.6, Z);
    scene.add(rod);
    // Neon sign on the north wall + jukebox on the east wall.
    const neon = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 2),
      new THREE.MeshBasicMaterial({ map: neonSignTexture(['CLUB SOLMAR'], '#ffd34d') }),
    );
    neon.position.set(X, 3.6, Z - 7.6);
    scene.add(neon);
    add(darkMat, 1.2, 1.8, 0.6, X + 11, 0.9, Z - 4);
    this.roomColliders.push({ minX: 610.4, maxX: 611.6, minZ: 595.7, maxZ: 596.3 });
    // Two warm lights, no shadows: the room is small and the sun never reaches it.
    for (const [lx, lz] of [[596, 597], [606, 603]]) {
      const light = new THREE.PointLight(0xffd9a0, 50, 30, 1.6);
      light.position.set(lx, 4.2, lz);
      scene.add(light);
    }
    // The door outside: neon on the casino face, gold carpet on the street.
    const doorSign = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 1.5),
      new THREE.MeshBasicMaterial({ map: neonSignTexture(['CLUB SOLMAR'], '#ffd34d') }),
    );
    doorSign.position.set(CLUB.doorX, 3.4, CLUB.doorZ - 1.4);
    scene.add(doorSign);
    const carpet = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 2),
      new THREE.MeshBasicMaterial({ color: 0xd9a441 }),
    );
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set(CLUB.doorX, 0.06, CLUB.doorZ + 1);
    scene.add(carpet);
  }

  update() {
    const g = this.game;
    if (this.inside) return;
    const d = districtAt(g.player.pos.x, g.player.pos.z);
    if (d.id === this.current) return;
    this.current = d.id;
    const seen = g.save.districts || (g.save.districts = []);
    if (seen.includes(d.id)) return;
    seen.push(d.id);
    g.notify('Welcome to ' + d.name + ' — ' + seen.length + '/6 districts');
    g.writeSave();
  }

  canEnter() {
    const g = this.game;
    if (g.cutscenes && g.cutscenes.active) return false;
    const m = g.missions;
    if (m && (m.state === 'active' || m.state === 'race_mode' || m.state === 'race_loading')) return false;
    if (g.side && g.side.job) return false;
    if (g.taxi && g.taxi.fare) return false;
    return true;
  }

  prompt() {
    const g = this.game;
    if (g.player.inCar) return null;
    const p = g.player.pos;
    if (this.inside) {
      return dist2(p.x, p.z, EXIT_SPOT.x, EXIT_SPOT.z) < 3 ? 'Leave Club Solmar' : null;
    }
    if (!this.canEnter()) return null;
    return dist2(p.x, p.z, CLUB.doorX, CLUB.doorZ) < 3.5 ? 'Enter Club Solmar' : null;
  }

  tryInteract() {
    const g = this.game;
    if (g.player.inCar) return false;
    if (this.inside) {
      if (dist2(g.player.pos.x, g.player.pos.z, EXIT_SPOT.x, EXIT_SPOT.z) >= 3) return false;
      this.exit();
      return true;
    }
    if (!this.canEnter()) return false;
    if (dist2(g.player.pos.x, g.player.pos.z, CLUB.doorX, CLUB.doorZ) >= 3.5) return false;
    this.enter();
    return true;
  }

  enter() {
    const g = this.game;
    this.savedPos = { x: g.player.pos.x, z: g.player.pos.z, heading: g.player.heading };
    this.inside = true;
    g.player.pos.set(ENTER_SPOT.x, 0, ENTER_SPOT.z);
    g.player.heading = Math.PI;
    g.notify('Club Solmar — the night is yours. E at the door to leave.');
    g.audio.blip(880, 0.15, 0.25);
  }

  exit() {
    const g = this.game;
    this.inside = false;
    const s = this.savedPos || { x: CLUB.doorX, z: CLUB.doorZ + 2, heading: 0 };
    g.player.pos.set(s.x, 0, s.z);
    g.player.heading = s.heading;
    g.notify('Back on the street.');
  }

  hudLine() {
    if (this.inside) return 'CLUB SOLMAR';
    const seen = (this.game.save.districts || []).length;
    return DISTRICTS[this.current].name + ' · ' + seen + '/6';
  }

  mapPlayer(p) {
    if (this.inside) return { x: CLUB.doorX, z: CLUB.doorZ, heading: p.heading };
    return { x: p.pos.x, z: p.pos.z, heading: p.heading };
  }

  bounds() {
    return this.inside ? ROOM : null;
  }
}
