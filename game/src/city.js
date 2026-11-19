// BRISA BAY — the city: roads, buildings, beach, sea, palms, lamps,
// billboards, bridge. One seed, so the map is identical every run.
// Facades per storey, lit windows, parapets, varied roofs; ground detail
// (crosswalks, plazas, kerbs, wet sand). The building loop consumes its
// seeded rng in exactly the earlier order — no new rng() calls inside it.
import * as THREE from 'three';
import { CITY, PALETTE, SHOPS, BUS_STOPS, VENDORS, GANGS } from './config.js';
import { mulberry32, pick } from './utils.js';
import { facadeTexture, roadTexture, pavementTexture, sandTexture, signTexture, billboardTexture, roofTexture, glowTexture, neonSignTexture, crosswalkTexture, plazaTexture, kerbTexture, wetSandTexture } from './textures.js';

// Warm pastel stucco for the city blocks.
const PASTEL = ['#e8b4a0', '#f2d5a0', '#a8c8b8', '#d98a7a', '#9fb8cc', '#e5c8d8', '#c8b8a0', '#f0e0c0'];
// Roof colours, varied per tower so the skyline is not one brown slab.
const ROOF_COLS = ['#6b5a4a', '#8a6b52', '#5a6b7a', '#7a4a3a'];
// The four central intersections get plaza tiles instead of a crosswalk.
export const PLAZA_SPOTS = [[0, 0], [0, 60], [60, 0], [60, 60]];

// Match a facade's painted storeys and window columns to a building's
// real size: short towers get 3 storeys, mid ones 5, tall ones 8; narrow
// towers 4 columns, wide ones 6. Pure function, so the logic tests can
// pin the buckets without building the city.
export function facadeBucket(h, w) {
  return {
    floors: h < 14 ? 3 : h < 28 ? 5 : 8,
    cols: w < 20 ? 4 : 6,
  };
}

// Facade materials, cached by (pastel, seed, floors, cols): towers that
// share a bucket share one material, so the texture count stays bounded
// while every tower shows the right number of storeys. The material's
// emissive map makes its lit windows glow at sunset.
const facadeCache = new Map();
function facadeMaterial(base, seed, floors, cols) {
  const key = base + '|' + seed + '|' + floors + '|' + cols;
  let m = facadeCache.get(key);
  if (!m) {
    const t = facadeTexture(base, seed, floors, cols);
    m = new THREE.MeshStandardMaterial({ 
      map: t.map, 
      roughnessMap: t.roughnessMap,
      metalnessMap: t.metalnessMap,
      normalMap: t.normalMap,
      emissive: 0xffb45e, 
      emissiveIntensity: 0.85, 
      emissiveMap: t.emissiveMap 
    });
    facadeCache.set(key, m);
  }
  return m;
}

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
  const v5counts = { towers: 0, parapets: 0, crosswalks: 0, plazas: 0, kerbs: 0, clouds: 0, halos: 0, roofColorsUsed: 0 };
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
    lighthouseBeam: null,
    // Bus stops and vendor stalls, built below from config.
    busStops: [],
    vendorSpots: [],
    // Time-of-day references
    sun: null,
    skyMaterial: null,
    hemiLight: null,
    sunDisc: null,
    sunGlow: null,
    seaMaterial: null,
    // How much of the new graphics actually got built (logic tests).
    v5counts,
  };

  // Sky: three-stop sunset dome (orange horizon, rose mid, deep blue top)
  // + fog so the far sea melts into the sun.
  const skyGeo = new THREE.SphereGeometry(900, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(PALETTE.skyTop) },
      mid: { value: new THREE.Color(0xe86a7a) },
      horizon: { value: new THREE.Color(PALETTE.skyHorizon) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; void main(){ float h = normalize(vP).y; vec3 c = mix(horizon, mid, smoothstep(0.0, 0.28, h)); c = mix(c, top, smoothstep(0.22, 0.6, h)); gl_FragColor = vec4(c, 1.0); }',
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  scene.fog = new THREE.Fog(PALETTE.fog, 220, 700);

  // Sun + ambient light. The graphics round deepens the contrast: a
  // hotter sun, a dimmer hemisphere, so the shadows bite and the lit
  // windows read.
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
  world.sun = sun;
  const hemi = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 0.7);
  scene.add(hemi);
  world.hemiLight = hemi;
  world.skyMaterial = skyMat;

  // The sun itself, low in the west, with a halo that bleeds into the
  // haze. The disc sits on the sky dome so it reads in every wide shot.
  const sunDir = new THREE.Vector3(-160, 190, -120).normalize();
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(34, 24),
    new THREE.MeshBasicMaterial({ color: 0xffe9b8, fog: false }),
  );
  sunDisc.position.copy(sunDir).multiplyScalar(830);
  sunDisc.lookAt(0, 0, 0);
  scene.add(sunDisc);
  const sunGlowTex = glowTexture();
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sunGlowTex, color: 0xffc27a, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  sunGlow.position.copy(sunDir).multiplyScalar(820);
  sunGlow.scale.setScalar(260);
  scene.add(sunGlow);
  world.sunDisc = sunDisc;
  world.sunGlow = sunGlow;

  // Low warm clouds, so the sky has depth instead of a flat gradient.
  // A fresh seeded stream — the shared rng is untouched, the city layout
  // cannot shift under them.
  const cloudRng = mulberry32(20261119);
  for (let i = 0; i < 8; i++) {
    const cloud = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunGlowTex, color: 0xffe8cc, transparent: true,
      opacity: 0.30 + cloudRng() * 0.15, depthWrite: false, fog: false,
    }));
    cloud.position.set(-500 + cloudRng() * 1100, 200 + cloudRng() * 110, -500 + cloudRng() * 1000);
    cloud.scale.set(160 + cloudRng() * 120, 55 + cloudRng() * 35, 1);
    cloud.userData.v5kind = 'cloud';
    scene.add(cloud);
    v5counts.clouds++;
  }

  // Ground slab + sand beyond the beach.
  const pavementTex = pavementTexture();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.half * 2 + 40, CITY.half * 2 + 40),
    new THREE.MeshStandardMaterial({ 
      map: pavementTex.map, 
      roughnessMap: pavementTex.roughnessMap,
      metalnessMap: pavementTex.metalnessMap,
      normalMap: pavementTex.normalMap,
      color: 0xbfb49e 
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Dark outer apron under everything, so no void shows past the city edge.
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 2400),
    new THREE.MeshStandardMaterial({ color: 0x3d3226, roughness: 0.9 }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.05;
  scene.add(apron);

  const sandTex = sandTexture();
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.beachEnd - CITY.half + 120, CITY.half * 2 + 40),
    new THREE.MeshStandardMaterial({ 
      map: sandTex.map, 
      roughnessMap: sandTex.roughnessMap,
      metalnessMap: sandTex.metalnessMap,
      normalMap: sandTex.normalMap
    }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set((CITY.half + CITY.beachEnd + 120) / 2 - 20, 0.05, 0);
  sand.receiveShadow = true;
  scene.add(sand);

  // A wet-sand band along the waterline, darker than the dry beach.
  const wetSandTex = wetSandTexture();
  const wetSand = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.beachEnd - CITY.half, CITY.half * 2 + 40),
    new THREE.MeshStandardMaterial({ 
      map: wetSandTex.map, 
      roughnessMap: wetSandTex.roughnessMap,
      metalnessMap: wetSandTex.metalnessMap,
      normalMap: wetSandTex.normalMap
    }),
  );
  wetSand.rotation.x = -Math.PI / 2;
  wetSand.position.set((CITY.half + CITY.beachEnd) / 2, 0.06, 0);
  wetSand.receiveShadow = true;
  wetSand.userData.v5kind = 'wetSand';
  scene.add(wetSand);

  // The sea: a big plane that shimmers with a slow sine in the vertex
  // shader. A white foam edge where the water meets the sand and a
  // sun-glitter band that sparkles as the waves roll.
  const seaMat = new THREE.ShaderMaterial({
    uniforms: { t: { value: 0 } },
    vertexShader: 'uniform float t; varying float vW; varying float vX; void main(){ vec3 p = position; vW = sin(p.x * 0.08 + t * 1.4) * cos(p.y * 0.06 + t); vX = p.x; p.z += vW * 0.6; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }',
    fragmentShader: 'varying float vW; varying float vX; void main(){ vec3 deep = vec3(0.05, 0.32, 0.45); vec3 glint = vec3(0.95, 0.65, 0.35); float sparkle = smoothstep(0.55, 1.0, vW) * 0.45; float foam = (1.0 - smoothstep(-210.0, -195.0, vX)) * 0.85; vec3 c = mix(deep, glint, smoothstep(0.4, 1.0, vW) * 0.35 + sparkle); c = mix(c, vec3(0.9, 0.95, 0.9), foam); gl_FragColor = vec4(c, 1.0); }',
  });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(420, 900, 24, 48), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(CITY.beachEnd + 200, 0.1, 0);
  scene.add(sea);
  world.seaMaterial = seaMat;

  // Roads: dark strips along every grid line, both directions.
  const roadTex = roadTexture();
  const roadMat = new THREE.MeshStandardMaterial({ 
    map: roadTex.map, 
    roughnessMap: roadTex.roughnessMap,
    metalnessMap: roadTex.metalnessMap,
    normalMap: roadTex.normalMap
  });
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

  // Kerb strips along every road edge, so the asphalt ends in a kerb
  // instead of melting into the pavement. The two axes sit at different
  // heights (0.09 / 0.095) so they never z-fight where they cross.
  const kerbTex = kerbTexture();
  const kerbMat = new THREE.MeshStandardMaterial({ 
    map: kerbTex.map, 
    roughnessMap: kerbTex.roughnessMap,
    metalnessMap: kerbTex.metalnessMap,
    normalMap: kerbTex.normalMap
  });
  const kerbGeoZ = new THREE.PlaneGeometry(1.2, roadLen);
  const kerbGeoX = new THREE.PlaneGeometry(roadLen, 1.2);
  for (const l of roadLines()) {
    for (const off of [-7.6, 7.6]) {
      const kz = new THREE.Mesh(kerbGeoZ, kerbMat);
      kz.rotation.x = -Math.PI / 2;
      kz.position.set(l + off, 0.09, 0);
      kz.receiveShadow = true;
      kz.userData.v5kind = 'kerb';
      scene.add(kz);
      v5counts.kerbs++;
      const kx = new THREE.Mesh(kerbGeoX, kerbMat);
      kx.rotation.x = -Math.PI / 2;
      kx.position.set(0, 0.095, l + off);
      kx.receiveShadow = true;
      kx.userData.v5kind = 'kerb';
      scene.add(kx);
      v5counts.kerbs++;
    }
  }

  // A zebra crossing on every intersection, plaza tiles on the four
  // central ones instead. One shared geometry and material each.
  const crossGeo = new THREE.PlaneGeometry(CITY.roadWidth, CITY.roadWidth);
  const crossTex = crosswalkTexture();
  const crossMat = new THREE.MeshStandardMaterial({ 
    map: crossTex.map, 
    roughnessMap: crossTex.roughnessMap,
    metalnessMap: crossTex.metalnessMap,
    normalMap: crossTex.normalMap
  });
  const plazaTex = plazaTexture();
  const plazaMat = new THREE.MeshStandardMaterial({ 
    map: plazaTex.map, 
    roughnessMap: plazaTex.roughnessMap,
    metalnessMap: plazaTex.metalnessMap,
    normalMap: plazaTex.normalMap
  });
  const plazaGeo = new THREE.PlaneGeometry(16, 16);
  const lines = roadLines();
  lines.forEach((lx, ix) => {
    lines.forEach((lz, iz) => {
      if (PLAZA_SPOTS.some(([px, pz]) => px === lx && pz === lz)) {
        const plaza = new THREE.Mesh(plazaGeo, plazaMat);
        plaza.rotation.x = -Math.PI / 2;
        plaza.position.set(lx, 0.1, lz);
        plaza.receiveShadow = true;
        plaza.userData.v5kind = 'plaza';
        scene.add(plaza);
        v5counts.plazas++;
        return;
      }
      const cross = new THREE.Mesh(crossGeo, crossMat);
      cross.rotation.x = -Math.PI / 2;
      // Alternate the stripe direction so the grid does not repeat one way.
      cross.rotation.z = (ix + iz) % 2 === 0 ? 0 : Math.PI / 2;
      cross.position.set(lx, 0.1, lz);
      cross.receiveShadow = true;
      cross.userData.v5kind = 'crosswalk';
      scene.add(cross);
      v5counts.crosswalks++;
    });
  });

  // Buildings: one block per grid cell, 1-3 towers each, pastel facades.
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const roofMats = ROOF_COLS.map((c) => {
    const rt = roofTexture(c);
    return new THREE.MeshStandardMaterial({ 
      map: rt.map, 
      roughnessMap: rt.roughnessMap,
      metalnessMap: rt.metalnessMap,
      normalMap: rt.normalMap
    });
  });
  const parapetMat = new THREE.MeshStandardMaterial({ color: 0x4a3f35, roughness: 0.8 });
  const roofUsed = new Set();
  for (let ix = 0; ix < CITY.blocks - 1; ix++) {
    for (let iz = 0; iz < CITY.blocks - 1; iz++) {
      const cx = (lines[ix] + lines[ix + 1]) / 2;
      const cz = (lines[iz] + lines[iz + 1]) / 2;
      const towers = 1 + Math.floor(rng() * 3);
      // The safehouse lives in this cell (ix 0, iz 5). Seeded towers
      // here buried it — and with it the first mission's target, the
      // player spawn and an armour pickup, all unreachable. Only the
      // scene adds and the collider are skipped for this cell; the meshes
      // are still built and the rng is still consumed exactly as before,
      // so every other cell keeps its earlier layout.
      const skipCell = ix === 0 && iz === 5;
      for (let t = 0; t < towers; t++) {
        const w = 14 + rng() * 16;
        const d = 14 + rng() * 16;
        const h = 9 + rng() * rng() * 34;
        const ox = (rng() - 0.5) * (CITY.blockSize - w - 4);
        const oz = (rng() - 0.5) * (CITY.blockSize - d - 4);
        const x = cx + ox;
        const z = cz + oz;
        const pi = Math.floor(rng() * PASTEL.length);
        // The facade's storeys and columns match this tower's size,
        // and the roof colour is picked from the cell — deterministic, so
        // the shared rng stream is untouched and the layout cannot shift.
        const { floors, cols } = facadeBucket(h, w);
        const tower = new THREE.Mesh(boxGeo, facadeMaterial(PASTEL[pi], 100 + pi, floors, cols));
        tower.scale.set(w, h, d);
        tower.position.set(x, h / 2, z);
        tower.castShadow = true;
        tower.receiveShadow = true;
        tower.userData.v5kind = 'facade';
        if (!skipCell) scene.add(tower);
        v5counts.towers++;
        const roofIdx = (ix * 7 + iz * 3 + t) % roofMats.length;
        roofUsed.add(roofIdx);
        const roof = new THREE.Mesh(boxGeo, roofMats[roofIdx]);
        roof.scale.set(w + 0.6, 0.5, d + 0.6);
        roof.position.set(x, h + 1.15, z);
        roof.userData.v5kind = 'roof';
        if (!skipCell) scene.add(roof);
        // A parapet rim around the roof edge, so the tower reads as a
        // building with a roof instead of a flat-topped box.
        const rim = new THREE.Mesh(boxGeo, parapetMat);
        rim.scale.set(w + 0.8, 0.9, d + 0.8);
        rim.position.set(x, h + 0.45, z);
        rim.userData.v5kind = 'parapet';
        if (!skipCell) scene.add(rim);
        v5counts.parapets++;
        // Rooftop box (AC unit / water tank) for silhouette variety.
        if (rng() < 0.6) {
          const unit = new THREE.Mesh(boxGeo, roofMats[roofIdx]);
          unit.scale.set(3 + rng() * 3, 1.5 + rng() * 2, 3 + rng() * 3);
          unit.position.set(x + (rng() - 0.5) * w * 0.5, h + 2.0, z + (rng() - 0.5) * d * 0.5);
          if (!skipCell) scene.add(unit);
        }
        if (!skipCell) colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
      }
    }
  }
  v5counts.roofColorsUsed = roofUsed.size;

  // Landmark towers (Solmar Casino, Marina hotel): own facade seeds, so
  // the two never share a texture. Casino sits on (0,-180) — see Mission 8.
  function buildLandmarkTower(x, z, w, h, d, color) {
    const seed = Math.abs(Math.floor(x * 7 + z * 13)) + 5;
    const { floors, cols } = facadeBucket(h, w);
    const m = new THREE.Mesh(boxGeo, facadeMaterial(color, seed, floors, cols));
    m.scale.set(w, h, d);
    m.position.set(x, h / 2, z);
    m.castShadow = true;
    m.userData.v5kind = 'facade';
    scene.add(m);
    v5counts.towers++;
    const rim = new THREE.Mesh(boxGeo, parapetMat);
    rim.scale.set(w + 0.8, 0.9, d + 0.8);
    rim.position.set(x, h + 0.45, z);
    rim.userData.v5kind = 'parapet';
    scene.add(rim);
    v5counts.parapets++;
    const cap = new THREE.Mesh(boxGeo, roofMats[seed % roofMats.length]);
    cap.scale.set(w + 0.8, 0.6, d + 0.8);
    cap.position.set(x, h + 1.15, z);
    cap.userData.v5kind = 'roof';
    scene.add(cap);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    return m;
  }
  buildLandmarkTower(0, -180, 34, 52, 26, '#d9a441');
  buildLandmarkTower(180, 150, 26, 44, 22, '#4a6fa5');

  // The bridge at the beach edge: a raised deck on pillars, the getaway
  // route of mission 6. Visual only — the timed step ends at its foot.
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.7 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(110, 1.2, 16), deckMat);
  deck.position.set(265, 2.2, 0);
  deck.castShadow = true;
  scene.add(deck);
  const railMat = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.5, metalness: 0.3 });
  for (const rz of [-7.5, 7.5]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(110, 1, 0.5), railMat);
    rail.position.set(265, 3.4, rz);
    scene.add(rail);
  }
  const pillarGeo = new THREE.CylinderGeometry(1.2, 1.2, 2.4, 8);
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.7 });
  for (const px of [235, 265, 295]) {
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.set(px, 1.1, 0);
    scene.add(pillar);
    colliders.push({ minX: px - 1.3, maxX: px + 1.3, minZ: -1.3, maxZ: 1.3 });
  }

  // The pier — a wooden walkway out into the sea at the south beach,
  // with posts and a lamp at the far end. Cars stop at its foot.
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x8a6b46, roughness: 0.85 });
  const pierDeck = new THREE.Mesh(new THREE.BoxGeometry(44, 0.8, 6), pierMat);
  pierDeck.position.set(274, 1.4, -40);
  pierDeck.castShadow = true;
  scene.add(pierDeck);
  const pierPostGeo = new THREE.CylinderGeometry(0.4, 0.4, 2.8, 6);
  for (const px of [256, 268, 280, 292]) {
    for (const pz of [-42.5, -37.5]) {
      const post = new THREE.Mesh(pierPostGeo, pierMat);
      post.position.set(px, 0.7, pz);
      scene.add(post);
    }
  }
  const pierLamp = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe6a8 }));
  pierLamp.position.set(294, 3.4, -40);
  scene.add(pierLamp);
  const pierLampPost = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.2, 6), deckMat);
  pierLampPost.position.set(294, 1.7, -40);
  scene.add(pierLampPost);
  colliders.push({ minX: 252, maxX: 296, minZ: -43, maxZ: -37 });

  // The lighthouse at the north end of the beach — a striped tower with
  // a lamp room and a beam that sweeps the bay. The beam group is exposed
  // on `world` so the game loop can rotate it.
  const lh = new THREE.Group();
  const lhWhite = new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.6 });
  const lhRed = new THREE.MeshStandardMaterial({ color: 0xc22e2e, roughness: 0.7 });
  const lhTopMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5 });
  const lhBase = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4, 22, 12), lhWhite);
  lhBase.position.y = 11;
  lhBase.castShadow = true;
  const lhBand = new THREE.Mesh(new THREE.CylinderGeometry(3.45, 3.6, 4, 12), lhRed);
  lhBand.position.y = 14;
  const lhTop = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 3.4, 10), lhTopMat);
  lhTop.position.y = 23.5;
  const lhLamp = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
  lhLamp.position.y = 23.5;
  lh.add(lhBase, lhBand, lhTop, lhLamp);
  const lhGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sunGlowTex, color: 0xffe6a8, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  lhGlow.position.y = 23.5;
  lhGlow.scale.setScalar(14);
  lh.add(lhGlow);
  lh.position.set(246, 0, 100);
  scene.add(lh);
  const beamGeo = new THREE.ConeGeometry(3.2, 55, 12, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xfff2c0, transparent: true, opacity: 0.14,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.rotation.z = Math.PI / 2;
  beam.position.x = 27.5;
  const beamPivot = new THREE.Group();
  beamPivot.position.set(246, 23.5, 100);
  beamPivot.add(beam);
  scene.add(beamPivot);
  world.lighthouseBeam = beamPivot;
  colliders.push({ minX: 242, maxX: 250, minZ: 96, maxZ: 104 });

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

  // Two more billboards — the casino's WIN BIG sign by the north road,
  // and a marina board facing the beach.
  const board2 = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 11),
    new THREE.MeshBasicMaterial({ map: billboardTexture('SOLMAR', 'WIN BIG TONIGHT') }),
  );
  board2.position.set(-46, 7.5, -168);
  board2.rotation.y = 0.35;
  scene.add(board2);
  const board2Post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 7, 8), deckMat);
  board2Post.position.set(-46, 3.5, -168);
  scene.add(board2Post);
  colliders.push({ minX: -50, maxX: -42, minZ: -172, maxZ: -164 });
  const board3 = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 9),
    new THREE.MeshBasicMaterial({ map: neonSignTexture(['MARINA', 'BOATS  •  FISH  •  SUN'], '#4fd8ff') }),
  );
  board3.position.set(196, 7, 96);
  board3.rotation.y = -Math.PI / 2;
  scene.add(board3);
  const board3Post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 7, 8), deckMat);
  board3Post.position.set(198, 3.5, 96);
  scene.add(board3Post);
  colliders.push({ minX: 192, maxX: 200, minZ: 92, maxZ: 100 });
  // A glow halo behind the marina neon, so the sign reads as a tube
  // of light instead of a flat picture.
  const board3Halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sunGlowTex, color: 0x4fd8ff, transparent: true, opacity: 0.45,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  board3Halo.position.set(196.4, 7, 96);
  board3Halo.scale.setScalar(12);
  board3Halo.userData.v5kind = 'neonHalo';
  scene.add(board3Halo);
  v5counts.halos++;

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
  // A palm cluster around the pier, so the south beach is not bare.
  for (let i = 0; i < 6; i++) plantPalm(220 + rng() * 14, -70 + rng() * 60, 0.9 + rng() * 0.4);

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
    colliders.push({ minX: ux - 0.3, maxX: ux + 0.3, minZ: uz - 0.3, maxZ: uz + 0.3 });
  }

  // Street lamps: warm glow on every third lamp.
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.8 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe6a8 });
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.12, 6, 6);
  const lampGeo = new THREE.SphereGeometry(0.35, 8, 6);
  const lampGlowMat = new THREE.SpriteMaterial({
    map: sunGlowTex, color: 0xffd9a0, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  let lampIndex = 0;
  for (const l of lines) {
    for (let v = -180; v <= 180; v += 60) {
      // Lamps sit on the inner corner of each intersection, 8 m from
      // both road lines — 1 m off the asphalt. The old spots sat ON a
      // road line, which only showed once lamps got colliders: cars
      // wedged against them (the race rivals stopped dead at (-180, 68)).
      const off = v < 0 ? 8 : -8;
      for (const [x, z] of [[l + 8, v + off], [v + off, l + 8]]) {
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(x, 3, z);
        const lamp = new THREE.Mesh(lampGeo, lampMat);
        lamp.position.set(x, 6.1, z);
        scene.add(pole, lamp);
        colliders.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3 });
        if (lampIndex % 3 === 0) {
          const glow = new THREE.Sprite(lampGlowMat);
          glow.position.set(x, 6.1, z);
          glow.scale.setScalar(5);
          scene.add(glow);
        }
        lampIndex++;
      }
    }
  }

  // Shops: a sign board + a lit box at each shop corner. A neon tube
  // sign hangs under the board, so each shop glows in its own colour.
  // A real awning over the shopfront, a lit window, and a glow halo
  // behind the neon — the shopfront gets depth instead of a flat box.
  const neonColors = { guns: '#ff4fd8', garage: '#4fd8ff', food: '#ffb84f' };
  const awningColors = { guns: 0xc94f43, garage: 0x4fd8ff, food: 0xf2a007 };
  for (const shop of SHOPS) {
    const [x, z] = shop.pos;
    const boardMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 4),
      new THREE.MeshBasicMaterial({ map: signTexture(shop.name, '#1d2733', '#ffd98a') }),
    );
    boardMesh.position.set(x, 7, z);
    boardMesh.rotation.y = Math.atan2(-x, -z);
    scene.add(boardMesh);
    const neon = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 2.25),
      new THREE.MeshBasicMaterial({ map: neonSignTexture([shop.name], neonColors[shop.kind] || '#ff4fd8') }),
    );
    neon.position.set(x, 4.4, z);
    neon.rotation.y = Math.atan2(-x, -z);
    scene.add(neon);
    const shopBoxMat = new THREE.MeshStandardMaterial({ color: 0xd8c8a8, roughness: 0.7 });
    const box = new THREE.Mesh(boxGeo, shopBoxMat);
    box.scale.set(12, 5, 8);
    box.position.set(x, 2.5, z);
    box.castShadow = true;
    scene.add(box);
    // The shopfront faces the city centre: the awning, the lit window
    // and the halo all sit on that side of the box.
    const dirX = -x / Math.hypot(x, z);
    const dirZ = -z / Math.hypot(x, z);
    const awningMat = new THREE.MeshStandardMaterial({ color: awningColors[shop.kind] || 0xc94f43, roughness: 0.6 });
    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(10, 0.15, 3),
      awningMat,
    );
    awning.rotation.order = 'YXZ';
    awning.rotation.y = Math.atan2(-x, -z);
    awning.rotation.x = -0.45;
    awning.position.set(x + dirX * 4.6, 3.7, z + dirZ * 4.6);
    awning.castShadow = true;
    awning.userData.v5kind = 'awning';
    scene.add(awning);
    const shopGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 2.4),
      new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.85 }),
    );
    shopGlow.position.set(x + dirX * 4.05, 2.2, z + dirZ * 4.05);
    shopGlow.rotation.y = Math.atan2(-x, -z);
    shopGlow.userData.v5kind = 'shopGlow';
    scene.add(shopGlow);
    const neonHalo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunGlowTex, color: new THREE.Color(neonColors[shop.kind] || '#ff4fd8'),
      transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    neonHalo.position.set(x - dirX * 0.4, 4.4, z - dirZ * 0.4);
    neonHalo.scale.setScalar(14);
    neonHalo.userData.v5kind = 'neonHalo';
    scene.add(neonHalo);
    v5counts.halos++;
    colliders.push({ minX: x - 6, maxX: x + 6, minZ: z - 4, maxZ: z + 4 });
    world.shops.push({ ...shop, x, z });
  }

  // Gang hideouts: a gang-coloured sign at each turf centre.
  for (const g of GANGS) {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 2.5),
      new THREE.MeshBasicMaterial({ map: signTexture(g.name, '#1d2733', '#' + g.color.toString(16).padStart(6, '0')) }),
    );
    sign.position.set(g.hx, 5, g.hz);
    sign.rotation.y = Math.atan2(-g.hx, -g.hz);
    sign.userData.v5kind = 'gangSign';
    scene.add(sign);
    const post = new THREE.Mesh(poleGeo, poleMat);
    post.position.set(g.hx, 2.5, g.hz);
    scene.add(post);
  }

  // Safehouse: a small beach house with a porch light and a garage door.
  const sh = world.places.safehouse;
  const house = new THREE.Mesh(boxGeo, facadeMaterial('#e8b4a0', 5, 3, 4));
  house.scale.set(12, 7, 10);
  house.position.set(sh.x, 3.5, sh.z);
  house.castShadow = true;
  house.userData.v5kind = 'facade';
  scene.add(house);
  v5counts.towers++;
  const houseRim = new THREE.Mesh(boxGeo, parapetMat);
  houseRim.scale.set(12.8, 0.9, 10.8);
  houseRim.position.set(sh.x, 7.45, sh.z);
  houseRim.userData.v5kind = 'parapet';
  scene.add(houseRim);
  v5counts.parapets++;
  const porch = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), lampMat);
  porch.position.set(sh.x + 6.2, 3.4, sh.z);
  scene.add(porch);
  const porchGlow = new THREE.Sprite(lampGlowMat);
  porchGlow.position.set(sh.x + 6.2, 3.4, sh.z);
  porchGlow.scale.setScalar(4);
  scene.add(porchGlow);
  colliders.push({ minX: sh.x - 6, maxX: sh.x + 6, minZ: sh.z - 5, maxZ: sh.z + 5 });

  // Bus stops — a sign board, a bench and a pole at each stop, so a
  // waiting passenger reads from down the street. The sign faces the
  // road; the bench sits 9 m off the line, where the waiters stand.
  for (const stop of BUS_STOPS) {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(4.5, 2.2),
      new THREE.MeshBasicMaterial({ map: signTexture('BUS', '#1d2733', '#4fd8ff') }),
    );
    sign.position.set(stop.x + 9, 3.4, stop.z);
    sign.rotation.y = Math.atan2(-(stop.x + 9), -stop.z);
    scene.add(sign);
    const stopPole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.4, 6), deckMat);
    stopPole.position.set(stop.x + 9, 1.7, stop.z);
    scene.add(stopPole);
    const benchMat = new THREE.MeshStandardMaterial({ color: 0x8a6b46, roughness: 0.8 });
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 0.9), benchMat);
    bench.position.set(stop.x + 9, 0.6, stop.z + 1.6);
    bench.castShadow = true;
    scene.add(bench);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x8a6b46, roughness: 0.8 });
    for (const bx of [-1.1, 1.1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.6, 0.8), legMat);
      leg.position.set(stop.x + 9 + bx, 0.3, stop.z + 1.6);
      scene.add(leg);
    }
    colliders.push({ minX: stop.x + 9 - 1.4, maxX: stop.x + 9 + 1.4, minZ: stop.z + 1.1, maxZ: stop.z + 2.1 });
    colliders.push({ minX: stop.x + 9 - 0.2, maxX: stop.x + 9 + 0.2, minZ: stop.z - 0.2, maxZ: stop.z + 0.2 });
    world.busStops.push({ ...stop, waitX: stop.x + 9, waitZ: stop.z });
  }

  // Vendor stalls — a counter, a bright striped canopy and a name
  // board. The stall itself is a small collider so cars cannot drive
  // through the flowers; the vendor ped stands behind it.
  const vendorCounterMat = new THREE.MeshStandardMaterial({ color: 0x8a6b46, roughness: 0.8 });
  const vendorCanopyMat = new THREE.MeshStandardMaterial({ color: 0x8a6b46, roughness: 0.7 }); // color overridden per vendor
  for (const v of VENDORS) {
    const counter = new THREE.Mesh(boxGeo, vendorCounterMat);
    counter.scale.set(3.2, 1.1, 1.6);
    counter.position.set(v.x, 0.55, v.z);
    counter.castShadow = true;
    scene.add(counter);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.18, 2.4), vendorCanopyMat.clone());
    canopy.material.color.set(v.color);
    canopy.position.set(v.x, 2.6, v.z);
    canopy.castShadow = true;
    scene.add(canopy);
    for (const px of [-1.7, 1.7]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.6, 6), deckMat);
      post.position.set(v.x + px, 1.3, v.z);
      scene.add(post);
    }
    const vSign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 1.1),
      new THREE.MeshBasicMaterial({ map: signTexture(v.name, '#1d2733', '#ffd98a') }),
    );
    vSign.position.set(v.x, 3.4, v.z);
    vSign.rotation.y = Math.atan2(-v.x, -v.z);
    scene.add(vSign);
    colliders.push({ minX: v.x - 1.7, maxX: v.x + 1.7, minZ: v.z - 0.9, maxZ: v.z + 0.9 });
    world.vendorSpots.push({ ...v });
  }

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
