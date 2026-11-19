// BRISA BAY — realistic procedural pedestrians with detailed 3D models
// Walkers, joggers, groups, vendors, guards, beachgoers, gang muscle
import * as THREE from 'three';
import { clamp, mulberry32, pick, dist2 } from './utils.js';
import { resolveCircleCollisions } from './city.js';

// Material caches
const matCache = new Map();
function getMat(key, factory) {
  let m = matCache.get(key);
  if (!m) { m = factory(); matCache.set(key, m); }
  return m;
}

// Color palettes
const SHIRTS = [
  0xd94f43, 0x4a6fa5, 0xe8c84a, 0x5a7d5a, 0xd98ab0, 0x7a5aa0, 
  0xe8e2d0, 0x3a3a3a, 0xff6b6b, 0x4ecdc4, 0xffe66d, 0x95e1d3,
  0xf38181, 0xaa96da, 0xfcbad3, 0xa8d8ea, 0xcd84f1, 0xffd34d
];
const SKINS = [0xc98d64, 0x8a5a3b, 0xe8b88a, 0x6b4226, 0xf0c8a0, 0x5a3a2a];
const PANTS_COLOURS = [0x2b3a55, 0x3a3a3a, 0x5a4a38, 0x1a1a2e, 0x4a4a5a, 0x2e3a2e];
const HAIR_COLORS = [0x1a1210, 0x3a2a1a, 0x5a4a38, 0x8a5a3b, 0x2b2b2b, 0xe8e2d0, 0x6b4226, 0x3a261a];
const HAT_COLORS = [0xd21f2b, 0xf2c230, 0x2e7d6b, 0x2b3a55, 0xe8e2d0, 0x4a6fa5, 0x8a5a3b, 0x1a1a1a];
const SHOE_COLORS = [0x1a1a1a, 0x2a2a2a, 0x3a3a3a, 0x8a5a3b, 0xe8e2d0];

// Gang colors
const GANG_COLORS = {
  'Red Vipers': 0xc94f43,
  'Blue Syndicate': 0x4a6fa5,
  'Green Cartel': 0x2e7d6b,
  'Gold Coast': 0xf2c230
};

// Body type variations
const BODY_TYPES = [
  { name: 'average', h: 1.0, chestW: 0.55, hipW: 0.5, legL: 0.65, armL: 0.62 },
  { name: 'tall', h: 1.15, chestW: 0.52, hipW: 0.48, legL: 0.75, armL: 0.7 },
  { name: 'short', h: 0.88, chestW: 0.58, hipW: 0.52, legL: 0.55, armL: 0.55 },
  { name: 'heavy', h: 1.0, chestW: 0.65, hipW: 0.6, legL: 0.6, armL: 0.58 },
  { name: 'athletic', h: 1.05, chestW: 0.58, hipW: 0.45, legL: 0.68, armL: 0.65 }
];

// Outfit archetypes
const OUTFITS = {
  casual: { shirtMat: 'cloth', pantsType: 'jeans', shoes: 'sneakers', hatChance: 0.2 },
  business: { shirtMat: 'shirt', pantsType: 'slacks', shoes: 'dress', hatChance: 0.1 },
  beach: { shirtMat: 'tank', pantsType: 'shorts', shoes: 'none', hatChance: 0.4 },
  worker: { shirtMat: 'hi-vis', pantsType: 'cargo', shoes: 'boots', hatChance: 0.6 },
  tourist: { shirtMat: 'hawaiian', pantsType: 'shorts', shoes: 'sandals', hatChance: 0.5 },
  jogger: { shirtMat: 'tech', pantsType: 'leggings', shoes: 'running', hatChance: 0.3 },
  gang: { shirtMat: 'hoodie', pantsType: 'cargo', shoes: 'boots', hatChance: 0.4 },
  guard: { shirtMat: 'tactical', pantsType: 'tactical', shoes: 'boots', hatChance: 0.2 },
  vendor: { shirtMat: 'apron', pantsType: 'cargo', shoes: 'boots', hatChance: 0.8 },
  performer: { shirtMat: 'vest', pantsType: 'jeans', shoes: 'boots', hatChance: 0.3 }
};

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
    this.deadTimer = 0;
    this.age = 0;
    this.phase = Math.random() * 6;
    this.shootTimer = 0;
    this.groupLeader = opts.groupLeader || null;
    this.groupSide = opts.groupSide || 0;
    this.performer = opts.performer || null;
    this.stop = opts.stop || null;
    this.pauseTimer = 0;
    this.aggro = opts.aggro || 26;
    this.turf = opts.turf || null;
    this.armed = opts.armed || false;
    this.gang = opts.gang || null;
    this.targetPos = null;
    
    // Stuck detection
    this.lastPos = new THREE.Vector3(x, 0, z);
    this.stuckTimer = 0;
    
    // Deterministic RNG per ped
    const rng = mulberry32((x * 13 + z * 7 + Date.now()) | 0);
    
    // Pick body type
    const bodyType = pick(rng, BODY_TYPES);
    const scale = bodyType.h;
    
    // Colors
    const shirtColor = opts.shirt ?? pick(rng, SHIRTS);
    const skinColor = opts.skin ?? pick(rng, SKINS);
    const pantsColor = pick(rng, PANTS_COLOURS);
    const hairColor = pick(rng, HAIR_COLORS);
    const hatColor = pick(rng, HAT_COLORS);
    const shoeColor = this.role === 'jogger' ? 0xe8e2d0 : (this.role === 'beachgoer' ? null : pick(rng, SHOE_COLORS));
    
    // Outfit config
    const outfit = OUTFITS[this.role] || OUTFITS.casual;
    
    // Materials
    const shirtMat = getMat(`shirt_${shirtColor}`, () => new THREE.MeshStandardMaterial({ 
      color: shirtColor, roughness: 0.85, metalness: 0.05 
    }));
    const skinMat = getMat(`skin_${skinColor}`, () => new THREE.MeshStandardMaterial({ 
      color: skinColor, roughness: 0.7, metalness: 0.05 
    }));
    const pantsMat = getMat(`pants_${pantsColor}`, () => new THREE.MeshStandardMaterial({ 
      color: pantsColor, roughness: 0.9, metalness: 0.0 
    }));
    const hairMat = getMat(`hair_${hairColor}`, () => new THREE.MeshStandardMaterial({ 
      color: hairColor, roughness: 0.6, metalness: 0.05 
    }));
    const darkMat = getMat('dark', () => new THREE.MeshStandardMaterial({ 
      color: 0x1a1a1a, roughness: 0.6, metalness: 0.1 
    }));
    const shoeMat = shoeColor ? getMat(`shoe_${shoeColor}`, () => new THREE.MeshStandardMaterial({ 
      color: shoeColor, roughness: 0.8, metalness: 0.1 
    })) : null;
    const hatMat = getMat(`hat_${hatColor}`, () => new THREE.MeshStandardMaterial({ 
      color: hatColor, roughness: 0.7, metalness: 0.1 
    }));
    
    // Gang-specific colors
    if (this.gang && GANG_COLORS[this.gang.name]) {
      shirtMat.color.setHex(GANG_COLORS[this.gang.name]);
    }
    
    this.mesh = new THREE.Group();
    this.mesh.scale.setScalar(scale);
    
    // ========== LOWER BODY ==========
    // Hips / pelvis
    const hipsGeo = new THREE.BoxGeometry(0.48 * bodyType.hipW / 0.5, 0.25, 0.28);
    const hips = new THREE.Mesh(hipsGeo, pantsMat);
    hips.position.y = 0.78;
    hips.castShadow = true;
    hips.receiveShadow = true;
    this.mesh.add(hips);
    
    // Legs - upper thigh
    const thighGeo = new THREE.BoxGeometry(0.22, 0.38, 0.22);
    thighGeo.translate(0, -0.19, 0);
    const thighL = new THREE.Mesh(thighGeo, pantsMat);
    thighL.position.set(-0.15, 0.52, 0);
    thighL.castShadow = true;
    thighL.receiveShadow = true;
    
    const thighR = thighL.clone();
    thighR.position.x = 0.15;
    
    // Lower leg
    const shinGeo = new THREE.BoxGeometry(0.18, 0.38, 0.2);
    shinGeo.translate(0, -0.19, 0);
    const shinL = new THREE.Mesh(shinGeo, pantsMat);
    shinL.position.set(0, -0.38, 0.02);
    shinL.castShadow = true;
    shinL.receiveShadow = true;
    thighL.add(shinL);
    
    const shinR = shinL.clone();
    thighR.add(shinR);
    
    // Shoes
    if (shoeColor && shoeMat) {
      const shoeGeo = new THREE.BoxGeometry(0.22, 0.1, 0.32);
      for (const leg of [thighL, thighR]) {
        const shoe = new THREE.Mesh(shoeGeo, shoeMat);
        shoe.position.set(0, -0.58, 0.05);
        shoe.castShadow = true;
        leg.add(shoe);
      }
    }
    
    this.legs = [thighL, thighR];
    this.shins = [shinL, shinR];
    this.mesh.add(thighL, thighR);
    
    // ========== UPPER BODY ==========
    // Chest / torso
    const chestGeo = new THREE.BoxGeometry(0.52 * bodyType.chestW / 0.55, 0.48, 0.28);
    const chest = new THREE.Mesh(chestGeo, shirtMat);
    chest.position.y = 1.18;
    chest.castShadow = true;
    chest.receiveShadow = true;
    this.mesh.add(chest);
    
    // Shoulders
    const shoulderGeo = new THREE.BoxGeometry(0.62 * bodyType.chestW / 0.55, 0.12, 0.3);
    const shoulders = new THREE.Mesh(shoulderGeo, shirtMat);
    shoulders.position.y = 1.48;
    this.mesh.add(shoulders);
    
    // Arms - upper arm
    const upperArmGeo = new THREE.BoxGeometry(0.17, 0.32, 0.17);
    upperArmGeo.translate(0, -0.16, 0);
    const upperArmL = new THREE.Mesh(upperArmGeo, shirtMat);
    upperArmL.position.set(-0.38, 1.32, 0);
    upperArmL.castShadow = true;
    
    const upperArmR = upperArmL.clone();
    upperArmR.position.x = 0.38;
    
    // Forearms
    const forearmGeo = new THREE.BoxGeometry(0.15, 0.3, 0.15);
    forearmGeo.translate(0, -0.15, 0);
    const forearmL = new THREE.Mesh(forearmGeo, skinMat);
    forearmL.position.set(0, -0.32, 0);
    forearmL.castShadow = true;
    upperArmL.add(forearmL);
    
    const forearmR = forearmL.clone();
    upperArmR.add(forearmR);
    
    // Hands
    const handGeo = new THREE.BoxGeometry(0.14, 0.12, 0.14);
    for (const arm of [upperArmL, upperArmR]) {
      const hand = new THREE.Mesh(handGeo, skinMat);
      hand.position.set(0, -0.48, 0);
      hand.castShadow = true;
      arm.add(hand);
    }
    
    this.arms = [upperArmL, upperArmR];
    this.forearms = [forearmL, forearmR];
    this.mesh.add(upperArmL, upperArmR);
    
    // ========== HEAD ==========
    const headGeo = new THREE.BoxGeometry(0.38, 0.38, 0.36);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.y = 1.62;
    head.castShadow = true;
    head.receiveShadow = true;
    this.mesh.add(head);
    
    // Hair
    const hairGeo = new THREE.BoxGeometry(0.42, 0.14, 0.4);
    const hair = new THREE.Mesh(hairGeo, hairMat);
    hair.position.y = 1.85;
    hair.castShadow = true;
    this.mesh.add(hair);
    
    // Ears
    const earGeo = new THREE.BoxGeometry(0.06, 0.12, 0.03);
    for (const x of [-0.21, 0.21]) {
      const ear = new THREE.Mesh(earGeo, skinMat);
      ear.position.set(x, 1.62, 0);
      head.add(ear);
    }
    
    // Neck
    const neckGeo = new THREE.CylinderGeometry(0.1, 0.12, 0.15, 8);
    const neck = new THREE.Mesh(neckGeo, skinMat);
    neck.position.y = 1.45;
    this.mesh.add(neck);
    
    // ========== HAT / ACCESSORIES ==========
    const hatChance = outfit.hatChance;
    if (opts.hat !== false && rng() < hatChance) {
      const hatType = rng() < 0.5 ? 'cap' : 'bucket';
      if (hatType === 'cap') {
        const capGeo = new THREE.BoxGeometry(0.44, 0.12, 0.42);
        const cap = new THREE.Mesh(capGeo, hatMat);
        cap.position.y = 1.86;
        cap.castShadow = true;
        // Brim
        const brimGeo = new THREE.BoxGeometry(0.48, 0.03, 0.18);
        const brim = new THREE.Mesh(brimGeo, hatMat);
        brim.position.set(0, 1.82, 0.2);
        cap.add(brim);
        this.mesh.add(cap);
      } else {
        const bucketGeo = new THREE.CylinderGeometry(0.24, 0.2, 0.14, 16);
        const bucket = new THREE.Mesh(bucketGeo, hatMat);
        bucket.position.y = 1.88;
        bucket.castShadow = true;
        // Brim
        const brimGeo = new THREE.CylinderGeometry(0.3, 0.24, 0.03, 16);
        const brim = new THREE.Mesh(brimGeo, hatMat);
        brim.position.y = 0.085;
        bucket.add(brim);
        this.mesh.add(bucket);
      }
    }
    
    // Sunglasses (10% chance for non-gang, non-guard)
    if (this.role !== 'gang' && this.role !== 'guard' && rng() < 0.1) {
      const frameGeo = new THREE.BoxGeometry(0.3, 0.08, 0.02);
      const frames = new THREE.Mesh(frameGeo, darkMat);
      frames.position.set(0, 1.64, 0.19);
      head.add(frames);
      const lensMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
      for (const x of [-0.1, 0.1]) {
        const lens = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.01), lensMat);
        lens.position.set(x, 0, 0.01);
        frames.add(lens);
      }
    }
    
    // ========== ROLE-SPECIFIC ACCESSORIES ==========
    if (this.role === 'vendor') {
      // Tray with items
      const trayMat = getMat('tray', () => new THREE.MeshStandardMaterial({ color: 0xd8c8a8, roughness: 0.5 }));
      const tray = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.4), trayMat);
      tray.position.set(0, 1.3, 0.5);
      this.mesh.add(tray);
      
      // Items on tray
      for (let i = 0; i < 3; i++) {
        const item = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.12, 0.08),
          getMat(`item_${i}`, () => new THREE.MeshStandardMaterial({ 
            color: pick(rng, [0xff6b6b, 0x4ecdc4, 0xffe66d, 0xf2c230, 0x95e1d3]),
            roughness: 0.3, metalness: 0.2 
          }))
        );
        item.position.set(-0.15 + i * 0.15, 0.08, 0);
        tray.add(item);
      }
    }
    
    if (this.role === 'performer') {
      // Microphone
      const micMat = getMat('mic', () => new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.8, roughness: 0.2 }));
      const mic = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.25, 6), micMat);
      mic.position.set(0.25, 1.7, 0.3);
      this.mesh.add(mic);
      
      // Mic stand
      const stand = new THREE.Mesh(
        new THREE.CylinderGeometry(0.01, 0.01, 1.2, 6),
        micMat
      );
      stand.position.set(0.25, 0.6, 0.3);
      this.mesh.add(stand);
    }
    
    if (this.role === 'guard' || this.role === 'gang') {
      // Weapon holster
      const holsterMat = getMat('holster', () => new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 }));
      const holster = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.25, 0.08), holsterMat);
      holster.position.set(0.35, 1.0, -0.05);
      this.mesh.add(holster);
      
      // Radio on shoulder
      const radio = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.12, 0.04),
        darkMat
      );
      radio.position.set(-0.32, 1.45, 0.15);
      this.mesh.add(radio);
    }
    
    if (this.role === 'worker') {
      // Tool belt
      const belt = new THREE.Mesh(
        new THREE.TorusGeometry(0.28, 0.03, 8, 16),
        darkMat
      );
      belt.rotation.x = Math.PI / 2;
      belt.position.y = 0.95;
      this.mesh.add(belt);
    }
    
    if (this.role === 'tourist') {
      // Camera
      const cam = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.08, 0.06),
        darkMat
      );
      cam.position.set(0.2, 1.5, 0.3);
      this.mesh.add(cam);
      // Lens
      const lens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 0.03, 8),
        new THREE.MeshBasicMaterial({ color: 0x0a0a0a })
      );
      lens.rotation.x = Math.PI / 2;
      lens.position.set(0.2, 1.5, 0.35);
      this.mesh.add(lens);
    }
    
    if (this.role === 'jogger') {
      // Earbuds
      for (const x of [-0.21, 0.21]) {
        const bud = new THREE.Mesh(
          new THREE.SphereGeometry(0.025, 6, 6),
          darkMat
        );
        bud.position.set(x, 1.62, 0);
        head.add(bud);
      }
      // Water bottle on hip
      const bottle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.2, 8),
        getMat('bottle', () => new THREE.MeshPhysicalMaterial({ 
          color: 0x4ecdc4, roughness: 0.1, metalness: 0.0, transmission: 0.3, thickness: 0.1 
        }))
      );
      bottle.position.set(-0.32, 0.9, 0.15);
      this.mesh.add(bottle);
    }
    
    // Backpack for some roles
    if (['walker', 'tourist', 'student'].includes(this.role) && rng() < 0.2) {
      const pack = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.4, 0.15),
        pantsMat
      );
      pack.position.set(0, 1.2, -0.25);
      pack.castShadow = true;
      this.mesh.add(pack);
      
      // Straps
      for (const x of [-0.12, 0.12]) {
        const strap = new THREE.Mesh(
          new THREE.BoxGeometry(0.02, 0.5, 0.02),
          darkMat
        );
        strap.position.set(x, 1.0, -0.15);
        pack.add(strap);
      }
    }
    
    this.mesh.position.copy(this.pos);
    scene.add(this.mesh);
  }
  
  update(dt, world, danger) {
    if (this.dead) return;
    this.age += dt;
    
    // Stuck detection
    const moved = this.pos.distanceTo(this.lastPos);
    if (moved < 0.1) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 3) {
        this.heading += Math.PI + (Math.random() - 0.5) * 1.0;
        this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = 0;
    }
    this.lastPos.copy(this.pos);
    
    // Flee danger zone
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
      const d = dist2(this.pos.x, this.pos.z, this.targetPos.x, this.targetPos.z);
      if (d < this.aggro) {
        this.heading = Math.atan2(this.targetPos.x - this.pos.x, this.targetPos.z - this.pos.z);
        this.speed = 4.2;
      } else {
        if (Math.random() < dt * 0.15) this.heading += (Math.random() - 0.5) * 1.6;
        this.speed = this.walkSpeed;
        if (this.turf && (this.pos.x < this.turf.x0 || this.pos.x > this.turf.x1 || this.pos.z < this.turf.z0 || this.pos.z > this.turf.z1)) {
          this.heading = Math.atan2(this.turf.hx - this.pos.x, this.turf.hz - this.pos.z);
        }
      }
    } else if (this.hostile) {
      this.speed = 0;
      this.phase += dt * 2;
      this.pos.x += Math.sin(this.phase) * 0.15 * dt;
    } else if (['waiter', 'vendor', 'performer'].includes(this.role)) {
      this.speed = 0;
      this.phase += dt * 1.5;
      this.pos.x += Math.sin(this.phase) * 0.08 * dt;
    } else if (this.role === 'watcher') {
      if (this.performer && !this.performer.dead) {
        this.speed = 0;
        this.heading = Math.atan2(this.performer.pos.x - this.pos.x, this.performer.pos.z - this.pos.z);
        this.phase += dt * 1.5;
      } else {
        if (Math.random() < dt * 0.15) this.heading += (Math.random() - 0.5) * 1.6;
        this.speed = this.walkSpeed;
      }
    } else if (this.role === 'group' && this.groupLeader && !this.groupLeader.dead) {
      const l = this.groupLeader;
      this.heading = l.heading;
      this.speed = l.speed;
      const bx = l.pos.x - Math.sin(l.heading) * 1.1 + Math.cos(l.heading) * (this.groupSide || 0);
      const bz = l.pos.z - Math.cos(l.heading) * 1.1 - Math.sin(l.heading) * (this.groupSide || 0);
      this.pos.x += (bx - this.pos.x) * Math.min(1, dt * 3);
      this.pos.z += (bz - this.pos.z) * Math.min(1, dt * 3);
    } else if (this.role === 'jogger') {
      if (Math.random() < dt * 0.08) this.heading += (Math.random() - 0.5) * 1.0;
      this.speed = this.walkSpeed * 2.4;
    } else if (this.role === 'beachgoer') {
      if (this.pauseTimer > 0) {
        this.pauseTimer -= dt;
        this.speed = 0;
      } else {
        if (Math.random() < dt * 0.15) this.heading += (Math.random() - 0.5) * 1.6;
        this.speed = this.walkSpeed * 0.7;
        if (Math.random() < dt * 0.05) this.pauseTimer = 3 + Math.random() * 4;
      }
    } else {
      if (Math.random() < dt * 0.15) this.heading += (Math.random() - 0.5) * 1.6;
      this.speed = this.walkSpeed;
    }
    
    // Sidewalk following
    const lines = world.roads;
    let nearestRoadDist = Infinity;
    for (const l of lines) {
      const d = Math.abs(this.pos.x - l);
      if (d < nearestRoadDist) nearestRoadDist = d;
      const d2 = Math.abs(this.pos.z - l);
      if (d2 < nearestRoadDist) nearestRoadDist = d2;
    }
    if (nearestRoadDist < 6 && this.speed > 0) {
      for (const l of lines) {
        const dx = Math.abs(this.pos.x - l);
        const dz = Math.abs(this.pos.z - l);
        if (dx < 6) this.pos.x = l + (this.pos.x > l ? 9 : -9);
        if (dz < 6) this.pos.z = l + (this.pos.z > l ? 9 : -9);
      }
    }
    
    // Move
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += Math.cos(this.heading) * this.speed * dt;
    resolveCircleCollisions(world.colliders, this.pos, 0.5);
    this.pos.x = clamp(this.pos.x, -210, 250);
    this.pos.z = clamp(this.pos.z, -210, 210);
    
    // Walk-cycle swing
    const swing = Math.sin(this.phase + dt * this.speed * 4) * 0.4 * clamp(this.speed / 2, 0, 1);
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.shins[0].rotation.x = -swing * 0.5;
    this.shins[1].rotation.x = swing * 0.5;
    if (this.arms) {
      this.arms[0].rotation.x = -swing * 0.7;
      this.arms[1].rotation.x = swing * 0.7;
      this.forearms[0].rotation.x = swing * 0.3;
      this.forearms[1].rotation.x = -swing * 0.3;
    }
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.heading;
    this.phase += dt * this.speed * 2;
  }
  
  hit(damage, fromX, fromZ) {
    this.health -= damage;
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
  
  spawn(count, center, radius) {
    const lines = this.world.roads;
    const onBeach = center.x > 205;
    const roles = ['walker', 'walker', 'walker', 'jogger', 'walker', 'walker'];
    for (let i = 0; i < count; i++) {
      if (onBeach) {
        const x = 214 + Math.random() * 30;
        const z = center.z + (Math.random() * 2 - 1) * radius;
        const beachRoles = ['beachgoer', 'beachgoer', 'beachgoer', 'jogger', 'vendor'];
        const role = pick(mulberry32(i * 977 + 13), beachRoles);
        this.peds.push(new Ped(this.scene, x, z, { role }));
        continue;
      }
      const line = pick(mulberry32(i * 977 + 13), lines);
      const along = (Math.random() * 2 - 1) * radius + center.z;
      const onXRoad = Math.random() < 0.5;
      const x = onXRoad ? line + 9 + (Math.random() - 0.5) * 2 : along + (Math.random() - 0.5) * 2;
      const z = onXRoad ? along + (Math.random() - 0.5) * 2 : line + 9 + (Math.random() - 0.5) * 2;
      const role = pick(mulberry32(i * 977 + 13), roles);
      this.peds.push(new Ped(this.scene, x, z, { role }));
    }
  }
  
  spawnGuards(positions, health = 60) {
    const guards = [];
    for (const p of positions) {
      const g = new Ped(this.scene, p.x, p.z, { hostile: true, role: 'guard', health, shirt: 0x1d2733, hat: false });
      guards.push(g);
      this.peds.push(g);
    }
    return guards;
  }
  
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
  
  spawnWaiters(stop, count = 2) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const p = new Ped(this.scene, stop.waitX + (Math.random() - 0.5) * 2, stop.waitZ - 1.5 - i * 1.2, { role: 'waiter', stop });
      this.peds.push(p);
      out.push(p);
    }
    return out;
  }
  
  spawnVendors(spots) {
    const out = [];
    for (const s of spots) {
      const p = new Ped(this.scene, s.x, s.z + 2.2, { role: 'vendor', shirt: s.color, hat: false });
      p.heading = Math.atan2(-s.x, -s.z);
      this.peds.push(p);
      out.push(p);
    }
    return out;
  }
  
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
  
  waiters() {
    return this.peds.filter((p) => !p.dead && p.role === 'waiter');
  }
  
  update(dt, danger, playerPos = null) {
    for (const p of this.peds) {
      if (p.role === 'gang') p.targetPos = playerPos;
      p.update(dt, this.world, danger);
    }
    // Panic chain
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
    // Corpse cleanup
    for (const p of [...this.peds]) {
      if (p.dead) {
        p.deadTimer += dt;
        const far = playerPos ? dist2(p.pos.x, p.pos.z, playerPos.x, playerPos.z) > 120 : false;
        if (p.deadTimer > 25 || (far && p.deadTimer > 8)) this.remove(p);
      }
    }
    if (this.peds.length > 150) {
      this.peds = this.peds.filter((p) => !p.dead || Math.random() < 0.5);
    }
    const ambient = (r) => ['walker', 'jogger', 'beachgoer', 'vendor'].includes(r);
    if (playerPos) {
      for (const p of [...this.peds]) {
        if (!p.dead && ambient(p.role) && p.age > 20 && dist2(p.pos.x, p.pos.z, playerPos.x, playerPos.z) > 200) this.remove(p);
      }
    }
    // Separation
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