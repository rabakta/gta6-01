// BRISA BAY — cars: the player's ride, city traffic and the BCPD.
// Arcade handling: heading + speed on the road grid, circle-vs-box
// building collision, oriented-box car collision. Traffic follows the
// road lines; police pursue and the helicopter orbits from three stars.
import * as THREE from 'three';
import { CAR_DEFS, UPGRADES, ROADBLOCK_MIN_WANTED, ROADBLOCK_COUNT, BOAT_BOUNDS } from './config.js';
import { clamp, angleDiff, dist2, pick, randomPointInCircle } from './utils.js';
import { nearestRoadCoord, resolveCircleCollisions } from './city.js';
import { barrierTexture, glowTexture, clearcoatNormalMap } from './textures.js';

const CAR_COLORS = { police: 0x1d2733 };

// Oriented-box overlap between two cars (separating-axis test on both
// cars' forward/side axes). Returns the penetration depth, 0 when clear.
// A circle test lets a bus nose clip 2 m into a sedan before it fires;
// this one knows how long each car is.
export function carsOverlap(a, b) {
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > (a.length + b.length) / 2 + 1.2) return 0;
  const ha = a.heading, hb = b.heading;
  const cd = Math.cos(ha - hb), sd = Math.sin(ha - hb);
  const aw = 1.05, bw = 1.05;
  const axes = [
    [Math.sin(ha), Math.cos(ha), a.length / 2, (b.length / 2) * Math.abs(cd) + bw * Math.abs(sd)],
    [Math.cos(ha), -Math.sin(ha), aw, (b.length / 2) * Math.abs(sd) + bw * Math.abs(cd)],
    [Math.sin(hb), Math.cos(hb), b.length / 2, (a.length / 2) * Math.abs(cd) + aw * Math.abs(sd)],
    [Math.cos(hb), -Math.sin(hb), bw, (a.length / 2) * Math.abs(sd) + aw * Math.abs(cd)],
  ];
  let pen = Infinity;
  for (const [ax, az, halfA, halfB] of axes) {
    const proj = Math.abs(dx * ax + dz * az);
    const gap = halfA + halfB - proj;
    if (gap <= 0) return 0;
    if (gap < pen) pen = gap;
  }
  return pen + 0.05;
}

// Shared box geometries (keyed by size) and materials, so thirty cars
// do not build thirty copies of the same box.
const boxCache = new Map();
function box(w, h, d) {
  const k = w + '|' + h + '|' + d;
  let g = boxCache.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); boxCache.set(k, g); }
  return g;
}

// PBR Materials for cars
const bodyMats = new Map();
function bodyMat(colorHex) {
  let m = bodyMats.get(colorHex);
  if (!m) { 
    m = new THREE.MeshStandardMaterial({ 
      color: colorHex, 
      roughness: 0.35, 
      metalness: 0.85,
      clearcoat: 0.5,
      clearcoatRoughness: 0.1,
      clearcoatNormalMap: clearcoatNormalMap(0),
      clearcoatNormalScale: new THREE.Vector2(0.5, 0.5),
    }); 
    bodyMats.set(colorHex, m); 
  }
  return m;
}
const darkMat = new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.5, metalness: 0.2 });
const glassMat = new THREE.MeshPhysicalMaterial({ 
  color: 0x9fc4d8, 
  roughness: 0.05, 
  metalness: 0.0,
  transmission: 0.85,
  thickness: 0.5,
  ior: 1.5,
  clearcoat: 1.0,
  clearcoatRoughness: 0.05
});
const headLensMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
const tailLensMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
const hubMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.3, metalness: 0.8 });
const brakeMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9, metalness: 0.1 });
const grilleMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.6 });

// Headlight/taillight halos
let headGlowMat = null;
let tailGlowMat = null;
function lightGlowMats() {
  if (!headGlowMat) {
    const tex = glowTexture();
    headGlowMat = new THREE.SpriteMaterial({ map: tex, color: 0xffe9a8, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false });
    tailGlowMat = new THREE.SpriteMaterial({ map: tex, color: 0xff2a2a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  }
  return { headGlowMat, tailGlowMat };
}

// PS1-era silhouette per type: chunky low-poly bodies with a distinct
// hood and trunk level, a sloped glasshouse, bumpers, mirrors and (on the
// sporty types) a spoiler. w = body width, hood/trunk = level lengths,
// cabZ/cabL/cabH = glasshouse placement. All original, built from boxes.
// Updated with more realistic proportions and detail allowances.
const SHAPE = {
  brisa:    { w: 1.85, L: 4.5, hood: 1.2, trunk: 0.9, cabZ: -0.2, cabL: 2.0, cabH: 0.55, spoiler: 0, roofH: 0.45, bumperH: 0.3 },
  vento:    { w: 1.9, L: 4.7, hood: 1.5, trunk: 0.7, cabZ: -0.5, cabL: 1.7, cabH: 0.45, spoiler: 1, roofH: 0.4, bumperH: 0.3 },
  furia:    { w: 1.95, L: 4.9, hood: 1.8, trunk: 0.5, cabZ: -0.6, cabL: 1.5, cabH: 0.4, spoiler: 1, roofH: 0.35, bumperH: 0.25 },
  carguero: { w: 2.0, L: 5.6, hood: 1.1, trunk: 0, cabZ: 1.3, cabL: 1.5, cabH: 0.55, spoiler: 0, roofH: 0.5, bumperH: 0.4 },
  caminar:  { w: 2.1, L: 5.8, hood: 1.3, trunk: 0, cabZ: 1.6, cabL: 1.5, cabH: 0.6, spoiler: 0, roofH: 0.5, bumperH: 0.4 },
  taxi:     { w: 1.85, L: 4.5, hood: 1.2, trunk: 0.9, cabZ: -0.2, cabL: 2.0, cabH: 0.55, spoiler: 0, roofH: 0.45, bumperH: 0.3 },
  bus:      { w: 2.2, L: 8.0, hood: 0.6, trunk: 0, cabZ: -0.4, cabL: 6.8, cabH: 0.6, spoiler: 0, roofH: 0.6, bumperH: 0.4 },
  police:   { w: 1.85, L: 4.5, hood: 1.2, trunk: 0.9, cabZ: -0.2, cabL: 2.0, cabH: 0.55, spoiler: 0, roofH: 0.45, bumperH: 0.3 },
};

export function makeCarMesh(defKey, colorHex) {
  const def = CAR_DEFS[defKey];
  const g = new THREE.Group();
  const bm = bodyMat(colorHex);
  const sh = SHAPE[defKey];
  const isTruck = defKey === 'caminar';
  const isVan = defKey === 'carguero';
  const isBike = defKey === 'moto';
  const isBus = defKey === 'bus';
  const longBody = isTruck || isVan || isBus;
  const bodyLen = isBike ? 2.2 : sh.L;
  const halfLen = bodyLen / 2;

  // A bike is a narrow frame with a rider, not a car body — build it
  // here and return early, before the car-only parts below.
  if (isBike) {
    const frame = new THREE.Mesh(box(0.5, 0.4, bodyLen), bm);
    frame.position.y = 0.55;
    frame.castShadow = true;
    g.add(frame);
    g.userData.body = frame;
    const tank = new THREE.Mesh(box(0.42, 0.3, 0.7), glassMat);
    tank.position.set(0, 0.85, 0.5);
    g.add(tank);
    const seat = new THREE.Mesh(box(0.4, 0.14, 0.7), darkMat);
    seat.position.set(0, 0.78, -0.5);
    g.add(seat);
    const riderMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    const torso = new THREE.Mesh(box(0.5, 0.6, 0.3), riderMat);
    torso.position.set(0, 1.15, -0.35);
    torso.rotation.x = 0.35;
    const helmet = new THREE.Mesh(box(0.34, 0.34, 0.36), new THREE.MeshLambertMaterial({ color: colorHex }));
    helmet.position.set(0, 1.6, -0.15);
    const armL = new THREE.Mesh(box(0.12, 0.12, 0.6), riderMat);
    armL.position.set(-0.28, 1.15, 0.25);
    const armR = armL.clone();
    armR.position.x = 0.28;
    const legL = new THREE.Mesh(box(0.14, 0.5, 0.14), riderMat);
    legL.position.set(-0.25, 0.6, -0.3);
    const legR = legL.clone();
    legR.position.x = 0.25;
    g.add(torso, helmet, armL, armR, legL, legR);
    // Fenders over both wheels and a small windscreen ahead of the rider.
    const fenderGeo = box(0.34, 0.08, 0.8);
    const fenderF = new THREE.Mesh(fenderGeo, bm);
    fenderF.position.set(0, 0.78, 0.85);
    fenderF.rotation.x = -0.25;
    const fenderR = new THREE.Mesh(fenderGeo, bm);
    fenderR.position.set(0, 0.78, -0.85);
    fenderR.rotation.x = 0.25;
    const screen = new THREE.Mesh(box(0.42, 0.35, 0.05), glassMat);
    screen.position.set(0, 1.25, 0.72);
    screen.rotation.x = -0.3;
    g.add(fenderF, fenderR, screen);
    const bikeWheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.18, 10);
    const bikeWheelMat = new THREE.MeshLambertMaterial({ color: 0x0c0d10 });
    const bikeWheels = [];
    for (const z of [-0.85, 0.85]) {
      const w = new THREE.Mesh(bikeWheelGeo, bikeWheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(0, 0.36, z);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.22, 8), hubMat);
      w.add(hub);
      g.add(w);
      bikeWheels.push(w);
    }
    g.userData.wheels = bikeWheels;
    // Headlight in a 3D housing on the nose, one taillight at the rear.
    const housing = new THREE.Mesh(box(0.26, 0.2, 0.16), darkMat);
    housing.position.set(0, 0.62, 1.08);
    g.add(housing);
    const head = new THREE.Mesh(box(0.2, 0.13, 0.06), headLensMat);
    head.position.set(0, 0.62, 1.18);
    g.add(head);
    const tm = new THREE.MeshBasicMaterial({ color: 0x8a1616 });
    const tail = new THREE.Mesh(box(0.2, 0.13, 0.06), tm);
    tail.position.set(0, 0.62, -1.12);
    g.add(tail);
    g.userData.tailMats = [tm];
    const bikeGlow = lightGlowMats();
    const bikeHeadHalo = new THREE.Sprite(bikeGlow.headGlowMat);
    bikeHeadHalo.position.set(0, 0.62, 1.3);
    bikeHeadHalo.scale.setScalar(1.4);
    g.add(bikeHeadHalo);
    const bikeTailHalo = new THREE.Sprite(bikeGlow.tailGlowMat);
    bikeTailHalo.position.set(0, 0.62, -1.3);
    bikeTailHalo.scale.setScalar(1.2);
    g.add(bikeTailHalo);
    g.userData.length = bodyLen;
    return g;
  }

  const body = new THREE.Mesh(box(sh.w, 0.55, bodyLen), bm);
  body.position.y = 0.52;
  body.castShadow = true;
  g.add(body);
  g.userData.body = body;
  // Hood and trunk sit a level lower than the body top, so the car
  // reads as three volumes (nose, cabin, tail) instead of one box.
  if (sh.hood > 0) {
    const hood = new THREE.Mesh(box(sh.w - 0.12, 0.34, sh.hood), bm);
    hood.position.set(0, 0.5, bodyLen / 2 - sh.hood / 2 - 0.03);
    hood.castShadow = true;
    g.add(hood);
  }
  if (sh.trunk > 0) {
    const trunk = new THREE.Mesh(box(sh.w - 0.12, 0.36, sh.trunk), bm);
    trunk.position.set(0, 0.5, -bodyLen / 2 + sh.trunk / 2 + 0.03);
    trunk.castShadow = true;
    g.add(trunk);
  }
  if (!isBus) {
    const cabin = new THREE.Mesh(box(1.6, sh.cabH, sh.cabL), isTruck ? bm : glassMat);
    cabin.position.set(0, 1.02, sh.cabZ);
    cabin.castShadow = true;
    g.add(cabin);
    // Sloped windshield and rear glass: thin panels leaning back into
    // the cabin, so the glasshouse is a wedge, not a box.
    const shield = new THREE.Mesh(box(1.5, 0.7, 0.06), glassMat);
    shield.position.set(0, 1.18, sh.cabZ + sh.cabL / 2 + 0.12);
    shield.rotation.x = -0.42;
    g.add(shield);
    const rearGlass = new THREE.Mesh(box(1.5, 0.6, 0.06), glassMat);
    rearGlass.position.set(0, 1.15, sh.cabZ - sh.cabL / 2 - 0.12);
    rearGlass.rotation.x = 0.38;
    g.add(rearGlass);
  }
  if (isBus) {
    const band = new THREE.Mesh(box(1.94, 0.5, 6.4), glassMat);
    band.position.set(0, 1.0, -0.3);
    band.castShadow = true;
    g.add(band);
    const shield = new THREE.Mesh(box(1.7, 0.6, 0.06), glassMat);
    shield.position.set(0, 1.3, 3.55);
    shield.rotation.x = -0.3;
    g.add(shield);
    const dest = new THREE.Mesh(box(1.2, 0.4, 0.08), new THREE.MeshBasicMaterial({ color: 0xf2a007 }));
    dest.position.set(0, 1.35, 3.82);
    g.add(dest);
  }
  if (isVan) {
    const cargo = new THREE.Mesh(box(1.85, 1.1, 2.6), bm);
    cargo.position.set(0, 1.15, -1.1);
    cargo.castShadow = true;
    g.add(cargo);
  }
  if (isTruck) {
    // Open bed: side walls and a tailgate, no roof over the load.
    for (const x of [-0.85, 0.85]) {
      const wall = new THREE.Mesh(box(0.12, 0.5, 2.6), bm);
      wall.position.set(x, 0.85, -1.2);
      g.add(wall);
    }
    const gate = new THREE.Mesh(box(1.8, 0.5, 0.12), bm);
    gate.position.set(0, 0.85, -2.5);
    g.add(gate);
  }
  // Bumpers, grille and mirrors: the details that make the nose read.
  for (const s of [1, -1]) {
    const bumper = new THREE.Mesh(box(sh.w + 0.06, 0.2, 0.24), darkMat);
    bumper.position.set(0, 0.32, s * (bodyLen / 2 + 0.04));
    g.add(bumper);
  }
  const grille = new THREE.Mesh(box(0.95, 0.15, 0.08), darkMat);
  grille.position.set(0, 0.55, bodyLen / 2 + 0.02);
  g.add(grille);
  for (const x of [-(sh.w / 2 + 0.06), sh.w / 2 + 0.06]) {
    const mirror = new THREE.Mesh(box(0.2, 0.12, 0.1), darkMat);
    mirror.position.set(x, 1.02, sh.cabZ + sh.cabL / 2 - 0.15);
    g.add(mirror);
  }
  if (sh.spoiler) {
    const wing = new THREE.Mesh(box(1.7, 0.07, 0.45), bm);
    wing.position.set(0, 1.18, -bodyLen / 2 + 0.35);
    wing.castShadow = true;
    g.add(wing);
    for (const x of [-0.6, 0.6]) {
      const strut = new THREE.Mesh(box(0.09, 0.28, 0.09), darkMat);
      strut.position.set(x, 1.02, -bodyLen / 2 + 0.35);
      g.add(strut);
    }
  }

  // Wheels with a dark arch disc behind each one (the wheel well) and a
  // hub cap that spins with the wheel. Kept in userData for the tyre
  // upgrade and the wheel-spin in drive().
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x0c0d10 });
  const archGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.12, 12);
  const hubGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.34, 8);
  const wheelZ = isBus ? [-2.6, 2.6] : longBody ? [-1.7, 1.7] : [-1.45, 1.45];
  const wheels = [];
  for (const z of wheelZ) {
    for (const x of [-0.95, 0.95]) {
      const arch = new THREE.Mesh(archGeo, darkMat);
      arch.rotation.z = Math.PI / 2;
      arch.position.set(Math.sign(x) * 0.88, 0.36, z);
      g.add(arch);
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, 0.36, z);
      w.add(new THREE.Mesh(hubGeo, hubMat));
      g.add(w);
      wheels.push(w);
    }
  }
  g.userData.wheels = wheels;
  const plate = new THREE.Mesh(box(1.5, 0.08, 2.2), new THREE.MeshLambertMaterial({ color: 0x4a4f55 }));
  plate.position.set(0, 1.42, -0.15);
  plate.visible = false;
  g.add(plate);
  g.userData.armorPlate = plate;
  const exhaustMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a });
  const exhaust = new THREE.Mesh(box(0.22, 0.22, 0.3), exhaustMat);
  exhaust.position.set(0.55, 0.42, -bodyLen / 2 - 0.1);
  exhaust.visible = false;
  g.add(exhaust);
  g.userData.exhaustTip = exhaust;
  // Headlights and taillights in 3D housings on the nose (+Z) and rear
  // (-Z): a dark housing box with the bright lens on its outer face.
  const tailMats = [];
  const lightZ = isBus ? 3.82 : longBody ? 2.72 : 2.22;
  for (const x of [-0.6, 0.6]) {
    const hh = new THREE.Mesh(box(0.38, 0.2, 0.2), darkMat);
    hh.position.set(x, 0.6, lightZ + 0.02);
    g.add(hh);
    const h = new THREE.Mesh(box(0.3, 0.13, 0.06), headLensMat);
    h.position.set(x, 0.6, lightZ + 0.13);
    g.add(h);
    const th = new THREE.Mesh(box(0.38, 0.2, 0.2), darkMat);
    th.position.set(x, 0.6, -lightZ - 0.02);
    g.add(th);
    const tm = new THREE.MeshBasicMaterial({ color: 0x8a1616 });
    const t = new THREE.Mesh(box(0.3, 0.13, 0.06), tm);
    t.position.set(x, 0.6, -lightZ - 0.13);
    g.add(t);
    tailMats.push(tm);
  }
  g.userData.tailMats = tailMats;
  const carGlow = lightGlowMats();
  for (const x of [-0.6, 0.6]) {
    const hs = new THREE.Sprite(carGlow.headGlowMat);
    hs.position.set(x, 0.6, lightZ + 0.15);
    hs.scale.setScalar(1.8);
    g.add(hs);
  }
  const ts = new THREE.Sprite(carGlow.tailGlowMat);
  ts.position.set(0, 0.6, -lightZ - 0.15);
  ts.scale.setScalar(1.6);
  g.add(ts);
  // Dynamic SpotLights for real headlight illumination (controlled by Game).
  const spotLeft = new THREE.SpotLight(0xffe9a8, 0, 30, Math.PI / 6, 0.3, 0.5);
  spotLeft.position.set(-0.6, 0.7, lightZ + 0.1);
  spotLeft.target.position.set(-0.6, 0, lightZ + 20);
  spotLeft.castShadow = false; // Only player car casts shadows for performance
  const spotRight = new THREE.SpotLight(0xffe9a8, 0, 30, Math.PI / 6, 0.3, 0.5);
  spotRight.position.set(0.6, 0.7, lightZ + 0.1);
  spotRight.target.position.set(0.6, 0, lightZ + 20);
  spotRight.castShadow = false;
  g.add(spotLeft, spotLeft.target, spotRight, spotRight.target);
  g.userData.headlightSpots = [spotLeft, spotRight];
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
    const sign = new THREE.Mesh(box(0.7, 0.22, 0.3), headLensMat);
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
    this.maxHealth = 100;
    this.health = 100;
    this.smoking = false;
    this.dead = false;
    this.hopT = 0; // stunt-jump air time: 0 = on the ground
    this.kind = 'traffic';
    this.driver = null; // 'player' when the player sits in it
    this.ai = null; // traffic / police brain state
    // Effective performance: the base def plus garage upgrades. Traffic
    // never buys upgrades, so these start identical to the def.
    this.upgrades = { armor: 0, engine: 0, tires: 0 };
    this.eff = {
      topSpeed: this.def.topSpeed,
      accel: this.def.accel,
      brake: this.def.brake,
      handling: this.def.handling,
    };
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = heading;
  }

  get length() { return this.mesh.userData.length; }

  // Apply garage upgrades: recompute effective performance and show the
  // visible parts (roof plate, wide wheels, exhaust glow). `u` is the
  // save's { armor, engine, tires } level map, each 0..2.
  applyUpgrades(u) {
    this.upgrades = { armor: u.armor || 0, engine: u.engine || 0, tires: u.tires || 0 };
    this.eff.topSpeed = this.def.topSpeed + UPGRADES.engine.topSpeedBonus * this.upgrades.engine;
    this.eff.accel = this.def.accel + UPGRADES.engine.accelBonus * this.upgrades.engine;
    this.eff.brake = this.def.brake;
    this.eff.handling = clamp(this.def.handling + UPGRADES.tires.handlingBonus * this.upgrades.tires, 0, 1);
    const newMax = 100 + UPGRADES.armor.healthBonus * this.upgrades.armor;
    const ratio = this.maxHealth > 0 ? this.health / this.maxHealth : 1;
    this.maxHealth = newMax;
    this.health = Math.round(newMax * ratio);
    this.smoking = this.health <= this.maxHealth * 0.3;
    const ud = this.mesh.userData;
    if (ud.armorPlate) ud.armorPlate.visible = this.upgrades.armor > 0;
    if (ud.exhaustTip) ud.exhaustTip.visible = this.upgrades.engine > 0;
    if (ud.wheels) {
      // Wide tyres widen the tyre along its axle (local Y). The old
      // scale.x stretched the wheel taller instead — an oval tyre.
      const wide = this.upgrades.tires > 0 ? 1.35 : 1;
      for (const w of ud.wheels) w.scale.y = wide;
    }
  }

  // Brake lights: bright red while braking, dim red otherwise.
  brakeLight(on) {
    const mats = this.mesh.userData.tailMats;
    if (!mats) return;
    for (const m of mats) m.color.setHex(on ? 0xff2a2a : 0x8a1616);
  }

  // Arcade step: throttle -1..1, steer -1..1. Collides with buildings.
  drive(dt, throttle, steerInput, colliders) {
    const eff = this.eff;
    const target = throttle * (throttle >= 0 ? eff.topSpeed : eff.topSpeed * 0.32);
    const rate = throttle >= 0 ? eff.accel : eff.brake;
    if (throttle !== 0) {
      this.speed += clamp(target - this.speed, -rate * dt, rate * dt);
    } else {
      this.speed = Math.abs(this.speed) < 0.2 ? 0 : this.speed - Math.sign(this.speed) * 8 * dt;
    }
    const speedNorm = clamp(Math.abs(this.speed) / eff.topSpeed, 0, 1);
    this.steer = steerInput * (0.55 + 0.45 * (1 - speedNorm));
    // Heading decreases when steering right (D): forward is (sin h, cos h),
    // so turning right from south swings the nose toward the west.
    // Handling scales the turn rate: grippier cars turn sharper.
    const turn = this.steer * (1.9 - speedNorm * 0.9) * (0.8 + eff.handling * 0.4) * Math.sign(this.speed || 1) * dt;
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
    // Spin the wheels around their axles: a rolling wheel's top moves
    // forward, so rotation.x grows with distance over the tyre radius.
    const ud = this.mesh.userData;
    if (ud.wheels) {
      const spin = (this.speed * dt) / 0.36;
      for (const w of ud.wheels) w.rotation.x += spin;
    }
    if (this.hopT > 0) this.hopT = Math.max(0, this.hopT - dt);
  }

  syncMesh() {
    this.mesh.position.copy(this.pos);
    // Stunt-jump hop: a scripted parabola on the mesh only — the logical
    // pos stays on the ground, so colliders never see the car airborne.
    if (this.hopT > 0) this.mesh.position.y += Math.sin((1 - this.hopT / 0.9) * Math.PI) * 2.2;
    this.mesh.rotation.y = this.heading;
    // Lean into the turn, like a car body does. A bike leans hard — seven
    // times the car lean — so a weaving Moto reads as a bike, not a car.
    const lean = this.defKey === 'moto' ? 0.35 : 0.05;
    this.mesh.rotation.z = -this.steer * clamp(Math.abs(this.speed) / 20, 0, 1) * lean;
  }

  // Update dynamic headlight SpotLights: position, target, and intensity.
  // Called by Game.update with the current time-of-day (0..1) and whether
  // this car is the player's driven car (for shadow casting).
  updateHeadlights(tod, isPlayerCar = false) {
    const spots = this.mesh.userData.headlightSpots;
    if (!spots) return;
    const night = tod > 0.75 || tod < 0.25;
    const intensity = night ? (isPlayerCar ? 2.5 : 1.2) : 0;
    for (const s of spots) {
      s.intensity = intensity;
      if (isPlayerCar) s.castShadow = night;
    }
  }

  damage(amount) {
    this.health -= amount;
    if (this.health <= this.maxHealth * 0.3 && !this.smoking) this.smoking = true;
    if (this.health <= 0 && !this.dead) { this.dead = true; return true; }
    return false;
  }

  repair() {
    this.health = this.maxHealth;
    this.smoking = false;
  }

  // Launch the scripted stunt-jump hop (0.9 s, peaks ~2.2 m).
  hop() { this.hopT = 0.9; }
}

// Boats: hull + cabin from primitives, no AI drivers ever (CR-1: a
// player-driven vehicle must never be AI-driven in the same frame).
// They float on the sea plane and clamp to the bay bounds, so they can
// neither leave the water nor beach onto land; pier/bridge rects are
// no-go for the hull. Same drive(dt, fwd, strafe, colliders) shape as
// Car so Game.update can drive either. Hull meshes share geometry and
// plain materials across boats — no textures, no shadows, no wake
// system — so the boats add no per-frame cost beyond a few dozen
// flops and zero allocation per frame.
const BOAT_NOGO = [
  { minX: 250, maxX: 298, minZ: -45, maxZ: -35 }, // pier
  { minX: 208, maxX: 322, minZ: -10, maxZ: 10 }, // bridge deck
];
const boatHullGeo = new THREE.BoxGeometry(2.2, 0.7, 5.6);
const boatBowGeo = new THREE.BoxGeometry(1.6, 0.6, 1.2);
const boatCabinGeo = new THREE.BoxGeometry(1.6, 0.9, 1.8);
const boatGlassGeo = new THREE.BoxGeometry(1.5, 0.45, 0.15);
const boatMotorGeo = new THREE.BoxGeometry(0.5, 0.7, 0.4);
const boatWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf2f0e8, roughness: 0.6 });
const boatDarkMat = new THREE.MeshStandardMaterial({ color: 0x1c2733, roughness: 0.4, metalness: 0.3 });
function makeBoatMesh(color) {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2 });
  const hull = new THREE.Mesh(boatHullGeo, hullMat); hull.position.y = 0.45; g.add(hull);
  const bow = new THREE.Mesh(boatBowGeo, hullMat); bow.position.set(0, 0.45, 2.7); bow.rotation.y = Math.PI / 4; g.add(bow);
  const cabin = new THREE.Mesh(boatCabinGeo, boatWhiteMat); cabin.position.set(0, 1.25, -0.4); g.add(cabin);
  const glass = new THREE.Mesh(boatGlassGeo, boatDarkMat); glass.position.set(0, 1.3, 0.55); glass.rotation.x = -0.3; g.add(glass);
  const motor = new THREE.Mesh(boatMotorGeo, boatDarkMat); motor.position.set(0, 0.5, -2.9); g.add(motor);
  g.userData.body = hull;
  return g;
}
export class Boat {
  constructor(color, x, z, heading) {
    this.kind = 'boat'; this.isBoat = true; this.color = color;
    this.pos = new THREE.Vector3(x, 0.1, z);
    this.heading = heading; this.speed = 0; this.steer = 0;
    this.topSpeed = 24; this.accel = 10;
    this.eff = { topSpeed: 24 }; this.def = this.eff;
    this.upgrades = { engine: 0, armor: 0, tires: 0 };
    this.dead = false; this.health = 1000; this.maxHealth = 1000;
    this.smoking = false; this.ai = null; this.driver = null;
    this.exploded = false; this.length = 7; this.width = 2.6;
    this.mesh = makeBoatMesh(color);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.heading;
  }
  drive(dt, fwd, strafe, _colliders) {
    if (fwd > 0) this.speed = Math.min(this.topSpeed, this.speed + this.accel * dt);
    else if (fwd < 0) this.speed = Math.max(-this.topSpeed * 0.35, this.speed - this.accel * 0.6 * dt);
    else this.speed -= this.speed * Math.min(1, 1.4 * dt); // water drag
    const sn = clamp(Math.abs(this.speed) / this.topSpeed, 0, 1);
    this.steer = strafe * (0.5 + 0.5 * (1 - sn));
    this.heading -= this.steer * (0.35 + 0.55 * sn) * Math.sign(this.speed || 1) * dt;
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += Math.cos(this.heading) * this.speed * dt;
    this.pos.x = clamp(this.pos.x, BOAT_BOUNDS.minX, BOAT_BOUNDS.maxX);
    this.pos.z = clamp(this.pos.z, BOAT_BOUNDS.minZ, BOAT_BOUNDS.maxZ);
    resolveCircleCollisions(BOAT_NOGO, this.pos, 2.2);
    this.pos.x = clamp(this.pos.x, BOAT_BOUNDS.minX, BOAT_BOUNDS.maxX);
    this.pos.z = clamp(this.pos.z, BOAT_BOUNDS.minZ, BOAT_BOUNDS.maxZ);
    this.syncMesh();
  }
  syncMesh() {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.heading;
    this.mesh.rotation.z = -this.steer * clamp(Math.abs(this.speed) / this.topSpeed, 0, 1) * 0.08;
  }
  brakeLight() {}
  updateHeadlights() {}
  applyUpgrades() {}
  damage(amount) {
    this.health -= amount;
    if (this.health <= this.maxHealth * 0.3 && !this.smoking) this.smoking = true;
    if (this.health <= 0 && !this.dead) { this.dead = true; return true; }
    return false;
  }
  repair() { this.health = this.maxHealth; this.smoking = false; }
}

// Traffic: cars cruise one road line, turn at intersections, brake ahead.
export class TrafficManager {
  constructor(scene, world, rng) {
    this.scene = scene;
    this.world = world;
    this.rng = rng;
    this.cars = [];
    // Bikes are common, buses rare — repeats weight the draw.
    this.keys = ['brisa', 'brisa', 'vento', 'vento', 'carguero', 'caminar', 'taxi', 'moto', 'moto', 'bus'];
    this.dwelling = []; // { car, stop } — buses stopped at a stop this frame
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
      const dir = this.rng() < 0.5 ? 1 : -1;
      // Spawn in the lane, 3.5 m right of the centre line for the heading,
      // with a touch of jitter so traffic doesn't look glued to the line.
      const lateral = (axis === 'x' ? -3.5 : 3.5) * dir + (this.rng() - 0.5) * 0.8;
      const x = axis === 'x' ? line + lateral : along;
      const z = axis === 'x' ? along : line + lateral;
      const heading = axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
      const car = new Car(key, color, x, z, heading);
      car.kind = 'traffic';
      // Bikes weave, buses crawl and stop at bus stops.
      const ai = { axis, dir, targetSpeed: 7 + this.rng() * 4, wait: 0 };
      if (key === 'moto') {
        ai.weave = true;
        ai.weavePhase = this.rng() * Math.PI * 2;
        ai.targetSpeed = 12 + this.rng() * 5;
      }
      if (key === 'bus') {
        ai.bus = true;
        ai.targetSpeed = 5 + this.rng() * 1.5;
        ai.dwell = 0;
        ai.stop = null;
        ai.lastStop = null;
        ai.boardedThisStop = false;
      }
      car.ai = ai;
      this.scene.add(car.mesh);
      this.cars.push(car);
    }
  }

  update(dt, playerPos, allCars, peds) {
    const lines = this.world.roads;
    this.dwelling = [];
    const gone = [];
    for (const car of this.cars) {
      // CR-1: a stolen car is driven by the player, not the AI — skip
      // every AI path for it (despawn, wait, bus dwell, lane snap,
      // junction turns, stuck-teleport) or the AI fights the player's
      // steering and can teleport the car with them still inside it.
      if (car.driver === 'player') continue;
      const ai = car.ai || (car.ai = { axis: 'x', dir: 1, targetSpeed: 8, wait: 0 });
      ai.age = (ai.age || 0) + dt;
      // Despawn: an old car far from the player leaves the scene instead
      // of driving on forever. The age gate keeps freshly staged cars
      // (screenshots, missions) alive; parked and mission cars are not
      // in this list, so they are never touched.
      if (playerPos && ai.age > 10 && dist2(car.pos.x, car.pos.z, playerPos.x, playerPos.z) > 150) {
        this.scene.remove(car.mesh);
        gone.push(car);
        continue;
      }
      if (car.dead) continue;
      if (ai.wait > 0) { ai.wait -= dt; car.drive(dt, 0, 0, this.world.colliders); continue; }
      if (ai.bus) {
        if (ai.dwell > 0) {
          ai.dwell -= dt;
          car.drive(dt, 0, 0, this.world.colliders);
          this.dwelling.push({ car, stop: ai.stop });
          continue;
        }
        const stop = this.nearestStop(car.pos);
        if (stop && stop !== ai.lastStop) {
          ai.dwell = 4;
          ai.stop = stop;
          ai.lastStop = stop;
          ai.boardedThisStop = false;
          car.drive(dt, 0, 0, this.world.colliders);
          this.dwelling.push({ car, stop });
          continue;
        }
        if (ai.lastStop && dist2(car.pos.x, car.pos.z, ai.lastStop.x, ai.lastStop.z) > 30) ai.lastStop = null;
      }
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
      // A ped crossing the road ahead? Brake for them as well — traffic
      // used to drive straight through pedestrians.
      if (peds && !blocked) {
        for (const ped of peds) {
          if (ped.dead) continue;
          const dx = ped.pos.x - car.pos.x, dz = ped.pos.z - car.pos.z;
          if (dx * dx + dz * dz > 144) continue;
          const ahead = dx * Math.sin(car.heading) + dz * Math.cos(car.heading);
          const side = Math.abs(dx * Math.cos(car.heading) - dz * Math.sin(car.heading));
          if (ahead > 0 && ahead < 8 && side < 2.4) { blocked = true; break; }
        }
      }
      const throttle = blocked ? 0 : (car.speed < ai.targetSpeed ? 0.6 : 0.1);
      let steer = 0;
      if (ai.weave) {
        ai.weavePhase += dt * 1.4;
        steer = Math.sin(ai.weavePhase) * 0.45;
      }
      car.drive(dt, throttle, steer, this.world.colliders);
      // Lane discipline: 3.5 m to the right of the centre line, so
      // oncoming cars pass on the left instead of meeting head-on in the
      // middle, braking, overlapping, and being shoved back and forth
      // by the separation pass (the v6 oscillation: cars gaining ~7 m
      // then losing it, every couple of seconds).
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      if (Math.abs(fz) >= Math.abs(fx)) {
        const laneX = nearestRoadCoord(car.pos.x) + 3.5 * Math.sign(fz);
        car.pos.x += (laneX - car.pos.x) * Math.min(1, dt * 8);
      } else {
        const laneZ = nearestRoadCoord(car.pos.z) - 3.5 * Math.sign(fx);
        car.pos.z += (laneZ - car.pos.z) * Math.min(1, dt * 8);
      }
      // At an intersection, sometimes turn onto the crossing road — but
      // only at a real intersection: the along-road coordinate on a line
      // and the car in its lane (3.5 m off the crossing line). Turning
      // mid-block sent cars through houses, where they wedged against
      // a wall forever at full speed.
      const alongX = Math.abs(fx) > Math.abs(fz);
      const along = alongX ? car.pos.x : car.pos.z;
      const cross = alongX ? car.pos.z : car.pos.x;
      const atJunction = Math.abs(along - nearestRoadCoord(along)) < 1.2 && Math.abs(cross - nearestRoadCoord(cross)) < 4.5;
      if (atJunction && this.rng() < dt * 0.25) {
        if (alongX) car.pos.x = nearestRoadCoord(car.pos.x);
        else car.pos.z = nearestRoadCoord(car.pos.z);
        const turn = this.rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
        ai.axis = ai.axis === 'x' ? 'z' : 'x';
        ai.dir = 1;
        car.heading += turn;
        if (this.rng() < 0.35) ai.wait = 1 + this.rng() * 2;
      }
      // Wedged anyway (shoved off the road by a crash)? Snap back to the
      // nearest intersection instead of grinding against a wall forever.
      // px/pz start as the car's own spot — without that, the ?? fallback
      // compares the car to itself, stuck grows on every frame even at
      // full speed, and the car teleports back to an intersection every
      // 2 s (the v6 ping-pong).
      if (ai.wait <= 0 && !(ai.dwell > 0)) {
        if (ai.px === undefined) { ai.px = car.pos.x; ai.pz = car.pos.z; }
        if (Math.abs(car.pos.x - ai.px) < 0.02 && Math.abs(car.pos.z - ai.pz) < 0.02) {
          ai.stuck = (ai.stuck || 0) + dt;
        } else {
          ai.stuck = 0;
          ai.px = car.pos.x;
          ai.pz = car.pos.z;
        }
        if (ai.stuck > 2 && Math.abs(car.speed) > 2) {
          car.pos.x = nearestRoadCoord(car.pos.x);
          car.pos.z = nearestRoadCoord(car.pos.z);
          car.heading = Math.round(car.heading / (Math.PI / 2)) * (Math.PI / 2);
          car.speed *= 0.5;
          ai.stuck = 0;
        }
        // Deadlock: two cars stopped nose-to-nose in one lane, neither
        // moving, neither fast enough for the recovery above. After 8 s
        // of standing still, move this one to the nearest intersection
        // so traffic flows again.
        if (ai.stuck > 8) {
          car.pos.x = nearestRoadCoord(car.pos.x);
          car.pos.z = nearestRoadCoord(car.pos.z);
          car.heading = Math.round(car.heading / (Math.PI / 2)) * (Math.PI / 2);
          ai.stuck = 0;
        }
      }
      // At the city edge, turn back in instead of teleporting to ±200.
      if (Math.abs(car.pos.x) > 225 || Math.abs(car.pos.z) > 225) {
        car.heading += Math.PI;
        ai.dir = -ai.dir;
      }
    }
    // No two traffic cars share the same space: push overlapping pairs
    // apart along the line between them (length-aware, see carsOverlap).
    // CR-1: the player's stolen car is not shoved by this pass either.
    const live = this.cars.filter((c) => !c.dead && c.driver !== 'player');
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        const pen = carsOverlap(a, b);
        if (pen > 0) {
          const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
          const d = Math.hypot(dx, dz);
          const nx = d > 0.01 ? dx / d : 1, nz = d > 0.01 ? dz / d : 0;
          a.pos.x -= nx * pen / 2; a.pos.z -= nz * pen / 2;
          b.pos.x += nx * pen / 2; b.pos.z += nz * pen / 2;
          a.syncMesh(); b.syncMesh();
        }
      }
    }
    if (gone.length > 0) this.cars = this.cars.filter((c) => !gone.includes(c));
  }

  // The closest bus stop to a point, within 4.5 m — a bus in its lane
  // passes 3.5 m off the stop point (the lane is right of the line), so
  // the old 3.5 m never fired; 4.5 catches it within ~2.8 m along the
  // road of the stop.
  nearestStop(pos) {
    const stops = this.world.busStops || [];
    let best = null, bd = Infinity;
    for (const s of stops) {
      const d = dist2(pos.x, pos.z, s.x, s.z);
      if (d < bd) { bd = d; best = s; }
    }
    return bd < 4.5 ? best : null;
  }

  // Staging helper: put a bus dwelling at a stop, for screenshots and
  // tests. `dwellSeconds` keeps it parked through the capture, and
  // boardedThisStop starts true so the staged waiters stay standing.
  spawnBusAt(stop, dwellSeconds = 6) {
    const car = new Car('bus', 0x2e7d6b, stop.x, stop.z, Math.PI / 2);
    car.kind = 'traffic';
    car.ai = { axis: 'x', dir: 1, targetSpeed: 6, wait: 0, bus: true, dwell: dwellSeconds, stop, lastStop: stop, boardedThisStop: true };
    this.scene.add(car.mesh);
    this.cars.push(car);
    return car;
  }
}

// --- Police ---
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
    // Roadblocks: parked units + a striped barrier, set across the road
    // ahead of the player at four stars and up. Kept separate from
    // this.cars so they never chase and never count toward the wanted cap.
    this.blockers = [];
    this.barrierMat = new THREE.MeshLambertMaterial({ map: barrierTexture() });
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

  // All cars parked at roadblocks, for collision and minimap.
  blockerCars() {
    const out = [];
    for (const b of this.blockers) out.push(...b.cars);
    return out;
  }

  // One roadblock across the road ahead of the player: a striped barrier
  // plus two parked interceptors flanking it. `dist` is how far ahead.
  spawnRoadblock(playerPos, playerHeading, dist = 45) {
    const fx = Math.sin(playerHeading), fz = Math.cos(playerHeading);
    let ax = playerPos.x + fx * dist;
    let az = playerPos.z + fz * dist;
    // Snap the block to the nearest intersection on the road ahead.
    if (Math.abs(fx) > Math.abs(fz)) az = nearestRoadCoord(az);
    else ax = nearestRoadCoord(ax);
    ax = clamp(ax, -195, 195);
    az = clamp(az, -195, 195);
    // Don't stack two blocks on the same spot.
    for (const b of this.blockers) {
      if (dist2(ax, az, b.x, b.z) < 40) return null;
    }
    const group = new THREE.Group();
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(12, 1.2, 0.5), this.barrierMat);
    barrier.position.y = 0.9;
    barrier.castShadow = true;
    group.add(barrier);
    const legGeo = new THREE.BoxGeometry(0.4, 0.9, 0.8);
    const legMat = new THREE.MeshLambertMaterial({ color: 0x2a2d33 });
    for (const lx of [-5, 5]) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(lx, 0.45, 0);
      group.add(leg);
    }
    group.position.set(ax, 0, az);
    group.rotation.y = playerHeading;
    this.scene.add(group);
    // Two parked interceptors, nose across the road, one on each side.
    const perpX = Math.cos(playerHeading), perpZ = -Math.sin(playerHeading);
    const cars = [];
    for (const s of [-4.6, 4.6]) {
      const car = new Car('police', CAR_COLORS.police, ax + perpX * s, az + perpZ * s, playerHeading + Math.PI / 2);
      car.kind = 'police';
      car.ai = { blocker: true };
      this.scene.add(car.mesh);
      cars.push(car);
    }
    // The barrier itself blocks cars and the player on foot.
    const alongX = Math.abs(fx) > Math.abs(fz);
    const collider = alongX
      ? { minX: ax - 1, maxX: ax + 1, minZ: az - 6.5, maxZ: az + 6.5 }
      : { minX: ax - 6.5, maxX: ax + 6.5, minZ: az - 1, maxZ: az + 1 };
    this.world.colliders.push(collider);
    const block = { x: ax, z: az, heading: playerHeading, group, cars, collider };
    this.blockers.push(block);
    return block;
  }

  clearRoadblocks() {
    for (const b of this.blockers) {
      this.scene.remove(b.group);
      for (const car of b.cars) this.scene.remove(car.mesh);
      const i = this.world.colliders.indexOf(b.collider);
      if (i >= 0) this.world.colliders.splice(i, 1);
    }
    this.blockers = [];
  }

  ensureRoadblocks(wanted, playerPos, playerHeading) {
    if (wanted >= ROADBLOCK_MIN_WANTED) {
      if (this.blockers.length < ROADBLOCK_COUNT) {
        // First block 45m ahead, the second 100m ahead — far enough apart
        // that the proximity check inside spawnRoadblock never refuses it.
        this.spawnRoadblock(playerPos, playerHeading, this.blockers.length === 0 ? 45 : 100);
      }
    } else if (this.blockers.length > 0) {
      this.clearRoadblocks();
    }
  }

  update(dt, wanted, playerPos, playerInCar, allCars, playerHeading = 0) {
    const want = this.wantedToCount(wanted);
    // Roadblocks come first: they are not counted in `want`.
    this.ensureRoadblocks(wanted, playerPos, playerHeading);
    // Spawn / despawn to match the wanted level (one new unit per 2.5s).
    // CR-1: only AI-driven units count toward the wanted cap — a stolen
    // interceptor the player is driving must never be popped when the
    // heat drops, and must not block fresh spawns while it is held.
    const aiCars = this.cars.filter((c) => c.driver !== 'player');
    this.spawnTimer -= dt;
    if (aiCars.length < want && this.spawnTimer <= 0) {
      this.spawnTimer = 2.5;
      this.spawnOne(playerPos);
    }
    while (aiCars.length > want) {
      const c = aiCars.pop();
      const i = this.cars.indexOf(c);
      if (i >= 0) this.cars.splice(i, 1);
      this.scene.remove(c.mesh);
    }
    // Chase: steer at the player's predicted position, ram on contact.
    // The Grand Prix rivals steer the same way (see raceDrive in
    // missions.js): same angleDiff, same 1.6 gain, same sign.
    for (const car of this.cars) {
      if (car.dead) continue;
      // CR-1: a stolen interceptor is driven by the player, not chased
      // by its own AI.
      if (car.driver === 'player') continue;
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
    const flashCars = [...this.cars, ...this.blockerCars()];
    for (const car of flashCars) {
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
    for (const c of [...this.cars, ...this.blockerCars()]) {
      if (c.dead) continue;
      best = Math.min(best, dist2(c.pos.x, c.pos.z, playerPos.x, playerPos.z));
    }
    return best;
  }
}
