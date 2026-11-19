// BRISA BAY — realistic procedural vehicles (cars, trucks, bikes, bus)
// Detailed PBR meshes with interiors, proper proportions, LOD support
import * as THREE from 'three';
import { CAR_DEFS, UPGRADES, ROADBLOCK_MIN_WANTED, ROADBLOCK_COUNT } from './config.js';
import { clamp, angleDiff, dist2, pick, randomPointInCircle } from './utils.js';
import { nearestRoadCoord, resolveCircleCollisions } from './city.js';
import { barrierTexture, glowTexture, generateClearcoatNormal } from './textures.js';

const CAR_COLORS = { police: 0x1d2733 };

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

const boxCache = new Map();
function box(w, h, d) {
  const k = w + '|' + h + '|' + d;
  let g = boxCache.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); boxCache.set(k, g); }
  return g;
}

const cylCache = new Map();
function cylinder(r, h, seg = 16) {
  const k = r + '|' + h + '|' + seg;
  let g = cylCache.get(k);
  if (!g) { g = new THREE.CylinderGeometry(r, r, h, seg); cylCache.set(k, g); }
  return g;
}

const sphereCache = new Map();
function sphere(r, seg = 16) {
  const k = r + '|' + seg;
  let g = sphereCache.get(k);
  if (!g) { g = new THREE.SphereGeometry(r, seg, seg); sphereCache.set(k, g); }
  return g;
}

const bodyMats = new Map();
function bodyMat(colorHex, isChrome = false) {
  let m = bodyMats.get(colorHex + (isChrome ? '_chrome' : ''));
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: isChrome ? 0.05 : 0.3,
      metalness: isChrome ? 1.0 : 0.88,
      clearcoat: isChrome ? 0.0 : 0.6,
      clearcoatRoughness: 0.08,
      clearcoatNormalMap: generateClearcoatNormal(0),
      clearcoatNormalScale: new THREE.Vector2(0.5, 0.5),
    });
    bodyMats.set(colorHex + (isChrome ? '_chrome' : ''), m);
  }
  return m;
}

const darkMat = new THREE.MeshStandardMaterial({ color: 0x0f1114, roughness: 0.4, metalness: 0.3 });
const tireMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9, metalness: 0.05 });
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0x8ab8d0, roughness: 0.02, metalness: 0.0,
  transmission: 0.9, thickness: 0.8, ior: 1.52,
  clearcoat: 1.0, clearcoatRoughness: 0.01,
  side: THREE.DoubleSide
});
const glassInnerMat = new THREE.MeshPhysicalMaterial({
  color: 0x1a1f26, roughness: 0.1, metalness: 0.0,
  transmission: 0.8, thickness: 0.5, ior: 1.5,
  side: THREE.BackSide
});
const headLensMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8, side: THREE.FrontSide });
const headLensMatNight = new THREE.MeshBasicMaterial({ color: 0xffffee, transparent: true, opacity: 0.9, side: THREE.FrontSide });
const tailLensMat = new THREE.MeshBasicMaterial({ color: 0xff1a1a, side: THREE.FrontSide });
const amberLensMat = new THREE.MeshBasicMaterial({ color: 0xff8800, side: THREE.FrontSide });
const reverseLensMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.FrontSide });
const hubMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.2, metalness: 0.9 });
const hubMatBlack = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.15, metalness: 0.95 });
const hubMatChrome = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.02, metalness: 1.0 });
const brakeMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.3, metalness: 0.6 });
const grilleMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.3, metalness: 0.7 });
const grilleMatChrome = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.05, metalness: 1.0 });
const interiorMat = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.7, metalness: 0.1 });
const seatMat = new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.8, metalness: 0.0 });
const steeringMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.4, metalness: 0.5 });
const chromeMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.02, metalness: 1.0 });
const badgeMat = new THREE.MeshStandardMaterial({ color: 0xffd34d, roughness: 0.1, metalness: 0.8 });

let headGlowMat = null, tailGlowMat = null, amberGlowMat = null;
function lightGlowMats() {
  if (!headGlowMat) {
    const tex = glowTexture();
    headGlowMat = new THREE.SpriteMaterial({ map: tex, color: 0xffe9a8, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
    tailGlowMat = new THREE.SpriteMaterial({ map: tex, color: 0xff1a1a, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false });
    amberGlowMat = new THREE.SpriteMaterial({ map: tex, color: 0xff8800, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  }
  return { headGlowMat, tailGlowMat, amberGlowMat };
}

// Vehicle definitions with detailed proportions
const VEHICLE_PROPS = {
  // Sports coupe (Furia) - low, wide, aggressive
  furia: {
    w: 1.95, L: 4.75, track: 1.65, wheelbase: 2.75,
    hoodL: 1.8, trunkL: 0.5, cabZ: -0.55, cabL: 1.45, cabH: 0.38,
    roofH: 0.32, beltH: 0.85, greenhouseH: 0.6,
    frontOverhang: 0.9, rearOverhang: 0.75,
    wheelR: 0.35, wheelW: 0.28, rimR: 0.2, caliper: true,
    spoiler: true, diffuser: true, sideSkirt: true,
    lightBar: false, roofRack: false,
    class: 'super'
  },
  // Modern sedan (Brisa) - balanced proportions
  brisa: {
    w: 1.88, L: 4.65, track: 1.58, wheelbase: 2.72,
    hoodL: 1.3, trunkL: 0.95, cabZ: -0.15, cabL: 2.05, cabH: 0.55,
    roofH: 0.48, beltH: 0.9, greenhouseH: 0.65,
    frontOverhang: 0.92, rearOverhang: 0.85,
    wheelR: 0.34, wheelW: 0.25, rimR: 0.19, caliper: false,
    spoiler: false, diffuser: false, sideSkirt: false,
    lightBar: false, roofRack: false,
    class: 'sedan'
  },
  // Compact hatchback (Vento) - practical, upright
  vento: {
    w: 1.85, L: 4.35, track: 1.55, wheelbase: 2.6,
    hoodL: 1.1, trunkL: 0.5, cabZ: -0.05, cabL: 2.2, cabH: 0.58,
    roofH: 0.52, beltH: 0.95, greenhouseH: 0.7,
    frontOverhang: 0.8, rearOverhang: 0.65,
    wheelR: 0.32, wheelW: 0.22, rimR: 0.17, caliper: false,
    spoiler: false, diffuser: false, sideSkirt: false,
    lightBar: false, roofRack: true,
    class: 'hatchback'
  },
  // Van (Carguero) - boxy, high roof
  carguero: {
    w: 1.95, L: 5.3, track: 1.6, wheelbase: 3.2,
    hoodL: 0.9, trunkL: 0, cabZ: 1.2, cabL: 1.6, cabH: 0.6,
    roofH: 0.7, beltH: 1.1, greenhouseH: 0.8,
    frontOverhang: 0.85, rearOverhang: 1.1,
    wheelR: 0.36, wheelW: 0.26, rimR: 0.18, caliper: false,
    spoiler: false, diffuser: false, sideSkirt: false,
    lightBar: false, roofRack: true,
    class: 'van'
  },
  // Pickup truck (Caminar) - cab + bed
  caminar: {
    w: 2.0, L: 5.5, track: 1.65, wheelbase: 3.3,
    hoodL: 1.2, trunkL: 0, cabZ: 1.3, cabL: 1.5, cabH: 0.6,
    roofH: 0.55, beltH: 1.0, greenhouseH: 0.75,
    frontOverhang: 0.95, rearOverhang: 1.0,
    wheelR: 0.38, wheelW: 0.3, rimR: 0.2, caliper: false,
    spoiler: false, diffuser: false, sideSkirt: true,
    lightBar: false, roofRack: false,
    class: 'truck', bedLen: 1.8
  },
  // Taxi - based on sedan with roof sign
  taxi: {
    w: 1.88, L: 4.65, track: 1.58, wheelbase: 2.72,
    hoodL: 1.3, trunkL: 0.95, cabZ: -0.15, cabL: 2.05, cabH: 0.55,
    roofH: 0.48, beltH: 0.9, greenhouseH: 0.65,
    frontOverhang: 0.92, rearOverhang: 0.85,
    wheelR: 0.34, wheelW: 0.25, rimR: 0.19, caliper: false,
    spoiler: false, diffuser: false, sideSkirt: false,
    lightBar: false, roofRack: false, taxiSign: true,
    class: 'sedan'
  },
  // Police - based on sedan with light bar
  police: {
    w: 1.88, L: 4.65, track: 1.58, wheelbase: 2.72,
    hoodL: 1.3, trunkL: 0.95, cabZ: -0.15, cabL: 2.05, cabH: 0.55,
    roofH: 0.48, beltH: 0.9, greenhouseH: 0.65,
    frontOverhang: 0.92, rearOverhang: 0.85,
    wheelR: 0.34, wheelW: 0.25, rimR: 0.19, caliper: true,
    spoiler: false, diffuser: false, sideSkirt: false,
    lightBar: true, roofRack: false,
    class: 'sedan'
  },
  // Bus - long, tall
  bus: {
    w: 2.35, L: 11.5, track: 1.9, wheelbase: 6.0,
    hoodL: 0.6, trunkL: 0, cabZ: 0, cabL: 10.0, cabH: 0.7,
    roofH: 0.8, beltH: 1.2, greenhouseH: 1.0,
    frontOverhang: 2.0, rearOverhang: 2.5,
    wheelR: 0.45, wheelW: 0.35, rimR: 0.25, caliper: false,
    spoiler: false, diffuser: false, sideSkirt: false,
    lightBar: false, roofRack: false,
    class: 'bus'
  },
  // Motorcycle (Moto)
  moto: {
    w: 0.8, L: 2.15, track: 0, wheelbase: 1.45,
    wheelR: 0.33, wheelW: 0.16, rimR: 0.18,
    class: 'bike'
  }
};

// Color palettes per class
const CLASS_COLORS = {
  super: [0xf2c230, 0xff3a3a, 0x2b8aff, 0x3aff3a, 0xff8833, 0xaa33ff, 0x00ffff, 0xffffff, 0x1a1a1a, 0x8a0000],
  sedan: [0x3a4a6a, 0x5a5a5a, 0x6a4a3a, 0x2a5a4a, 0x5a3a5a, 0x8a7a5a, 0x3a3a3a, 0x9a9a9a, 0xcacaca, 0x1a1a1a],
  hatchback: [0xd94f43, 0x4a6fa5, 0xe8c84a, 0x5a7d5a, 0xd98ab0, 0x7a5aa0, 0xe8e2d0, 0x3a3a3a, 0xffd34d, 0x2e7d6b],
  van: [0xe8e2d0, 0xbfb49e, 0x3a4a5a, 0x5a5a5a, 0x2a5a4a, 0x8a7a5a, 0xd9c8a0],
  truck: [0x3a4a5a, 0x5a4a3a, 0x2a2a2a, 0x6a5a4a, 0x8a7a5a, 0x3a3a3a, 0x1a1a1a],
  bus: [0xf2a007, 0xd94f43, 0x2e7d6b, 0x4a6fa5],
  bike: [0x1a1a1a, 0xd94f43, 0x4a6fa5, 0xffd34d, 0x2e7d6b, 0xffffff, 0x8a0000]
};

export function makeCarMesh(defKey, colorHex) {
  const def = CAR_DEFS[defKey];
  const props = VEHICLE_PROPS[defKey];
  if (!props) return makeGenericCar(defKey, colorHex);
  
  const g = new THREE.Group();
  const bm = bodyMat(colorHex);
  const bmChrome = bodyMat(colorHex, true);
  
  const isBike = props.class === 'bike';
  const isBus = props.class === 'bus';
  const isTruck = props.class === 'truck';
  const isVan = props.class === 'van';
  const isSuper = props.class === 'super';
  
  const bodyLen = props.L;
  const halfLen = bodyLen / 2;
  
  // ========== BIKE ==========
  if (isBike) return makeBike(defKey, colorHex, props, bm);
  
  // ========== CHASSIS / UNDERBODY ==========
  const chassisGeo = new THREE.BoxGeometry(props.w - 0.1, 0.12, bodyLen - 0.2);
  const chassis = new THREE.Mesh(chassisGeo, darkMat);
  chassis.position.y = 0.1;
  chassis.castShadow = true;
  g.add(chassis);
  
  // ========== MAIN BODY ==========
  // Lower body (rocker panel area)
  const lowerBodyGeo = new THREE.BoxGeometry(props.w, 0.35, bodyLen - props.frontOverhang - props.rearOverhang);
  const lowerBody = new THREE.Mesh(lowerBodyGeo, bm);
  lowerBody.position.y = 0.4;
  lowerBody.castShadow = true;
  g.add(lowerBody);
  
  // Upper body (shoulders)
  const upperBodyGeo = new THREE.BoxGeometry(props.w - 0.08, 0.45, bodyLen - props.frontOverhang - props.rearOverhang);
  const upperBody = new THREE.Mesh(upperBodyGeo, bm);
  upperBody.position.y = 0.85;
  upperBody.castShadow = true;
  g.add(upperBody);
  
  // ========== HOOD ==========
  if (props.hoodL > 0) {
    const hoodGeo = new THREE.BoxGeometry(props.w - 0.12, 0.28, props.hoodL);
    const hood = new THREE.Mesh(hoodGeo, bm);
    hood.position.set(0, 0.65, halfLen - props.hoodL / 2 - props.frontOverhang / 2);
    hood.castShadow = true;
    g.add(hood);
    
    // Hood bulge for super cars
    if (isSuper) {
      const bulgeGeo = new THREE.BoxGeometry(0.6, 0.08, props.hoodL * 0.6);
      const bulge = new THREE.Mesh(bulgeGeo, bm);
      bulge.position.set(0, 0.8, halfLen - props.hoodL / 2 - props.frontOverhang / 2 + 0.1);
      bulge.castShadow = true;
      g.add(bulge);
    }
  }
  
  // ========== TRUNK / REAR DECK ==========
  if (props.trunkL > 0) {
    const trunkGeo = new THREE.BoxGeometry(props.w - 0.12, 0.32, props.trunkL);
    const trunk = new THREE.Mesh(trunkGeo, bm);
    trunk.position.set(0, 0.65, -halfLen + props.trunkL / 2 + props.rearOverhang / 2);
    trunk.castShadow = true;
    g.add(trunk);
    
    // Integrated spoiler lip
    const lipGeo = new THREE.BoxGeometry(props.w - 0.2, 0.06, props.w * 0.6);
    const lip = new THREE.Mesh(lipGeo, bm);
    lip.position.set(0, 0.95, -halfLen + 0.25);
    lip.castShadow = true;
    g.add(lip);
  }
  
  // ========== ROOF ==========
  const roofGeo = new THREE.BoxGeometry(props.w - 0.15, props.roofH, props.cabL + 0.3);
  const roof = new THREE.Mesh(roofGeo, bm);
  roof.position.set(0, props.beltH + props.roofH / 2 + 0.02, props.cabZ);
  roof.castShadow = true;
  g.add(roof);
  
  // Roof rack for van/hatchback
  if (props.roofRack) {
    const rackGeo = new THREE.BoxGeometry(props.w - 0.3, 0.08, props.cabL - 0.2);
    const rack = new THREE.Mesh(rackGeo, darkMat);
    rack.position.set(0, props.beltH + props.roofH + 0.06, props.cabZ);
    rack.castShadow = true;
    g.add(rack);
    
    // Cross bars
    for (let i = -1; i <= 1; i++) {
      const barGeo = new THREE.CylinderGeometry(0.025, 0.025, props.w - 0.25, 8);
      const bar = new THREE.Mesh(barGeo, hubMatBlack);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(0, props.beltH + props.roofH + 0.12, props.cabZ + i * (props.cabL / 3));
      g.add(bar);
    }
  }
  
  // ========== GREENHOUSE (CABIN) ==========
  // Glass panels - windshield
  const wsGeo = new THREE.BoxGeometry(props.w - 0.18, props.greenhouseH, 0.06);
  const windshield = new THREE.Mesh(wsGeo, glassMat);
  windshield.position.set(0, props.beltH + props.greenhouseH / 2 + 0.02, props.cabZ + props.cabL / 2 + 0.15);
  windshield.rotation.x = -0.48;
  windshield.castShadow = true;
  g.add(windshield);
  
  // Rear window
  const rwGeo = new THREE.BoxGeometry(props.w - 0.18, props.greenhouseH * 0.75, 0.06);
  const rearWindow = new THREE.Mesh(rwGeo, glassMat);
  rearWindow.position.set(0, props.beltH + props.greenhouseH * 0.4 + 0.02, props.cabZ - props.cabL / 2 - 0.15);
  rearWindow.rotation.x = 0.35;
  g.add(rearWindow);
  
  // Side windows
  const swGeo = new THREE.BoxGeometry(props.w - 0.16, props.greenhouseH, props.cabL * 0.85);
  const sideWindows = new THREE.Mesh(swGeo, glassMat);
  sideWindows.position.set(0, props.beltH + props.greenhouseH / 2 + 0.02, props.cabZ);
  sideWindows.castShadow = true;
  g.add(sideWindows);
  
  // B-pillars
  const pillarGeo = new THREE.BoxGeometry(0.08, props.greenhouseH, 0.08);
  for (const x of [-(props.w / 2 - 0.1), props.w / 2 - 0.1]) {
    const pillar = new THREE.Mesh(pillarGeo, darkMat);
    pillar.position.set(x, props.beltH + props.greenhouseH / 2 + 0.02, props.cabZ);
    pillar.castShadow = true;
    g.add(pillar);
  }
  
  // A-pillars
  const apillarGeo = new THREE.BoxGeometry(0.08, props.greenhouseH, 0.2);
  for (const x of [-(props.w / 2 - 0.1), props.w / 2 - 0.1]) {
    const ap = new THREE.Mesh(apillarGeo, darkMat);
    ap.position.set(x, props.beltH + props.greenhouseH / 2 + 0.02, props.cabZ + props.cabL / 2 + 0.05);
    ap.rotation.x = -0.48;
    ap.castShadow = true;
    g.add(ap);
  }
  
  // ========== TRUCK BED ==========
  if (isTruck) {
    const bedFloor = new THREE.Mesh(
      new THREE.BoxGeometry(props.w - 0.15, 0.08, props.bedLen),
      darkMat
    );
    bedFloor.position.set(0, 0.9, -props.bedLen / 2 - 0.1);
    bedFloor.castShadow = true;
    g.add(bedFloor);
    
    // Bed walls
    for (const x of [-(props.w / 2 - 0.1), props.w / 2 - 0.1]) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.5, props.bedLen),
        bm
      );
      wall.position.set(x, 1.15, -props.bedLen / 2 - 0.1);
      wall.castShadow = true;
      g.add(wall);
    }
    // Tailgate
    const gate = new THREE.Mesh(
      new THREE.BoxGeometry(props.w - 0.2, 0.5, 0.1),
      bm
    );
    gate.position.set(0, 1.15, -props.bedLen - 0.15);
    gate.castShadow = true;
    g.add(gate);
  }
  
  // ========== VAN CARGO AREA ==========
  if (isVan) {
    const cargoBox = new THREE.Mesh(
      new THREE.BoxGeometry(props.w - 0.12, props.cabH + 0.2, props.L - props.wheelbase - props.frontOverhang),
      bm
    );
    cargoBox.position.set(0, props.beltH + (props.cabH + 0.2) / 2, -props.wheelbase / 2 + 0.3);
    cargoBox.castShadow = true;
    g.add(cargoBox);
    
    // Rear doors
    for (const x of [-0.45, 0.45]) {
      const door = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, props.cabH + 0.15, 0.08),
        bm
      );
      door.position.set(x, props.beltH + props.cabH / 2, -halfLen + 0.1);
      door.castShadow = true;
      g.add(door);
    }
  }
  
  // ========== BUS BODY ==========
  if (isBus) {
    const busBody = new THREE.Mesh(
      new THREE.BoxGeometry(props.w - 0.1, props.cabH + 0.3, props.L - props.frontOverhang - props.rearOverhang),
      bm
    );
    busBody.position.set(0, props.beltH + (props.cabH + 0.3) / 2, 0);
    busBody.castShadow = true;
    g.add(busBody);
    
    // Window band
    const windowBand = new THREE.Mesh(
      new THREE.BoxGeometry(props.w - 0.12, props.greenhouseH, props.L - props.frontOverhang - props.rearOverhang - 0.5),
      glassMat
    );
    windowBand.position.set(0, props.beltH + props.greenhouseH / 2 + 0.02, 0);
    windowBand.castShadow = true;
    g.add(windowBand);
    
    // Windshield
    const bws = new THREE.Mesh(
      new THREE.BoxGeometry(props.w - 0.15, props.greenhouseH + 0.2, 0.06),
      glassMat
    );
    bws.position.set(0, props.beltH + props.greenhouseH / 2 + 0.1, halfLen - props.frontOverhang + 0.1);
    bws.rotation.x = -0.35;
    bws.castShadow = true;
    g.add(bws);
  }
  
  // ========== FRONT END DETAILS ==========
  // Grille
  const grilleH = isSuper ? 0.18 : 0.22;
  const grilleW = props.w * 0.55;
  const grille = new THREE.Mesh(
    new THREE.BoxGeometry(grilleW, grilleH, 0.08),
    isSuper ? grilleMat : grilleMatChrome
  );
  grille.position.set(0, 0.5, halfLen + 0.02);
  g.add(grille);
  
  // Grille mesh pattern (horizontal slats)
  for (let i = -3; i <= 3; i++) {
    const slat = new THREE.Mesh(
      new THREE.BoxGeometry(grilleW * 0.9, 0.02, 0.04),
      isSuper ? darkMat : chromeMat
    );
    slat.position.set(0, 0.5 + i * 0.04, halfLen + 0.06);
    g.add(slat);
  }
  
  // Front bumper
  const fBumper = new THREE.Mesh(
    new THREE.BoxGeometry(props.w + 0.08, 0.22, 0.18),
    darkMat
  );
  fBumper.position.set(0, 0.28, halfLen + 0.1);
  g.add(fBumper);
  
  // Front splitter (super cars)
  if (isSuper) {
    const splitter = new THREE.Mesh(
      new THREE.BoxGeometry(props.w + 0.12, 0.03, 0.25),
      darkMat
    );
    splitter.position.set(0, 0.12, halfLen + 0.15);
    g.add(splitter);
  }
  
  // Fog lights
  for (const x of [-(props.w / 2 - 0.25), props.w / 2 - 0.25]) {
    const fog = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.06, 12),
      headLensMat
    );
    fog.rotation.x = Math.PI / 2;
    fog.position.set(x, 0.35, halfLen + 0.15);
    g.add(fog);
  }
  
  // ========== REAR END DETAILS ==========
  // Rear bumper
  const rBumper = new THREE.Mesh(
    new THREE.BoxGeometry(props.w + 0.08, 0.22, 0.18),
    darkMat
  );
  rBumper.position.set(0, 0.28, -halfLen - 0.1);
  g.add(rBumper);
  
  // Diffuser (super cars)
  if (props.diffuser) {
    const diffuser = new THREE.Mesh(
      new THREE.BoxGeometry(props.w * 0.7, 0.15, 0.35),
      darkMat
    );
    diffuser.position.set(0, 0.2, -halfLen - 0.2);
    diffuser.castShadow = true;
    g.add(diffuser);
    
    // Diffuser fins
    for (let i = -2; i <= 2; i++) {
      const fin = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.12, 0.3),
        darkMat
      );
      fin.position.set(i * 0.18, 0.18, -halfLen - 0.25);
      g.add(fin);
    }
  }
  
  // Exhaust tips
  const exhaustCount = isSuper ? 4 : (isTruck ? 1 : 2);
  const exhaustSpacing = isSuper ? 0.25 : 0.4;
  const exhaustStart = -(exhaustCount - 1) * exhaustSpacing / 2;
  
  for (let i = 0; i < exhaustCount; i++) {
    const x = exhaustStart + i * exhaustSpacing;
    const tip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, 0.12, 12),
      chromeMat
    );
    tip.rotation.x = Math.PI / 2;
    tip.position.set(x, 0.35, -halfLen - 0.18);
    tip.castShadow = true;
    g.add(tip);
    g.userData.exhaustTip = tip;
  }
  
  // ========== SIDE SKIRTS ==========
  if (props.sideSkirt) {
    const skirtGeo = new THREE.BoxGeometry(props.w + 0.04, 0.12, props.wheelbase - 0.2);
    const skirt = new THREE.Mesh(skirtGeo, darkMat);
    skirt.position.set(0, 0.3, 0);
    skirt.castShadow = true;
    g.add(skirt);
  }
  
  // ========== DOOR HANDLES ==========
  const handleGeo = new THREE.BoxGeometry(0.12, 0.03, 0.02);
  const handleMat = chromeMat;
  for (const x of [-(props.w / 2 + 0.01), props.w / 2 + 0.01]) {
    for (const z of [props.cabZ - props.cabL / 3, props.cabZ + props.cabL / 3]) {
      const handle = new THREE.Mesh(handleGeo, handleMat);
      handle.position.set(x, props.beltH - 0.1, z);
      g.add(handle);
    }
  }
  
  // ========== SIDE MIRRORS ==========
  const mirrorBaseGeo = new THREE.BoxGeometry(0.06, 0.06, 0.12);
  const mirrorGlassGeo = new THREE.BoxGeometry(0.14, 0.09, 0.02);
  for (const x of [-(props.w / 2 + 0.08), props.w / 2 + 0.08]) {
    const base = new THREE.Mesh(mirrorBaseGeo, bm);
    base.position.set(x, props.beltH + 0.1, props.cabZ + props.cabL / 2 - 0.2);
    g.add(base);
    
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8),
      darkMat
    );
    stem.position.set(x, props.beltH + 0.05, props.cabZ + props.cabL / 2 - 0.2);
    g.add(stem);
    
    const glass = new THREE.Mesh(mirrorGlassGeo, glassMat);
    glass.position.set(x + Math.sign(x) * 0.07, props.beltH + 0.15, props.cabZ + props.cabL / 2 - 0.15);
    g.add(glass);
  }
  
  // ========== ROOF ANTENNA ==========
  const antGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.6, 6);
  const antenna = new THREE.Mesh(antGeo, darkMat);
  antenna.position.set(-(props.w / 2 - 0.2), props.beltH + props.roofH + 0.3, props.cabZ - props.cabL / 2);
  g.add(antenna);
  
  // ========== SPOILER ==========
  if (props.spoiler) {
    const wingGeo = new THREE.BoxGeometry(props.w * 0.85, 0.05, 0.35);
    const wing = new THREE.Mesh(wingGeo, isSuper ? darkMat : bm);
    wing.position.set(0, props.beltH + props.roofH + 0.15, -halfLen + 0.4);
    wing.castShadow = true;
    g.add(wing);
    
    // Wing endplates
    for (const x of [-(props.w * 0.42), props.w * 0.42]) {
      const epGeo = new THREE.BoxGeometry(0.04, 0.12, 0.35);
      const ep = new THREE.Mesh(epGeo, darkMat);
      ep.position.set(x, props.beltH + props.roofH + 0.09, -halfLen + 0.4);
      ep.castShadow = true;
      g.add(ep);
    }
    
    // Center brake light on spoiler
    const cbl = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.02, 0.02),
      tailLensMat
    );
    cbl.position.set(0, props.beltH + props.roofH + 0.15, -halfLen + 0.42);
    g.add(cbl);
    g.userData.highMountBrake = cbl;
  }
  
  // ========== LIGHT BAR (POLICE/TAXI) ==========
  if (props.lightBar) {
    const barGeo = new THREE.BoxGeometry(props.w * 0.7, 0.12, 0.45);
    const bar = new THREE.Mesh(barGeo, darkMat);
    bar.position.set(0, props.beltH + props.roofH + 0.12, props.cabZ - 0.05);
    bar.castShadow = true;
    g.add(bar);
    
    const blueMat = new THREE.MeshBasicMaterial({ color: 0x1a4fff, transparent: true, opacity: 0.9 });
    const redMat = new THREE.MeshBasicMaterial({ color: 0xff1a1a, transparent: true, opacity: 0.9 });
    const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
    
    const modules = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.08, 0.35),
        i % 2 === 0 ? blueMat : redMat
      );
      m.position.set(-0.45 + i * 0.3, props.beltH + props.roofH + 0.18, props.cabZ - 0.05);
      g.add(m);
      modules.push(m);
    }
    
    // Alley lights
    for (const x of [-0.6, 0.6]) {
      const al = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 0.06, 0.1),
        whiteMat
      );
      al.position.set(x, props.beltH + props.roofH + 0.15, props.cabZ + 0.2);
      al.rotation.x = -0.3;
      g.add(al);
    }
    
    g.userData.lightBars = modules;
    g.userData.lightMats = [blueMat, redMat];
  }
  
  if (props.taxiSign) {
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.18, 0.25),
      headLensMat
    );
    sign.position.set(0, props.beltH + props.roofH + 0.18, props.cabZ - 0.1);
    g.add(sign);
    g.userData.taxiSign = sign;
  }
  
  // ========== WHEELS ==========
  const wheelZ = isBus 
    ? [-props.wheelbase/2 + 0.5, -0.5, 0.5, props.wheelbase/2 - 0.5]
    : [-props.wheelbase/2, props.wheelbase/2];
  
  const wheels = [];
  const tireProfile = isSuper ? 0.3 : 0.35;
  
  for (const z of wheelZ) {
    for (const x of [-props.track/2, props.track/2]) {
      // Wheel arch liner
      const archGeo = new THREE.CylinderGeometry(props.wheelR + 0.08, props.wheelR + 0.08, 0.15, 16);
      const arch = new THREE.Mesh(archGeo, darkMat);
      arch.rotation.z = Math.PI / 2;
      arch.position.set(x, props.wheelR + 0.05, z);
      g.add(arch);
      
      // Brake rotor
      const rotorGeo = new THREE.CylinderGeometry(props.rimR * 0.75, props.rimR * 0.75, 0.02, 16);
      const rotor = new THREE.Mesh(rotorGeo, brakeMat);
      rotor.rotation.z = Math.PI / 2;
      rotor.position.set(x, props.wheelR, z + Math.sign(x) * 0.02);
      g.add(rotor);
      
      // Brake caliper
      if (props.caliper) {
        const caliperGeo = new THREE.BoxGeometry(0.08, props.rimR * 1.2, 0.06);
        const caliper = new THREE.Mesh(caliperGeo, new THREE.MeshStandardMaterial({ 
          color: isSuper ? 0xff3a3a : 0x8a2222, 
          roughness: 0.3, metalness: 0.6 
        }));
        caliper.position.set(x + Math.sign(x) * (props.rimR + 0.06), props.wheelR, z);
        g.add(caliper);
      }
      
      // Tire
      const tireGeo = new THREE.CylinderGeometry(props.wheelR, props.wheelR, props.wheelW, 18);
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.rotation.z = Math.PI / 2;
      tire.position.set(x, props.wheelR, z);
      tire.castShadow = true;
      g.add(tire);
      
      // Tire sidewall detail
      const sidewallGeo = new THREE.TorusGeometry(props.wheelR, 0.015, 8, 32);
      for (const side of [-1, 1]) {
        const sw = new THREE.Mesh(sidewallGeo, tireMat);
        sw.rotation.x = Math.PI / 2;
        sw.position.set(x, props.wheelR, z + side * (props.wheelW / 2 + 0.01));
        g.add(sw);
      }
      
      // Rim (multi-spoke design)
      const rimGroup = new THREE.Group();
      const rimFace = new THREE.Mesh(
        new THREE.CylinderGeometry(props.rimR, props.rimR, props.wheelW + 0.02, 5),
        isSuper ? hubMatChrome : hubMat
      );
      rimFace.rotation.z = Math.PI / 2;
      rimGroup.add(rimFace);
      
      // Spokes
      for (let s = 0; s < 5; s++) {
        const spokeGeo = new THREE.BoxGeometry(0.03, props.rimR * 0.7, 0.015);
        const spoke = new THREE.Mesh(spokeGeo, isSuper ? hubMatChrome : hubMat);
        spoke.position.set(0, 0, 0);
        spoke.rotation.z = (s / 5) * Math.PI * 2;
        rimGroup.add(spoke);
      }
      
      // Center cap
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(props.rimR * 0.25, props.rimR * 0.25, 0.03, 16),
        badgeMat
      );
      cap.rotation.z = Math.PI / 2;
      rimGroup.add(cap);
      
      // Lug nuts
      for (let s = 0; s < 5; s++) {
        const lug = new THREE.Mesh(
          new THREE.CylinderGeometry(0.018, 0.018, 0.015, 8),
          chromeMat
        );
        lug.rotation.z = Math.PI / 2;
        lug.position.set(
          Math.cos((s / 5) * Math.PI * 2) * props.rimR * 0.6,
          Math.sin((s / 5) * Math.PI * 2) * props.rimR * 0.6,
          0
        );
        rimGroup.add(lug);
      }
      
      rimGroup.rotation.z = Math.PI / 2;
      rimGroup.position.set(x, props.wheelR, z);
      g.add(rimGroup);
      
      wheels.push({ tire, rim: rimGroup, rotor });
    }
  }
  g.userData.wheels = wheels;
  
  // ========== HEADLIGHTS ==========
  const lightZ = halfLen + (props.class === 'bus' ? 1.5 : props.class === 'truck' ? 0.5 : 0.2);
  const headlightY = 0.55;
  
  for (const x of [-(props.w / 2 - 0.35), props.w / 2 - 0.35]) {
    // Housing
    const hHousing = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.18, 0.22),
      darkMat
    );
    hHousing.position.set(x, headlightY, lightZ + 0.02);
    g.add(hHousing);
    
    // Projector lens (inner)
    const projector = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.12, 12),
      headLensMat
    );
    projector.rotation.x = Math.PI / 2;
    projector.position.set(x, headlightY, lightZ + 0.14);
    g.add(projector);
    
    // LED DRL strip
    const drl = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.015, 0.02),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
    );
    drl.position.set(x, headlightY + 0.05, lightZ + 0.12);
    g.add(drl);
    
    // Turn signal
    const turn = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.04, 0.02),
      amberLensMat
    );
    turn.position.set(x + Math.sign(x) * 0.18, headlightY - 0.02, lightZ + 0.14);
    g.add(turn);
    
    // Glow sprites
    const glows = lightGlowMats();
    const hs = new THREE.Sprite(glows.headGlowMat);
    hs.position.set(x, headlightY, lightZ + 0.25);
    hs.scale.setScalar(isSuper ? 2.2 : 1.8);
    g.add(hs);
    
    const ts = new THREE.Sprite(glows.amberGlowMat);
    ts.position.set(x + Math.sign(x) * 0.18, headlightY - 0.02, lightZ + 0.15);
    ts.scale.setScalar(0.8);
    g.add(ts);
    
    // Dynamic SpotLight
    const spot = new THREE.SpotLight(0xffe9a8, 0, 35, Math.PI / 6, 0.3, 0.5);
    spot.position.set(x, headlightY + 0.1, lightZ + 0.1);
    spot.target.position.set(x, 0, lightZ + 25);
    spot.castShadow = false;
    g.add(spot, spot.target);
    g.userData.headlightSpots = g.userData.headlightSpots || [];
    g.userData.headlightSpots.push(spot);
  }
  
  // ========== TAILLIGHTS ==========
  const tailLightY = 0.6;
  const tailZ = -halfLen - (props.class === 'bus' ? 1.8 : props.class === 'truck' ? 0.4 : 0.2);
  
  const tailMats = [];
  for (const x of [-(props.w / 2 - 0.3), props.w / 2 - 0.3]) {
    // Housing
    const tHousing = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.22, 0.2),
      darkMat
    );
    tHousing.position.set(x, tailLightY, tailZ - 0.02);
    g.add(tHousing);
    
    // Main tail light (red)
    const tMain = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.15, 0.06),
      tailLensMat
    );
    tMain.position.set(x, tailLightY, tailZ - 0.13);
    g.add(tMain);
    
    // Brake light (brighter red)
    const tm = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.95 });
    const brakeLight = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.15, 0.04),
      tm
    );
    brakeLight.position.set(x, tailLightY, tailZ - 0.15);
    brakeLight.visible = false;
    g.add(brakeLight);
    tailMats.push(tm);
    
    // Turn signal (amber)
    const turn = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.1, 0.04),
      amberLensMat
    );
    turn.position.set(x + Math.sign(x) * 0.18, tailLightY - 0.05, tailZ - 0.13);
    g.add(turn);
    g.userData.turnSignal = g.userData.turnSignal || [];
    g.userData.turnSignal.push(turn);
    
    // Reverse light
    const rev = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.04),
      reverseLensMat
    );
    rev.position.set(x * 0.5, tailLightY - 0.1, tailZ - 0.13);
    rev.visible = false;
    g.add(rev);
    g.userData.reverseLight = g.userData.reverseLight || [];
    g.userData.reverseLight.push(rev);
    
    // Reflector
    const reflector = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.03, 0.02),
      new THREE.MeshBasicMaterial({ color: 0xff4444 })
    );
    reflector.position.set(x, tailLightY - 0.18, tailZ - 0.13);
    g.add(reflector);
    
    // Glow sprites
    const glows = lightGlowMats();
    const ts = new THREE.Sprite(glows.tailGlowMat);
    ts.position.set(x, tailLightY, tailZ - 0.2);
    ts.scale.setScalar(1.5);
    g.add(ts);
  }
  g.userData.tailMats = tailMats;
  
  // Center brake light (non-spoiler cars)
  if (!props.spoiler && !isBus && !isVan) {
    const cbl = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.025, 0.02),
      tailLensMat
    );
    cbl.position.set(0, props.beltH + props.roofH + 0.05, -halfLen + 0.15);
    g.add(cbl);
    g.userData.highMountBrake = cbl;
  }
  
  // ========== LICENSE PLATE ==========
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.08, 0.18),
    new THREE.MeshLambertMaterial({ color: 0x4a4f55 })
  );
  plate.position.set(0, 0.5, -halfLen - 0.12);
  g.add(plate);
  g.userData.plate = plate;
  
  // ========== INTERIOR (visible through windows) ==========
  // Only for non-bus, non-van
  if (!isBus && !isVan) {
    const interiorGroup = new THREE.Group();
    
    // Dashboard
    const dashGeo = new THREE.BoxGeometry(props.w - 0.3, 0.35, 0.6);
    const dash = new THREE.Mesh(dashGeo, interiorMat);
    dash.position.set(0, props.beltH + 0.05, props.cabZ + props.cabL / 2 - 0.15);
    interiorGroup.add(dash);
    
    // Steering wheel
    const wheelGeo = new THREE.TorusGeometry(0.18, 0.03, 8, 16);
    const wheel = new THREE.Mesh(wheelGeo, steeringMat);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(0, props.beltH + 0.25, props.cabZ + props.cabL / 2 - 0.4);
    interiorGroup.add(wheel);
    
    // Seats
    for (const x of [-0.38, 0.38]) {
      const seatBase = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.15, 0.55),
        seatMat
      );
      seatBase.position.set(x, 0.45, props.cabZ - 0.1);
      interiorGroup.add(seatBase);
      
      const seatBack = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.55, 0.12),
        seatMat
      );
      seatBack.position.set(x, 0.72, props.cabZ - 0.38);
      interiorGroup.add(seatBack);
      
      // Headrest
      const hr = new THREE.Mesh(
        new THREE.BoxGeometry(0.25, 0.15, 0.08),
        seatMat
      );
      hr.position.set(x, 1.05, props.cabZ - 0.3);
      interiorGroup.add(hr);
    }
    
    // Rear seats (sedans)
    if (props.class === 'sedan') {
      for (const x of [-0.35, 0.35]) {
        const rBase = new THREE.Mesh(
          new THREE.BoxGeometry(0.45, 0.12, 0.5),
          seatMat
        );
        rBase.position.set(x, 0.45, props.cabZ - props.cabL / 2 - 0.1);
        interiorGroup.add(rBase);
        
        const rBack = new THREE.Mesh(
          new THREE.BoxGeometry(0.45, 0.45, 0.1),
          seatMat
        );
        rBack.position.set(x, 0.65, props.cabZ - props.cabL / 2 - 0.35);
        interiorGroup.add(rBack);
      }
    }
    
    // Center console
    const console = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.35, 0.7),
      interiorMat
    );
    console.position.set(0, 0.45, props.cabZ + 0.1);
    interiorGroup.add(console);
    
    interiorGroup.position.y = 0.02;
    g.add(interiorGroup);
    g.userData.interior = interiorGroup;
  }
  
  // ========== BADGES ==========
  // Front badge
  const fBadge = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.15, 0.02),
    badgeMat
  );
  fBadge.position.set(0, 0.55, halfLen + 0.12);
  g.add(fBadge);
  
  // Rear badge
  const rBadge = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.02),
    badgeMat
  );
  rBadge.position.set(0, 0.55, -halfLen - 0.12);
  g.add(rBadge);
  
  // ========== LENGTH FOR COLLISION ==========
  g.userData.length = bodyLen;
  
  return g;
}

function makeBike(defKey, colorHex, props, bm) {
  const g = new THREE.Group();
  const bodyLen = props.L;
  
  // Frame
  const frameGeo = new THREE.CylinderGeometry(0.04, 0.04, bodyLen * 0.6, 8);
  const frame = new THREE.Mesh(frameGeo, bm);
  frame.rotation.x = Math.PI / 2;
  frame.position.set(0, 0.65, 0);
  frame.castShadow = true;
  g.add(frame);
  
  // Fuel tank
  const tankGeo = new THREE.SphereGeometry(0.18, 12, 8);
  const tank = new THREE.Mesh(tankGeo, bm);
  tank.position.set(0, 0.85, 0.35);
  tank.scale.set(1, 0.7, 1.2);
  tank.castShadow = true;
  g.add(tank);
  
  // Seat
  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.06, 0.45),
    darkMat
  );
  seat.position.set(0, 0.78, -0.25);
  g.add(seat);
  
  // Engine
  const engineGeo = new THREE.BoxGeometry(0.35, 0.25, 0.3);
  const engine = new THREE.Mesh(engineGeo, darkMat);
  engine.position.set(0, 0.45, 0.1);
  engine.castShadow = true;
  g.add(engine);
  
  // Exhaust
  const exhaust = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8),
    chromeMat
  );
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0.2, 0.35, -0.3);
  g.add(exhaust);
  
  // Handlebars
  const barGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.55, 8);
  const bars = new THREE.Mesh(barGeo, hubMatBlack);
  bars.rotation.z = Math.PI / 2;
  bars.position.set(0, 1.05, 0.55);
  g.add(bars);
  
  // Grips
  for (const x of [-0.28, 0.28]) {
    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.12, 8),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 })
    );
    grip.rotation.z = Math.PI / 2;
    grip.position.set(x, 1.05, 0.55);
    g.add(grip);
  }
  
  // Front fork
  const forkGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.55, 8);
  const fork = new THREE.Mesh(forkGeo, chromeMat);
  fork.rotation.x = 0.25;
  fork.position.set(0, 0.7, 0.8);
  g.add(fork);
  
  // Wheels
  const bikeWheels = [];
  for (const z of [0.85, -0.85]) {
    const tireGeo = new THREE.CylinderGeometry(props.wheelR, props.wheelR, props.wheelW, 16);
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.position.set(0, props.wheelR, z);
    tire.castShadow = true;
    g.add(tire);
    
    const rimGeo = new THREE.CylinderGeometry(props.rimR, props.rimR, props.wheelW + 0.02, 5);
    const rim = new THREE.Mesh(rimGeo, hubMatChrome);
    rim.rotation.z = Math.PI / 2;
    rim.position.set(0, props.wheelR, z);
    g.add(rim);
    
    // Spokes
    for (let s = 0; s < 5; s++) {
      const spoke = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, props.rimR * 0.7, 0.01),
        hubMatChrome
      );
      spoke.rotation.z = (s / 5) * Math.PI * 2;
      spoke.position.set(0, props.wheelR, z);
      g.add(spoke);
    }
    
    const rotorGeo = new THREE.CylinderGeometry(props.rimR * 0.7, props.rimR * 0.7, 0.02, 12);
    const rotor = new THREE.Mesh(rotorGeo, brakeMat);
    rotor.rotation.z = Math.PI / 2;
    rotor.position.set(-0.12, props.wheelR, z);
    g.add(rotor);
    
    bikeWheels.push({ tire, rim });
  }
  g.userData.wheels = bikeWheels;
  
  // Headlight
  const hLens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.1, 0.08, 12),
    headLensMat
  );
  hLens.rotation.x = Math.PI / 2;
  hLens.position.set(0, 0.75, 1.05);
  g.add(hLens);
  
  // Taillight
  const tLens = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.08, 0.02),
    tailLensMat
  );
  tLens.position.set(0, 0.55, -1.05);
  g.add(tLens);
  
  // Rider (simplified)
  const riderMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.7 });
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 10, 8),
    new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.3 })
  );
  helmet.position.set(0, 1.45, -0.1);
  g.add(helmet);
  
  g.userData.length = bodyLen;
  return g;
}

function makeGenericCar(defKey, colorHex) {
  // Fallback simple box car
  const g = new THREE.Group();
  const bm = bodyMat(colorHex);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 4.5), bm);
  body.position.y = 0.5;
  body.castShadow = true;
  g.add(body);
  g.userData.length = 4.5;
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
    this.kind = 'traffic';
    this.driver = null;
    this.ai = null;
    this.upgrades = { armor: 0, engine: 0, tires: 0 };
    this.eff = {
      topSpeed: this.def.topSpeed,
      accel: this.def.accel,
      brake: this.def.brake,
      handling: this.def.handling,
    };
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = heading;
    this._wheelRot = 0;
    this._steerAngle = 0;
  }

  get length() { return this.mesh.userData.length; }

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
    
    // Visual upgrades
    if (this.upgrades.armor > 0 && this.mesh.userData.armorPlate) {
      this.mesh.userData.armorPlate.visible = true;
      this.mesh.userData.armorPlate.material.color.setHex(this.upgrades.armor === 2 ? 0x4a6fa5 : 0x8a7a5a);
    }
    if (this.upgrades.engine > 0 && this.mesh.userData.exhaustTip) {
      this.mesh.userData.exhaustTip.visible = true;
      if (this.upgrades.engine === 2) {
        this.mesh.userData.exhaustTip.material.color.setHex(0xff7a2a);
        this.mesh.userData.exhaustTip.scale.set(1, 1, 1.3);
      }
    }
    if (this.upgrades.tires > 0) {
      for (const w of this.mesh.userData.wheels || []) {
        if (w.rim) {
          w.rim.traverse(m => {
            if (m.material) m.material = this.upgrades.tires === 2 ? hubMatChrome : hubMatBlack;
          });
        }
      }
    }
  }

  drive(dt, steerInput, accelInput, colliders) {
    this.steer = clamp(this.steer + steerInput * dt * 3, -1, 1);
    this._steerAngle = THREE.MathUtils.lerp(this._steerAngle, this.steer * 0.6, dt * 8);
    
    const accel = accelInput > 0 ? this.eff.accel : (accelInput < 0 ? -this.eff.brake : -0.5);
    this.speed = clamp(this.speed + accel * dt, -this.eff.topSpeed * 0.3, this.eff.topSpeed);
    
    if (Math.abs(this.speed) < 0.1 && Math.abs(accelInput) < 0.1) this.speed = 0;
    
    this.heading += (this.speed / this.length) * this._steerAngle * dt * 2.5;
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += Math.cos(this.heading) * this.speed * dt;
    
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.heading;
    
    // Wheel rotation
    this._wheelRot += (this.speed / (this.mesh.userData.wheels?.[0]?.tire ? 0.34 : 0.36)) * dt;
    for (const w of this.mesh.userData.wheels || []) {
      if (w.tire) w.tire.rotation.x = this._wheelRot;
      if (w.rim) w.rim.rotation.x = this._wheelRot;
    }
    
    // Steer front wheels
    const frontWheels = this.mesh.userData.wheels?.slice(0, 2) || [];
    for (const w of frontWheels) {
      if (w.rim) w.rim.rotation.y = this._steerAngle;
      if (w.tire) w.tire.rotation.y = this._steerAngle;
    }
    
    // Collision resolution
    if (colliders) {
      for (const c of colliders) {
        const dx = Math.abs(this.pos.x - (c.minX + c.maxX) / 2);
        const dz = Math.abs(this.pos.z - (c.minZ + c.maxZ) / 2);
        const hw = (c.maxX - c.minX) / 2 + this.length / 2;
        const hh = (c.maxZ - c.minZ) / 2 + 1;
        if (dx < hw && dz < hh) {
          const ox = hw - dx, oz = hh - dz;
          if (ox < oz) this.pos.x += Math.sign(this.pos.x - (c.minX + c.maxX) / 2) * ox;
          else this.pos.z += Math.sign(this.pos.z - (c.minZ + c.maxZ) / 2) * oz;
          this.mesh.position.copy(this.pos);
        }
      }
    }
    
    // Light state
    const hl = this.mesh.userData.headlightSpots;
    if (hl) hl.forEach(s => s.intensity = this.speed > 0.5 ? 1.5 : 0);
    
    const tm = this.mesh.userData.tailMats;
    if (tm) tm.forEach(m => m.opacity = this.speed < -0.5 ? 0.95 : 0.3);
    
    const hmb = this.mesh.userData.highMountBrake;
    if (hmb) hmb.visible = this.speed < -0.5;
    
    const rev = this.mesh.userData.reverseLight;
    if (rev) rev.forEach(r => r.visible = this.speed < -0.5);
    
    // Brake caliper glow when braking hard
    if (accelInput < -0.5 && this.speed > 2) {
      for (const w of this.mesh.userData.wheels || []) {
        if (w.rotor) w.rotor.material.color.setHex(0xff4400);
      }
    } else {
      for (const w of this.mesh.userData.wheels || []) {
        if (w.rotor) w.rotor.material.color.setHex(0xcc2222);
      }
    }
  }

  takeDamage(amount, fromPos) {
    this.health -= amount;
    if (this.health <= this.maxHealth * 0.3 && !this.smoking) {
      this.smoking = true;
      // Smoke particles would be added here
    }
    if (this.health <= 0 && !this.dead) {
      this.dead = true;
      return true;
    }
    return false;
  }

  repair() {
    this.health = this.maxHealth;
    this.smoking = false;
  }

  syncMesh() {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.heading;
  }
}

// ========== TRAFFIC MANAGER ==========
export class TrafficManager {
  constructor(scene, world, rng) {
    this.scene = scene;
    this.world = world;
    this.rng = rng;
    this.cars = [];
    this.keys = ['brisa', 'brisa', 'vento', 'vento', 'carguero', 'caminar', 'taxi', 'moto', 'moto', 'bus'];
    this.dwelling = [];
  }

  spawn(count, center, radius) {
    const lines = this.world.roads;
    for (let i = 0; i < count; i++) {
      const key = pick(this.rng, this.keys);
      const def = CAR_DEFS[key];
      const colors = CLASS_COLORS[VEHICLE_PROPS[key]?.class || 'sedan'];
      const color = pick(this.rng, colors);
      const axis = this.rng() < 0.5 ? 'x' : 'z';
      const line = pick(this.rng, lines);
      const along = (this.rng() * 2 - 1) * radius + (axis === 'x' ? center.z : center.x);
      const dir = this.rng() < 0.5 ? 1 : -1;
      const lateral = (axis === 'x' ? -3.5 : 3.5) * dir + (this.rng() - 0.5) * 0.8;
      const x = axis === 'x' ? line + lateral : along;
      const z = axis === 'x' ? along : line + lateral;
      const heading = axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
      const car = new Car(key, color, x, z, heading);
      car.kind = 'traffic';
      const ai = { axis, dir, targetSpeed: 7 + this.rng() * 4, wait: 0 };
      if (key === 'moto') {
        ai.weave = true; ai.weavePhase = this.rng() * Math.PI * 2;
        ai.targetSpeed = 12 + this.rng() * 5;
      }
      if (key === 'bus') {
        ai.bus = true; ai.targetSpeed = 5 + this.rng() * 1.5; ai.dwell = 0; ai.stop = null; ai.lastStop = null; ai.boardedThisStop = false;
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
      const ai = car.ai || (car.ai = { axis: 'x', dir: 1, targetSpeed: 8, wait: 0 });
      ai.age = (ai.age || 0) + dt;
      if (playerPos && ai.age > 10 && dist2(car.pos.x, car.pos.z, playerPos.x, playerPos.z) > 150) {
        this.scene.remove(car.mesh);
        gone.push(car);
        continue;
      }
      if (car.dead) continue;
      if (ai.wait > 0) { ai.wait -= dt; car.drive(dt, 0, 0, this.world.colliders); continue; }
      
      const axis = ai.axis;
      const line = axis === 'x' ? car.pos.x : car.pos.z;
      const targetLine = axis === 'x' ? car.pos.z : car.pos.x;
      const lineOptions = lines.filter(l => Math.abs(l - line) > 20);
      const nextLine = lineOptions.length ? pick(this.rng, lineOptions) : line;
      const lineDiff = nextLine - line;
      
      let steer = 0, accel = 1;
      const ahead = axis === 'x' ? Math.sin(car.heading) * 15 : Math.cos(car.heading) * 15;
      const side = axis === 'x' ? Math.cos(car.heading) * 15 : -Math.sin(car.heading) * 15;
      const checkX = car.pos.x + (axis === 'x' ? 0 : ahead);
      const checkZ = car.pos.z + (axis === 'z' ? 0 : ahead);
      
      // Obstacle avoidance
      for (const other of allCars) {
        if (other === car || other.dead) continue;
        const dx = other.pos.x - checkX, dz = other.pos.z - checkZ;
        const d = Math.hypot(dx, dz);
        if (d < 8 && other.speed < car.speed * 0.5) {
          accel = -0.5;
          if (lineOptions.length && ai.wait <= 0 && this.rng() < 0.02) {
            ai.axis = axis === 'x' ? 'z' : 'x';
            ai.dir = this.rng() < 0.5 ? 1 : -1;
            ai.wait = 1 + this.rng() * 2;
          }
        }
      }
      
      // Pedestrian avoidance
      if (peds) {
        for (const p of peds.peds) {
          if (p.dead) continue;
          const dx = p.pos.x - checkX, dz = p.pos.z - checkZ;
          if (dx * dx + dz * dz < 9) { accel = -1; break; }
        }
      }
      
      // Turn at intersections
      if (Math.abs(lineDiff) < 4 && this.rng() < 0.008 && ai.wait <= 0) {
        ai.axis = axis === 'x' ? 'z' : 'x';
        ai.dir = this.rng() < 0.5 ? 1 : -1;
        ai.wait = 0.5 + this.rng() * 1.5;
      }
      
      if (axis === 'x') {
        const targetX = ai.dir > 0 ? line + 3.5 : line - 3.5;
        steer = clamp((targetX - car.pos.x) * 0.3, -1, 1);
      } else {
        const targetZ = ai.dir > 0 ? line + 3.5 : line - 3.5;
        steer = clamp((targetZ - car.pos.z) * 0.3, -1, 1);
      }
      
      // Moto weave
      if (ai.weave) {
        ai.weavePhase += dt * 2.5;
        steer += Math.sin(ai.weavePhase) * 0.25;
      }
      
      car.drive(dt, steer, accel, this.world.colliders);
    }
    for (const c of gone) this.cars.splice(this.cars.indexOf(c), 1);
  }
}

// ========== POLICE MANAGER ==========
export class PoliceManager {
  constructor(scene, world, rng) {
    this.scene = scene;
    this.world = world;
    this.rng = rng;
    this.cars = [];
    this.heli = null;
    this.blockers = [];
    this.wanted = 0;
    this.wantedTimer = 0;
    this.spawnTimer = 0;
  }

  getWanted() { return this.wanted; }
  setWanted(w) { this.wanted = clamp(w, 0, 5); }
  addWanted(w) { this.setWanted(this.wanted + w); }
  
  reportCrime(pos, severity = 1) {
    if (this.wanted < 1) this.setWanted(1);
    this.wantedTimer = 20;
    if (severity > 1) this.addWanted(severity - 1);
  }

  clearRoadblocks() {
    for (const b of this.blockers) this.scene.remove(b.mesh);
    this.blockers = [];
  }

  spawnRoadblock(playerPos, playerHeading, dist = 45) {
    this.clearRoadblocks();
    const perp = playerHeading + Math.PI / 2;
    const count = ROADBLOCK_COUNT[this.wanted] || 2;
    for (let i = 0; i < count; i++) {
      const offset = (i - (count - 1) / 2) * 6;
      const x = playerPos.x + Math.sin(playerHeading) * dist + Math.sin(perp) * offset;
      const z = playerPos.z + Math.cos(playerHeading) * dist + Math.cos(perp) * offset;
      const car = new Car('police', CAR_COLORS.police, x, z, playerHeading + Math.PI);
      car.kind = 'roadblock';
      car.speed = 0;
      car.ai = { axis: 'x', dir: 1, targetSpeed: 0, wait: 999 };
      this.scene.add(car.mesh);
      this.blockers.push(car);
      const spikeGeo = new THREE.PlaneGeometry(14, 0.8);
      const spikeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.3, metalness: 0.7 });
      const spike = new THREE.Mesh(spikeGeo, spikeMat);
      spike.rotation.x = -Math.PI / 2;
      spike.position.set(x, 0.09, z + Math.sin(playerHeading) * 3);
      this.scene.add(spike);
      this.blockers.push({ mesh: spike, pos: { x, z } });
    }
  }

  spawnOne(playerPos) {
    const lines = this.world.roads;
    const line = pick(this.rng, lines);
    const axis = this.rng() < 0.5 ? 'x' : 'z';
    const along = axis === 'x' ? playerPos.z : playerPos.x;
    const lateral = (axis === 'x' ? -3.5 : 3.5) * (this.rng() < 0.5 ? 1 : -1);
    const x = axis === 'x' ? line + lateral : along + this.rng() * 20 - 10;
    const z = axis === 'x' ? along + this.rng() * 20 - 10 : line + lateral;
    const heading = axis === 'x' ? (lateral < 0 ? Math.PI / 2 : -Math.PI / 2) : (lateral < 0 ? 0 : Math.PI);
    const car = new Car('police', CAR_COLORS.police, x, z, heading);
    car.kind = 'police';
    car.ai = { axis, dir: lateral < 0 ? 1 : -1, targetSpeed: 35 + this.wanted * 3, wait: 0, pursuit: true };
    car.upgrades = { armor: 1, engine: 1, tires: 1 };
    car.applyUpgrades(car.upgrades);
    this.scene.add(car.mesh);
    this.cars.push(car);
  }

  spawnHeli() {
    if (this.heli) return;
    const geo = new THREE.ConeGeometry(2, 1, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1d2733, roughness: 0.4, metalness: 0.3 });
    this.heli = new THREE.Mesh(geo, mat);
    this.heli.scale.set(1, 0.3, 2);
    this.scene.add(this.heli);
    const light = new THREE.SpotLight(0xffffff, 0, 80, Math.PI / 4, 0.5, 1);
    light.position.set(0, 50, 0);
    light.target.position.set(0, 0, 0);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    this.scene.add(light, light.target);
    this.heliLight = light;
    this.heliRotor = new THREE.Mesh(
      new THREE.CylinderGeometry(6, 6, 0.05, 2),
      new THREE.MeshBasicMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
    );
    this.heliRotor.position.y = 0.6;
    this.heli.add(this.heliRotor);
    const tailRotor = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 0.03, 2),
      new THREE.MeshBasicMaterial({ color: 0x2a2a2a })
    );
    tailRotor.rotation.z = Math.PI / 2;
    tailRotor.position.set(5.5, -0.2, 0);
    this.heli.add(tailRotor);
  }

  update(dt, playerPos, playerWanted, playerCar) {
    this.wanted = playerWanted;
    if (this.wanted === 0) {
      for (const c of this.cars) { this.scene.remove(c.mesh); }
      this.cars = [];
      this.clearRoadblocks();
      if (this.heli) { this.scene.remove(this.heli); this.scene.remove(this.heliLight); this.scene.remove(this.heliLight.target); this.heli = null; }
      return;
    }
    this.wantedTimer -= dt;
    if (this.wantedTimer <= 0) this.setWanted(Math.max(0, this.wanted - 0.01));
    
    const want = Math.ceil(this.wanted);
    this.spawnTimer -= dt;
    if (this.cars.length < want && this.spawnTimer <= 0) {
      this.spawnTimer = 2.5;
      this.spawnOne(playerPos);
    }
    
    if (want >= 3 && !this.heli) this.spawnHeli();
    
    if (this.heli && playerPos) {
      this.heli.position.lerp(new THREE.Vector3(playerPos.x, 55, playerPos.z + 20), dt * 0.5);
      this.heliLight.position.copy(this.heli.position);
      this.heliLight.target.position.set(playerPos.x, 0, playerPos.z);
      this.heliLight.target.updateMatrixWorld();
      this.heliLight.intensity = 1500;
      this.heliRotor.rotation.y += dt * 40;
    }
    
    for (const car of this.cars) {
      if (car.dead) continue;
      const ai = car.ai;
      if (!playerCar) { car.drive(dt, 0, -0.2, this.world.colliders); continue; }
      const dx = playerCar.pos.x - car.pos.x;
      const dz = playerCar.pos.z - car.pos.z;
      const dist = Math.hypot(dx, dz);
      const targetHeading = Math.atan2(dx, dz);
      let steer = clamp(angleDiff(targetHeading, car.heading) * 1.5, -1, 1);
      let accel = dist > 15 ? 1 : (dist > 8 ? 0.3 : -0.5);
      if (ai.pursuit && this.rng() < 0.005) { accel = 1.5; steer += (this.rng() - 0.5) * 0.3; }
      car.drive(dt, steer, accel, this.world.colliders);
      // Flash light bar
      if (car.mesh.userData.lightMats) {
        const t = Date.now() / 500;
        const mats = car.mesh.userData.lightMats;
        mats[0].color.setHex(Math.floor(t) % 2 === 0 ? 0x2b6fd6 : 0x1a1a2a);
        mats[1].color.setHex(Math.floor(t) % 2 === 0 ? 0x1a1a2a : 0xd21f2b);
      }
    }
    
    if (want >= 2 && this.blockers.length === 0 && this.rng() < 0.0008) {
      this.spawnRoadblock(playerPos, playerCar ? playerCar.heading : 0, 50);
    }
  }
}