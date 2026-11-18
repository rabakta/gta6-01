// BRISA BAY — the city itself: roads, buildings, beach, sea, palms, lamps,
// a billboard and the bridge. Everything is built procedurally from one
// seed, so the map is identical on every run and the screenshots can be
// re-staged exactly.
import * as THREE from 'three';
import { CITY, PALETTE, SHOPS } from './config.js';
import { mulberry32, pick } from './utils.js';
import { facadeTexture, roadTexture, pavementTexture, sandTexture, signTexture, billboardTexture, roofTexture } from './textures.js';

// Warm pastel stucco for the city blocks.
const PASTEL = ['#e8b4a0', '#f2d5a0', '#a8c8b8', '#d98a7a', '#9fb8cc', '#e5c8d8', '#c8b8a0', '#f0e0c0'];

// Road centre lines, one per grid line.
export function roadLines() {
  const lines = [];
  for (let i = 0; i < CITY.blocks; i++) lines.push(-CITY.half + CITY.pitch / 2 + i * CITY.pitch);
  return lines;
}

// Snap a coordinate to the nearest road centre line (traffic AI).
export function nearestRoadCoord(v) {
  let best = roadLines()[0];
  let bd = Math.abs(v - best);
  for (const l of roadLines()) {
    const d = Math.abs(v - l);
    if (d < bd) { bd = d; best = l; }
  }
  return best;
}

export function buildCity(scene) {
  const rng = mulberry32(20261118);
  const colliders = [];
  const world = {
    colliders,
    roads: roadLines(),
    // Named places missions and shops point at.
    places: {
      safehouse: { x: -150, z: 150, name: 'Safehouse' },
      marina: { x: 180, z: 150, name: 'Marina' },
      docks: { x: 180, z: -150, name: 'Docks' },
      casino: { x: 0, z: -180, name: 'Solmar Casino' },
      airfield: { x: -180, z: -180, name: 'Airfield' },
      bridge: { x: 210, z: 0, name: 'Bridge' },
      warehouse: { x: 120, z: -120, name: 'Warehouse' },
      hospital: { x: -120, z: 60, name: 'Hospital' },
    },
    shops: [],
    palms: [],
  };

  // Sky: warm sunset gradient dome + fog so the far sea melts into the sun.
  const skyGeo = new THREE.SphereGeometry(900, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(PALETTE.skyTop) },
      horizon: { value: new THREE.Color(PALETTE.skyHorizon) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 horizon; void main(){ float h = normalize(vP).y; gl_FragColor = vec4(mix(horizon, top, smoothstep(0.0, 0.55, h)), 1.0); }',
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  scene.fog = new THREE.Fog(PALETTE.fog, 220, 700);

  // Sun + ambient light.
  const sun = new THREE.DirectionalLight(PALETTE.sun, PALETTE.sunIntensity);
  sun.position.set(-160, 190, -120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -260;
  sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260;
  sun.shadow.camera.bottom = -260;
  sun.shadow.camera.far = 700;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 0.85));

  // Ground: one big pavement slab under the city, sand beyond the beach line.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.half * 2 + 40, CITY.half * 2 + 40),
    new THREE.MeshLambertMaterial({ map: pavementTexture(), color: 0xbfb49e }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.beachEnd - CITY.half + 120, CITY.half * 2 + 40),
    new THREE.MeshLambertMaterial({ map: sandTexture() }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set((CITY.half + CITY.beachEnd + 120) / 2 - 20, 0.05, 0);
  sand.receiveShadow = true;
  scene.add(sand);

  // The sea: a big plane that shimmers with a slow sine in the vertex shader.
  const seaMat = new THREE.ShaderMaterial({
    uniforms: { t: { value: 0 } },
    vertexShader: 'uniform float t; varying float vW; void main(){ vec3 p = position; vW = sin(p.x * 0.08 + t * 1.4) * cos(p.y * 0.06 + t); p.z += vW * 0.6; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }',
    fragmentShader: 'varying float vW; void main(){ vec3 deep = vec3(0.05, 0.32, 0.45); vec3 glint = vec3(0.95, 0.65, 0.35); gl_FragColor = vec4(mix(deep, glint, smoothstep(0.4, 1.0, vW) * 0.35), 1.0); }',
  });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(420, 900, 24, 48), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(CITY.beachEnd + 200, 0.1, 0);
  scene.add(sea);
  world.seaMaterial = seaMat;

  // Roads: dark strips along every grid line, both directions.
  const roadMat = new THREE.MeshLambertMaterial({ map: roadTexture() });
  const roadLen = CITY.half * 2 + 20;
  for (const l of roadLines()) {
    const vRoad = new THREE.Mesh(new THREE.PlaneGeometry(CITY.roadWidth, roadLen), roadMat);
    vRoad.rotation.x = -Math.PI / 2;
    vRoad.position.set(l, 0.08, 0);
    vRoad.receiveShadow = true;
    scene.add(vRoad);
    const hRoad = new THREE.Mesh(new THREE.PlaneGeometry(roadLen, CITY.roadWidth), roadMat);
    hRoad.rotation.x = -Math.PI / 2;
    hRoad.position.set(0, 0.08, l);
    hRoad.receiveShadow = true;
    scene.add(hRoad);
  }

  // Buildings: one block per grid cell, 1-3 towers each, pastel facades.
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const facadeMats = PASTEL.map((c, i) => new THREE.MeshLambertMaterial({ map: facadeTexture(c, 100 + i) }));
  const roofMat = new THREE.MeshLambertMaterial({ map: roofTexture('#6b5a4a') });
  const lines = roadLines();
  for (let ix = 0; ix < CITY.blocks - 1; ix++) {
    for (let iz = 0; iz < CITY.blocks - 1; iz++) {
      const cx = (lines[ix] + lines[ix + 1]) / 2;
      const cz = (lines[iz] + lines[iz + 1]) / 2;
      const towers = 1 + Math.floor(rng() * 3);
      for (let t = 0; t < towers; t++) {
        const w = 14 + rng() * 16;
        const d = 14 + rng() * 16;
        const h = 9 + rng() * rng() * 34;
        const ox = (rng() - 0.5) * (CITY.blockSize - w - 4);
        const oz = (rng() - 0.5) * (CITY.blockSize - d - 4);
        const x = cx + ox;
        const z = cz + oz;
        const tower = new THREE.Mesh(boxGeo, facadeMats[Math.floor(rng() * facadeMats.length)]);
        tower.scale.set(w, h, d);
        tower.position.set(x, h / 2, z);
        tower.castShadow = true;
        tower.receiveShadow = true;
        scene.add(tower);
        const roof = new THREE.Mesh(boxGeo, roofMat);
        roof.scale.set(w + 0.6, 0.5, d + 0.6);
        roof.position.set(x, h + 0.25, z);
        scene.add(roof);
        // Rooftop box (AC unit / water tank) for silhouette variety.
        if (rng() < 0.6) {
          const unit = new THREE.Mesh(boxGeo, roofMat);
          unit.scale.set(3 + rng() * 3, 1.5 + rng() * 2, 3 + rng() * 3);
          unit.position.set(x + (rng() - 0.5) * w * 0.5, h + 1.2, z + (rng() - 0.5) * d * 0.5);
          scene.add(unit);
        }
        colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
      }
    }
  }

  // Landmark towers: the Solmar Casino and the Marina hotel, taller than the
  // rest. Each gets its own facade seed from its position, so the two
  // landmarks never share a texture.
  function buildLandmarkTower(x, z, w, h, d, color) {
    const seed = Math.abs(Math.floor(x * 7 + z * 13)) + 5;
    const m = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ map: facadeTexture(color, seed) }));
    m.scale.set(w, h, d);
    m.position.set(x, h / 2, z);
    m.castShadow = true;
    scene.add(m);
    const cap = new THREE.Mesh(boxGeo, roofMat);
    cap.scale.set(w + 0.8, 0.6, d + 0.8);
    cap.position.set(x, h + 0.3, z);
    scene.add(cap);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    return m;
  }
  buildLandmarkTower(0, -180, 34, 52, 26, '#d9a441');
  buildLandmarkTower(180, 150, 26, 44, 22, '#4a6fa5');

  // The bridge at the beach edge: a raised deck on pillars, the getaway
  // route of mission 6. Visual only — the timed step ends at its foot.
  const deckMat = new THREE.MeshLambertMaterial({ color: 0x3a3f46 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(110, 1.2, 16), deckMat);
  deck.position.set(265, 2.2, 0);
  deck.castShadow = true;
  scene.add(deck);
  const railMat = new THREE.MeshLambertMaterial({ color: 0xd9a441 });
  for (const rz of [-7.5, 7.5]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(110, 1, 0.5), railMat);
    rail.position.set(265, 3.4, rz);
    scene.add(rail);
  }
  const pillarGeo = new THREE.CylinderGeometry(1.2, 1.2, 2.4, 8);
  for (const px of [235, 265, 295]) {
    const pillar = new THREE.Mesh(pillarGeo, deckMat);
    pillar.position.set(px, 1.1, 0);
    scene.add(pillar);
  }

  // Beach billboard facing the city: BRISA BAY in sunset colours.
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 11),
    new THREE.MeshBasicMaterial({ map: billboardTexture('BRISA BAY', 'SUN  •  SALT  •  SIN') }),
  );
  board.position.set(226, 7.5, -84);
  board.rotation.y = -Math.PI / 2 - 0.25;
  scene.add(board);
  const boardPost = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 7, 8), deckMat);
  boardPost.position.set(228, 3.5, -84);
  scene.add(boardPost);
  colliders.push({ minX: 222, maxX: 230, minZ: -88, maxZ: -80 });

  // Palm trees along the beach and a few avenues.
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5a38 });
  const frondMat = new THREE.MeshLambertMaterial({ color: 0x3f7a44, side: THREE.DoubleSide });
  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 7, 6);
  const frondGeo = new THREE.ConeGeometry(3.4, 1.6, 7);
  function plantPalm(x, z, s = 1) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 3.5;
    trunk.rotation.z = (rng() - 0.5) * 0.16;
    trunk.castShadow = true;
    const fronds = new THREE.Mesh(frondGeo, frondMat);
    fronds.position.y = 7.4;
    fronds.scale.y = 0.55;
    fronds.castShadow = true;
    g.add(trunk, fronds);
    g.position.set(x, 0, z);
    g.scale.setScalar(s);
    scene.add(g);
    world.palms.push(g);
    colliders.push({ minX: x - 0.6, maxX: x + 0.6, minZ: z - 0.6, maxZ: z + 0.6 });
  }
  for (let z = -200; z <= 200; z += 26) plantPalm(216 + rng() * 8, z, 0.9 + rng() * 0.5);
  for (let x = -180; x <= 180; x += 60) {
    plantPalm(x + 9, -195);
    plantPalm(x - 9, 195);
  }

  // Beach umbrellas: striped cones on poles, scattered on the sand.
  const umbrellaCols = [0xc94f43, 0x2e7d6b, 0xf2c230, 0x4a6fa5];
  const umbrellaPoleMat = new THREE.MeshLambertMaterial({ color: 0x2a2d33 });
  const poleGeoU = new THREE.CylinderGeometry(0.08, 0.08, 2.6, 6);
  const canopyGeo = new THREE.ConeGeometry(2.2, 1.1, 8);
  for (let i = 0; i < 14; i++) {
    const ux = 218 + rng() * 22;
    const uz = -190 + rng() * 380;
    const pole = new THREE.Mesh(poleGeoU, umbrellaPoleMat);
    pole.position.set(ux, 1.3, uz);
    const canopy = new THREE.Mesh(canopyGeo, new THREE.MeshLambertMaterial({ color: umbrellaCols[i % umbrellaCols.length], side: THREE.DoubleSide }));
    canopy.position.set(ux, 3, uz);
    canopy.castShadow = true;
    scene.add(pole, canopy);
  }

  // Street lamps on the main avenues.
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x2a2d33 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe6a8 });
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.12, 6, 6);
  const lampGeo = new THREE.SphereGeometry(0.35, 8, 6);
  for (const l of lines) {
    for (let v = -180; v <= 180; v += 60) {
      for (const [x, z] of [[l + 8, v], [v, l + 8]]) {
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(x, 3, z);
        const lamp = new THREE.Mesh(lampGeo, lampMat);
        lamp.position.set(x, 6.1, z);
        scene.add(pole, lamp);
      }
    }
  }

  // Shops: a sign board + a lit box at each shop corner.
  for (const shop of SHOPS) {
    const [x, z] = shop.pos;
    const boardMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 4),
      new THREE.MeshBasicMaterial({ map: signTexture(shop.name, '#1d2733', '#ffd98a') }),
    );
    boardMesh.position.set(x, 7, z);
    boardMesh.rotation.y = Math.atan2(-x, -z);
    scene.add(boardMesh);
    const box = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0xd8c8a8 }));
    box.scale.set(12, 5, 8);
    box.position.set(x, 2.5, z);
    box.castShadow = true;
    scene.add(box);
    colliders.push({ minX: x - 6, maxX: x + 6, minZ: z - 4, maxZ: z + 4 });
    world.shops.push({ ...shop, x, z });
  }

  // Safehouse: a small beach house with a porch light and a garage door.
  const sh = world.places.safehouse;
  const house = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ map: facadeTexture('#e8b4a0', 5) }));
  house.scale.set(12, 7, 10);
  house.position.set(sh.x, 3.5, sh.z);
  house.castShadow = true;
  scene.add(house);
  const porch = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), lampMat);
  porch.position.set(sh.x + 6.2, 3.4, sh.z);
  scene.add(porch);
  colliders.push({ minX: sh.x - 6, maxX: sh.x + 6, minZ: sh.z - 5, maxZ: sh.z + 5 });

  return world;
}

// Push a circle (x, z, radius) out of every building collider it overlaps.
// Returns true when a push happened. Used by cars and by the player on foot.
export function resolveCircleCollisions(colliders, pos, radius) {
  let hit = false;
  for (const c of colliders) {
    const nx = Math.max(c.minX, Math.min(pos.x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
    const dx = pos.x - nx;
    const dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      hit = true;
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        pos.x = nx + (dx / d) * radius;
        pos.z = nz + (dz / d) * radius;
      } else {
        // Centre inside the box: shove out along the smallest penetration.
        const pl = pos.x - c.minX;
        const pr = c.maxX - pos.x;
        const pt = pos.z - c.minZ;
        const pb = c.maxZ - pos.z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) pos.x = c.minX - radius;
        else if (m === pr) pos.x = c.maxX + radius;
        else if (m === pt) pos.z = c.minZ - radius;
        else pos.z = c.maxZ + radius;
      }
    }
  }
  return hit;
}
