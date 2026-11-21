// BRISA BAY — screenshot staging. `?shot=menu|foot|chase|mission` drops the
// game straight into a composed scene so a screenshot shows the systems at
// their best, with no menu in the way — except `menu`, which stages the v8
// start screen itself (story, controls, Continue / New Game buttons).
// `?shot=garage` opens the garage shop for a verification shot. The race
// shot is the Grand Prix cover, taxi shows a fare offer with passenger and
// amber beacon in frame, packages shows Rio on foot beside a gold
// collectible parcel, and street is the busy-city cover: Rio on a Moto
// weaving toward a dwelling bus. Used only for the entry's screenshots and
// for testing the new systems.
import * as THREE from 'three';
import { signTexture, glowTexture } from './textures.js';
import { GANGS } from './config.js';
export function shotParam() {
  const q = new URLSearchParams(location.search);
  return q.get('shot');
}

// Put `count` BCPD cars on the street at once, with the helicopter up.
// (The live police manager paces spawns at one per 2.5s, so staging through
// update() could only ever show a single car in the frame.) At four stars
// the update tick also sets a roadblock across the road ahead of Rio.
function stagePolice(g, count, wanted = 3) {
  g.setWanted(wanted);
  for (let i = 0; i < count; i++) {
    // Point each unit at Rio so the chase reads in the frame.
    const car = g.police.spawnOne(g.player.pos);
    car.heading = Math.atan2(g.player.pos.x - car.pos.x, g.player.pos.z - car.pos.z);
    car.syncMesh();
  }
  // One update tick brings the helicopter in (wanted >= 3) and the
  // roadblocks in (wanted >= 4).
  g.police.update(0.1, wanted, g.player.pos, true, g.allCars(), g.player.heading);
}

// Place the game into a staged scene. Called once after boot, before the
// first frame the screenshot captures.
export function stageShot(game, shot) {
  const g = game;
  if (shot === 'menu') {
    g.showStartScreen();
    return;
  }
  // All gameplay shots skip the menu.
  g.state = 'playing';
  g.hud.hideMenu();
  g.audio.ensure();
  if (shot === 'foot') {
    // Rio on foot by the hospital, the green health pickup glowing beside
    // him, traffic and pedestrians around.
    g.player.pos.set(-118, 0, 62);
    g.player.heading = -0.25; // facing the pickup at (-120, 70)
    g.player.camYaw = -0.25 + Math.PI;
    g.traffic.spawn(10, { x: -30, z: 30 }, 120);
    g.peds.spawn(14, { x: -30, z: 30 }, 90);
    g.missions.startMission(0);
    g.player.camDist = 8;
  } else if (shot === 'boat') {
    // Boat gameplay: Jay throttles a marina boat across the bay toward
    // a delivery beacon, the city skyline and lighthouse ahead. Staged
    // directly, not via M17: the mission would need a 120 s drive.
    // (Same ~0.15s rule as the chase shot: stage it, don't drive it.)
    const boat = g.boats[1] || g.boats[0];
    g.enterCar(boat);
    boat.pos.set(420, 0.1, 140);
    boat.heading = -Math.PI / 2; // west, toward the marina skyline
    boat.speed = 18;
    boat.syncMesh();
    g.player.pos.copy(boat.pos); // see chase: staging reads player.pos
    g.player.heading = boat.heading;
    g.player.camYaw = boat.heading + Math.PI; // see chase: no mid-swing camera
    g.keys.KeyW = true;
    g.missions.placeMarker(300, 140); // dead ahead, in frame with the marina
    document.getElementById('mission-box')?.classList.add('collapsed');
    g.player.camDist = 11;
  } else if (shot === 'chase') {
    // Driving fast with a 4-star wanted level: two BCPD cars, the heli,
    // and a roadblock across the road ahead. The cover shot.
    // Staging notes, learned the hard way: a headless capture only ever
    // runs ~0.15s of game time after staging, whatever the virtual-time
    // budget says — so the composition is staged directly, not driven
    // into. The Furia starts already at speed, already far down the
    // road, with the blocks ahead of it. (Earlier takes staged it at
    // 16 m/s and waited for it to drive to the block; it never got
    // there, and the seeded police rng kept ramming it at 22m instead.)
    const car = g.spawnCar('furia', 0xf2c230, -10, 60, Math.PI / 2);
    g.enterCar(car);
    car.speed = 30;
    // enterCar does not move Rio to the car — his pos stays at the spawn
    // point until the first update frame copies it. Every staging call
    // below (stagePolice, the roadblocks, the flank spots) reads
    // g.player.pos, so sync it here or the blocks land by the safehouse.
    g.player.pos.copy(car.pos);
    g.player.heading = car.heading;
    // Point the chase camera behind the car NOW: camYaw lerps toward the
    // car heading at 2.2/s, and a headless capture only runs ~0.15s of
    // game time after staging — without this the first frame catches the
    // camera mid-swing and the road runs diagonally out of frame.
    g.player.camYaw = car.heading + Math.PI;
    // Hold the throttle down so the car keeps its speed into the frame.
    g.keys.KeyW = true;
    // Clear the lane ahead: a staged traffic car sitting in front of the
    // Furia turns the chase into a traffic jam at 23 km/h.
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    for (const c of [...g.traffic.cars]) {
      const dx = c.pos.x - car.pos.x, dz = c.pos.z - car.pos.z;
      const ahead = dx * fx + dz * fz;
      const side = Math.abs(dx * fz - dz * fx);
      if (ahead > 0 && ahead < 60 && side < 4) {
        g.scene.remove(c.mesh);
        g.traffic.cars = g.traffic.cars.filter((x) => x !== c);
      }
    }
    stagePolice(g, 2, 4);
    // The seeded police rng parks one unit 22m off the Furia's flank and
    // it rams Rio inside the first second, every take. Reposition all
    // units to flanking pursuit spots 60m+ out (relative to the staged
    // player position): they close in over the shot but cannot reach the
    // Furia before the frame is taken. stagePolice spawns two units,
    // then its update tick spawns a third (wanted 4 wants four cars).
    const flank = [[30, 110], [-50, 10], [-60, 130], [50, -20]];
    g.police.cars.forEach((c, i) => {
      const spot = flank[i] || [g.player.pos.x - i * 25, 130];
      c.pos.set(spot[0], 0, spot[1]);
      c.heading = Math.atan2(g.player.pos.x - c.pos.x, g.player.pos.z - c.pos.z);
      c.syncMesh();
    });
    // Two blocks, staged by hand: the near one (40m) reads large in
    // frame, the far one (110m) keeps the loop from adding its own 100m
    // block in the car's path. clearRoadblocks first removes the 45m
    // block stagePolice put up.
    g.police.clearRoadblocks();
    g.police.spawnRoadblock(g.player.pos, g.player.heading, 40);
    g.police.spawnRoadblock(g.player.pos, g.player.heading, 110);
    // Traffic stays north of this road (around x=0, z=-120): the last
    // two takes both ended in a rear-end shunt with a car on the Furia's
    // own lane, which is why the speedo stuck at 64 km/h.
    g.traffic.spawn(6, { x: 0, z: -120 }, 70);
    g.peds.spawn(8, { x: -60, z: 60 }, 80);
    g.missions.startMission(12); // Sunset Run: the timed delivery
    g.player.camDist = 11;
  } else if (shot === 'mission') {
    // Mission 14 in progress: Lose the Tail. Rio in a Furia on the
    // central east-west road (z=0), Vex's Vento closing in behind him.
    // The first version staged the car at (-20,-20) — off the road grid —
    // so it spent the shot grinding along a building wall.
    const car = g.spawnCar('furia', 0xf2c230, -60, 0, Math.PI / 2);
    g.enterCar(car);
    car.speed = 24;
    g.player.pos.copy(car.pos); // see chase: staging reads player.pos
    g.player.heading = car.heading;
    g.player.camYaw = car.heading + Math.PI; // see chase: no mid-swing camera
    g.keys.KeyW = true;
    g.missions.startMission(13);
    // The tail spawns 38m out at a random angle — usually behind the
    // camera, invisible. Park Vex's Vento ahead-right of the Furia, on
    // the same road, so the chase reads in the frame. (Same ~0.15s of
    // game time after staging as the chase shot: stage it, don't drive it.)
    const tail = g.missions.tail;
    if (tail) {
      tail.pos.set(-35, 0, 10);
      tail.heading = Math.PI / 2;
      tail.speed = 15;
      tail.syncMesh();
    }
    g.traffic.spawn(6, { x: -60, z: 0 }, 110);
    g.peds.spawn(6, { x: -60, z: 0 }, 70);
    g.player.camDist = 11;
  } else if (shot === 'garage') {
    // Verification only: Rio on foot at GARAGE 24 with the shop open, so
    // the upgrade buttons can be screenshotted and checked. Rio stands
    // 5.7m from the shop counter — inside the 7m nearShop radius — so the
    // panel re-renders after each purchase, as it does in real play.
    const shop = g.world.shops.find((s) => s.kind === 'garage');
    g.player.pos.set(146, 0, -146);
    g.player.heading = Math.PI * 0.75;
    g.player.camYaw = Math.PI * 0.75 + Math.PI;
    g.nearShop = shop;
    g.openShop(shop);
    g.player.camDist = 9;
  } else if (shot === 'race') {
    // The Midnight Grand Prix. Rio in a Furia on the start line at Coral
    // Row (x=-180 road, facing south toward the first checkpoint), two
    // rival Ventos ahead and the gold checkpoint beacon 60m down the
    // road. Staged directly, not via a mission: starting the Grand Prix
    // would swap to the race map (an empty road mesh) and the staged
    // cars live in the city scene. (Same ~0.15s rule as the chase shot:
    // stage it, don't drive it.)
    const car = g.spawnCar('furia', 0xf2c230, -180, 120, Math.PI);
    g.enterCar(car);
    car.speed = 20;
    g.player.pos.copy(car.pos); // see chase: staging reads player.pos
    g.player.heading = car.heading;
    g.player.camYaw = car.heading + Math.PI; // see chase: no mid-swing camera
    g.keys.KeyW = true;
    for (const z of [90, 75]) {
      const rival = g.spawnCar('vento', 0x8e2f32, -180, z, Math.PI);
      rival.kind = 'race';
      rival.speed = 0;
    }
    g.missions.placeMarker(-180, 60);
    g.traffic.spawn(5, { x: -180, z: -60 }, 90);
    // Clear the lane ahead, as in the chase shot: a staged traffic car
    // on the x=-180 road turns the race into a rear-end shunt.
    const rfx = Math.sin(car.heading), rfz = Math.cos(car.heading);
    for (const c of [...g.traffic.cars]) {
      const dx = c.pos.x - car.pos.x, dz = c.pos.z - car.pos.z;
      const ahead = dx * rfx + dz * rfz;
      const side = Math.abs(dx * rfz - dz * rfx);
      if (ahead > 0 && ahead < 60 && side < 4) {
        g.scene.remove(c.mesh);
        g.traffic.cars = g.traffic.cars.filter((x) => x !== c);
      }
    }
    g.peds.spawn(6, { x: -180, z: 60 }, 70);
    g.player.camDist = 11;
  } else if (shot === 'taxi') {
    // A taxi fare offer. Rio in a Taxi Sol on the central east-west
    // road (z=0), the passenger standing 30m ahead with the amber beacon
    // over them and the fare on the HUD objective line. The passenger
    // faces the car, so the shot reads as a pickup about to happen.
    const car = g.spawnCar('taxi', 0xf2a007, 0, 10, Math.PI);
    g.enterCar(car);
    car.speed = 0;
    g.player.pos.copy(car.pos); // see chase: staging reads player.pos
    g.player.heading = car.heading;
    g.player.camYaw = car.heading + Math.PI; // see chase: no mid-swing camera
    g.taxi.stageOffer({ x: 0, z: -20, name: 'the Plaza' });
    g.traffic.spawn(5, { x: 0, z: -60 }, 80);
    g.peds.spawn(6, { x: 0, z: -30 }, 60);
    g.player.camDist = 10;
  } else if (shot === 'packages') {
    // Rio on foot at the Plaza, a gold collectible parcel glowing
    // 10m ahead of him. The package bob and spin read in the frame, and
    // the objective line shows the package count once one is found.
    g.player.pos.set(0, 0, 20);
    g.player.heading = 0; // facing +Z, toward the package at (0, 30)
    g.player.camYaw = 0 + Math.PI;
    g.traffic.spawn(6, { x: 0, z: 60 }, 90);
    g.peds.spawn(8, { x: 0, z: 30 }, 60);
    g.player.camDist = 8;
  } else if (shot === 'street') {
    // The city at its busiest. Rio on a Moto 250 on the central
    // east-west road (z=0), heading west toward a Sol Bus dwelling at
    // the West Plaza stop with waiters on the bench, a second bike
    // weaving in traffic, joggers and a walking group on the sidewalks.
    // (Same ~0.15s rule as the chase shot: stage it, don't drive it.)
    const car = g.spawnCar('moto', 0xd21f2b, 0, 0, -Math.PI / 2);
    g.enterCar(car);
    car.speed = 16;
    g.player.pos.copy(car.pos); // see chase: staging reads player.pos
    g.player.heading = car.heading;
    g.player.camYaw = car.heading + Math.PI; // see chase: no mid-swing camera
    g.keys.KeyW = true;
    // The bus: dwelling at the West Plaza stop, 60 m ahead, waiters
    // standing — boardedThisStop starts true so the shot keeps them.
    const stop = g.world.busStops.find((s) => s.name === 'West Plaza');
    g.traffic.spawnBusAt(stop, 6);
    g.peds.spawnWaiters(stop, 3);
    // A second bike ahead, already weaving, plus the usual traffic and
    // a walking group on the sidewalk. Spawn first, clear the lane last:
    // a fresh traffic car can land right in the Moto's path.
    const bike2 = g.spawnCar('moto', 0x2b3a55, -25, 0, -Math.PI / 2);
    bike2.kind = 'traffic';
    bike2.ai = { axis: 'x', dir: -1, targetSpeed: 14, wait: 0, weave: true, weavePhase: 1.2 };
    g.traffic.cars.push(bike2);
    g.traffic.spawn(6, { x: -30, z: 0 }, 80);
    g.peds.spawn(10, { x: -10, z: 0 }, 70);
    g.peds.spawnGroup(-20, 9, 3);
    const sfx = Math.sin(car.heading), sfz = Math.cos(car.heading);
    for (const c of [...g.traffic.cars]) {
      if (c === bike2) continue;
      const dx = c.pos.x - car.pos.x, dz = c.pos.z - car.pos.z;
      const ahead = dx * sfx + dz * sfz;
      const side = Math.abs(dx * sfz - dz * sfx);
      // The bus sits 60 m ahead — the 55 m cut keeps it in frame.
      if (ahead > 0 && ahead < 55 && side < 4) {
        g.scene.remove(c.mesh);
        g.traffic.cars = g.traffic.cars.filter((x) => x !== c);
      }
    }
    g.player.camDist = 11;
  } else if (shot === 'chase-ambush') {
    // CHASE AMBUSH — 4-star pursuit cover.
    // Furia at 180 km/h (50 m/s), two BCPD flank left/right, heli spotlight
    // cutting through volumetric fog, roadblock 50m ahead — Rio still WOT.
    // Low hero angle, motion blur on wheels, exhaust flame (engine Lv2),
    // clearcoat catching heli beam, particle dust trail, god rays.
    const car = g.spawnCar('furia', 0xf2c230, -120, 0, Math.PI / 2);
    g.enterCar(car);
    car.speed = 50;
    car.upgrades = { armor: 0, engine: 2, tires: 1 };
    car.applyUpgrades(car.upgrades);
    g.player.pos.copy(car.pos);
    g.player.heading = car.heading;
    g.player.camYaw = car.heading + Math.PI - 0.15; // slight low offset for hero angle
    g.player.camPitch = 0.35; // low angle looking up at heli
    g.keys.KeyW = true;
    // Clear lane ahead completely
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    for (const c of [...g.traffic.cars]) {
      const dx = c.pos.x - car.pos.x, dz = c.pos.z - car.pos.z;
      const ahead = dx * fx + dz * fz;
      const side = Math.abs(dx * fz - dz * fx);
      if (ahead > -20 && ahead < 120 && side < 6) {
        g.scene.remove(c.mesh);
        g.traffic.cars = g.traffic.cars.filter((x) => x !== c);
      }
    }
    // 4-star police: heli + 4 interceptors
    stagePolice(g, 4, 4);
    // Reposition police: 2 flanking at 35m, 2 rear pursuit at 50m
    const policeSpots = [
      [-35, 35],   // left flank
      [35, 35],    // right flank
      [0, -50],    // rear pursuit
      [0, -80],    // rear pursuit 2
    ];
    g.police.cars.forEach((c, i) => {
      const spot = policeSpots[i] || [0, -100 - i * 20];
      c.pos.set(car.pos.x + spot[0], 0, car.pos.z + spot[1]);
      c.heading = Math.atan2(g.player.pos.x - c.pos.x, g.player.pos.z - c.pos.z);
      c.speed = 42 + i * 3;
      c.syncMesh();
    });
    // Heli already spawned by stagePolice at wanted 4 — position it dramatically
    if (g.police.heli) {
      g.police.heli.position.set(car.pos.x + 15, 45, car.pos.z + 60);
      g.police.heli.rotation.y = Math.atan2(car.pos.x - g.police.heli.position.x, car.pos.z - g.police.heli.position.z);
      if (g.police.heliLight) {
        g.police.heliLight.target.position.set(car.pos.x, 0, car.pos.z + 20);
        g.police.heliLight.target.updateMatrixWorld();
      }
    }
    // Roadblock 50m ahead — the climactic obstacle
    g.police.clearRoadblocks();
    g.police.spawnRoadblock(g.player.pos, g.player.heading, 50);
    // Background traffic far behind (depth)
    g.traffic.spawn(4, { x: 0, z: -150 }, 60);
    g.peds.spawn(6, { x: -80, z: 40 }, 50);
    // Time of day: dusk (volumetric fog + god rays)
    g.tod = 0.79; // ~19:00
    g.updateTimeOfDay(0);
    g.player.camDist = 14;
  } else if (shot === 'gang-war') {
    // GANG WAR — Turf war cover. Rio behind Carguero cover, SMG raised,
    // 4 Red Vipers + 4 Blue Syndicate closing in, molotov mid-air,
    // police cruiser tearing up pavement, sparks/bullets everywhere.
    // Wide cinematic, Rio center-low, enemies forming semicircle.
    const car = g.spawnCar('carguero', 0x8e2f32, 20, -20, Math.PI * 0.25);
    g.enterCar(car);
    car.speed = 0;
    g.player.pos.set(car.pos.x - 2.5, 1.6, car.pos.z + 1.8); // Rio crouched behind trunk
    g.player.heading = Math.PI * 0.25;
    g.player.camYaw = Math.PI * 0.25 + Math.PI * 0.9; // over-shoulder, slightly dutch angle
    g.player.camPitch = 0.4;
    g.player.camDist = 7;
    g.save.currentWeapon = 'smg';
    g.save.weapons.smg = { owned: true, ammo: 32 };
    // Spawn gangs in semicircle around Rio
    const gangs = g.world.gangs || [];
    const redVipers = GANGS.find(g => g.name === 'Red Vipers');
    const blueSyndicate = GANGS.find(g => g.name === 'Blue Syndicate');
    const gangPositions = [
      // Red Vipers (left arc)
      { x: 45, z: 15, gang: redVipers },
      { x: 55, z: 5, gang: redVipers },
      { x: 60, z: -10, gang: redVipers },
      { x: 55, z: -25, gang: redVipers },
      // Blue Syndicate (right arc)
      { x: 15, z: -45, gang: blueSyndicate },
      { x: 5, z: -55, gang: blueSyndicate },
      { x: -10, z: -60, gang: blueSyndicate },
      { x: -25, z: -55, gang: blueSyndicate },
    ];
    for (const gp of gangPositions) {
      if (gp.gang) g.peds.spawnGang(gp.gang, 1, gp.x, gp.z);
    }
    // Position the spawned gang members precisely
    const gangPeds = g.peds.peds.filter(p => p.role === 'gang' && !p.dead);
    gangPositions.forEach((gp, i) => {
      if (gangPeds[i]) {
        gangPeds[i].pos.set(gp.x, 0, gp.z);
        gangPeds[i].heading = Math.atan2(g.player.pos.x - gp.x, g.player.pos.z - gp.z);
        gangPeds[i].armed = true;
        gangPeds[i].aggro = 50;
        gangPeds[i].mesh.position.set(gp.x, 0, gp.z);
      }
    });
    // Add a molotov in mid-air (particle)
    g.particles.flame({ x: 35, y: 2.5, z: -5 }, 3);
    g.particles.smoke({ x: 35, y: 2, z: -5 }, 2);
    // Police cruiser sliding in from background (dramatic entry)
    const cop = g.spawnCar('police', 0x1d2733, -60, 60, -Math.PI * 0.75);
    cop.speed = 28;
    cop.ai = { axis: 'x', dir: 1, targetSpeed: 30, wait: 0 };
    g.scene.add(cop.mesh);
    g.traffic.cars.push(cop);
    // Dust/sparks from cruiser wheels
    g.particles.smoke({ x: -40, y: 0.5, z: 40 }, 4);
    g.particles.sparks({ x: -40, y: 0.5, z: 40 }, 6);
    // Background traffic (blurred depth)
    g.traffic.spawn(3, { x: -80, z: -80 }, 50);
    // Time: night (neon, muzzle flash bloom)
    g.tod = 0.92; // ~22:00
    g.updateTimeOfDay(0);
  } else if (shot === 'heist-getaway') {
    // HEIST GETAWAY — Three-car convoy cover.
    // Furia (Rio driving), Vento (tail gunner leaning out window firing),
    // Carguero (loot) — heli searchlight sweeping, spike strip glinting ahead,
    // city walls closing in. Low wide angle, motion blur, formation tight.
    // Lead car: Furia
    const furia = g.spawnCar('furia', 0xf2c230, -100, 0, Math.PI / 2);
    g.enterCar(furia);
    furia.speed = 42;
    furia.upgrades = { armor: 1, engine: 2, tires: 2 };
    furia.applyUpgrades(furia.upgrades);
    g.player.pos.copy(furia.pos);
    g.player.heading = furia.heading;
    g.player.camYaw = furia.heading + Math.PI * 1.1; // slight side view to show convoy
    g.player.camPitch = 0.3;
    g.player.camDist = 18;
    g.keys.KeyW = true;
    // Tail gunner: Vento offset left-rear
    const vento = g.spawnCar('vento', 0x2b3a55, -100, -6, Math.PI / 2);
    vento.speed = 42;
    vento.kind = 'mission';
    g.scene.add(vento.mesh);
    // Loot hauler: Carguero offset right-rear
    const carguero = g.spawnCar('carguero', 0x8e2f32, -100, 6, Math.PI / 2);
    carguero.speed = 42;
    carguero.kind = 'mission';
    g.scene.add(carguero.mesh);
    // Convoy AI: lock formation
    [vento, carguero].forEach(c => {
      c.ai = { axis: 'z', dir: 1, targetSpeed: 42, wait: 0, convoy: true, lead: furia };
    });
    // Heli searchlight — dramatic top-down beam
    if (!g.police.heli) g.police.spawnHeli();
    if (g.police.heli) {
      g.police.heli.position.set(-100, 55, 30);
      g.police.heli.rotation.y = -Math.PI / 2;
      if (g.police.heliLight) {
        g.police.heliLight.target.position.set(-100, 0, 0);
        g.police.heliLight.target.updateMatrixWorld();
        g.police.heliLight.intensity = 1200;
      }
    }
    // Spike strip ahead (glinting on asphalt)
    g.police.clearRoadblocks();
    const spikePos = { x: -100, z: 55 };
    // Visual spike strip (reuse roadblock barrier but flat)
    const spikeGeo = new THREE.PlaneGeometry(14, 0.8);
    const spikeMat = new THREE.MeshStandardMaterial({ 
      color: 0x2a2a2a, roughness: 0.3, metalness: 0.7,
      emissive: 0x333333, emissiveIntensity: 0.3
    });
    const spikeStrip = new THREE.Mesh(spikeGeo, spikeMat);
    spikeStrip.rotation.x = -Math.PI / 2;
    spikeStrip.position.set(spikePos.x, 0.09, spikePos.z);
    g.scene.add(spikeStrip);
    // Warning sign before spikes
    const warnGeo = new THREE.PlaneGeometry(4, 4);
    const warnMat = new THREE.MeshBasicMaterial({ 
      map: g.world.shops[0] ? signTexture('SPIKES', '#8b0000', '#fff') : undefined,
      color: 0xff2222, transparent: true, opacity: 0.9
    });
    // Background: city walls, distant traffic
    g.traffic.spawn(3, { x: -150, z: -100 }, 60);
    g.peds.spawn(4, { x: -120, z: 20 }, 40);
    // Time: deep night (heli beam volumetric)
    g.tod = 0.95; // ~22:48
    g.updateTimeOfDay(0);
  } else if (shot === 'midnight-grand-prix') {
    // MIDNIGHT GRAND PRIX — Race start grid cover.
    // 8 cars (Furia/Vento mix) side-by-side on Coral Row (x=-180),
    // neon Coral Row reflecting on clearcoat, start lights RED→GREEN sequence,
    // drift zone markers glowing amber, crowd silhouettes on sidewalks,
    // tire smoke pre-launch. Low wide, symmetry, color pop.
    const cars = [];
    const startX = -180;
    const startZ = 100;
    const colors = [
      0xf2c230, 0xff4444, 0x44ff44, 0x4488ff,
      0xff8844, 0xff44ff, 0x88ff44, 0xffff44
    ];
    const types = ['furia', 'vento', 'furia', 'vento', 'furia', 'vento', 'furia', 'vento'];
    for (let i = 0; i < 8; i++) {
      const car = g.spawnCar(types[i], colors[i], startX, startZ + (i - 3.5) * 5.5, Math.PI);
      car.speed = 0;
      car.upgrades = { armor: 0, engine: 2, tires: 2 };
      car.applyUpgrades(car.upgrades);
      // Pre-launch tire smoke
      if (i % 2 === 0) g.particles.smoke({ x: car.pos.x, y: 0.4, z: car.pos.z }, 2);
      cars.push(car);
      g.scene.add(car.mesh);
    }
    // Player in pole position (index 3 - center-left)
    g.enterCar(cars[3]);
    g.player.pos.copy(cars[3].pos);
    g.player.heading = Math.PI;
    g.player.camYaw = Math.PI + 0.05;
    g.player.camPitch = 0.25;
    g.player.camDist = 16;
    // Start lights: 5 red lights (about to go green)
    const lightGeo = new THREE.SphereGeometry(0.6, 16, 12);
    for (let i = 0; i < 5; i++) {
      const light = new THREE.Mesh(lightGeo, new THREE.MeshBasicMaterial({ 
        color: i < 4 ? 0xff2222 : 0x22ff22, // 4 red, 1 green (transition moment)
        transparent: true, opacity: 1 
      }));
      light.position.set(startX - 8, 4.5, startZ + (i - 2) * 5.5);
      g.scene.add(light);
      // Glow bloom
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: i < 4 ? 0xff2222 : 0x22ff22,
        transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false
      }));
      glow.position.copy(light.position);
      glow.scale.setScalar(2.5);
      g.scene.add(glow);
    }
    // Drift zone markers (amber rings) ahead
    for (let i = 0; i < 3; i++) {
      const ringGeo = new THREE.RingGeometry(10, 11, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xff8800, transparent: true, opacity: 0.4,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(startX, 0.1, startZ + 40 + i * 35);
      g.scene.add(ring);
    }
    // Crowd silhouettes on sidewalks
    for (let side of [-1, 1]) {
      for (let i = 0; i < 12; i++) {
        const ped = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.3, 1.4, 4, 8),
          new THREE.MeshBasicMaterial({ color: 0x1a1a2e })
        );
        ped.position.set(startX + side * 14, 0.7, startZ + (i - 5.5) * 5.5);
        ped.rotation.y = -side * Math.PI / 2;
        g.scene.add(ped);
      }
    }
    // Clear any traffic on the road
    g.traffic.cars.forEach(c => g.scene.remove(c.mesh));
    g.traffic.cars = [];
    // Time: midnight (max neon reflection)
    g.tod = 0.0; // 00:00
    g.updateTimeOfDay(0);
  } else if (shot === 'chase-ambush-hero') {
    // CHASE AMBUSH — Hero Low Angle (dramatic up-shot)
    // Camera low, looking up at heli + Furia, roadblock looming large
    const car = g.spawnCar('furia', 0xf2c230, -120, 0, Math.PI / 2);
    g.enterCar(car);
    car.speed = 50;
    car.upgrades = { armor: 0, engine: 2, tires: 1 };
    car.applyUpgrades(car.upgrades);
    g.player.pos.copy(car.pos);
    g.player.heading = car.heading;
    g.player.camYaw = car.heading + Math.PI - 0.1;
    g.player.camPitch = 0.55; // very low, looking up
    g.player.camDist = 10; // closer, more imposing
    g.keys.KeyW = true;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    for (const c of [...g.traffic.cars]) {
      const dx = c.pos.x - car.pos.x, dz = c.pos.z - car.pos.z;
      const ahead = dx * fx + dz * fz;
      const side = Math.abs(dx * fz - dz * fx);
      if (ahead > -20 && ahead < 120 && side < 6) {
        g.scene.remove(c.mesh);
        g.traffic.cars = g.traffic.cars.filter((x) => x !== c);
      }
    }
    stagePolice(g, 4, 4);
    const policeSpots = [[-35, 35], [35, 35], [0, -50], [0, -80]];
    g.police.cars.forEach((c, i) => {
      const spot = policeSpots[i] || [0, -100 - i * 20];
      c.pos.set(car.pos.x + spot[0], 0, car.pos.z + spot[1]);
      c.heading = Math.atan2(g.player.pos.x - c.pos.x, g.player.pos.z - c.pos.z);
      c.speed = 42 + i * 3;
      c.syncMesh();
    });
    if (g.police.heli) {
      g.police.heli.position.set(car.pos.x + 10, 55, car.pos.z + 50); // higher, more dramatic
      g.police.heli.rotation.y = Math.atan2(car.pos.x - g.police.heli.position.x, car.pos.z - g.police.heli.position.z);
      if (g.police.heliLight) {
        g.police.heliLight.target.position.set(car.pos.x, 0, car.pos.z + 15);
        g.police.heliLight.target.updateMatrixWorld();
      }
    }
    g.police.clearRoadblocks();
    g.police.spawnRoadblock(g.player.pos, g.player.heading, 50);
    g.traffic.spawn(4, { x: 0, z: -150 }, 60);
    g.peds.spawn(6, { x: -80, z: 40 }, 50);
    g.tod = 0.79;
    g.updateTimeOfDay(0);
  } else if (shot === 'chase-ambush-side') {
    // CHASE AMBUSH — Side Drift Angle (motion blur emphasis)
    // Camera perpendicular to motion, showing full car profile + flank police
    const car = g.spawnCar('furia', 0xf2c230, -80, 0, Math.PI / 2);
    g.enterCar(car);
    car.speed = 50;
    car.upgrades = { armor: 0, engine: 2, tires: 1 };
    car.applyUpgrades(car.upgrades);
    g.player.pos.copy(car.pos);
    g.player.heading = car.heading;
    g.player.camYaw = car.heading + Math.PI / 2; // 90 deg side view
    g.player.camPitch = 0.12; // low, near road level, like the key art
    g.player.camDist = 11; // close: the car fills the frame
    g.keys.KeyW = true;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    for (const c of [...g.traffic.cars]) {
      const dx = c.pos.x - car.pos.x, dz = c.pos.z - car.pos.z;
      const ahead = dx * fx + dz * fz;
      const side = Math.abs(dx * fz - dz * fx);
      if (ahead > -20 && ahead < 120 && side < 6) {
        g.scene.remove(c.mesh);
        g.traffic.cars = g.traffic.cars.filter((x) => x !== c);
      }
    }
    stagePolice(g, 4, 4);
    // Police repositioned for side view composition
    const sideSpots = [[-40, 40], [40, 40], [-20, -40], [20, -40]];
    g.police.cars.forEach((c, i) => {
      const spot = sideSpots[i] || [0, -100 - i * 20];
      c.pos.set(car.pos.x + spot[0], 0, car.pos.z + spot[1]);
      c.heading = Math.atan2(g.player.pos.x - c.pos.x, g.player.pos.z - c.pos.z);
      c.speed = 42 + i * 3;
      c.syncMesh();
    });
    if (g.police.heli) {
      g.police.heli.position.set(car.pos.x + 30, 45, car.pos.z + 30);
      g.police.heli.rotation.y = Math.atan2(car.pos.x - g.police.heli.position.x, car.pos.z - g.police.heli.position.z);
      if (g.police.heliLight) {
        g.police.heliLight.target.position.set(car.pos.x, 0, car.pos.z + 20);
        g.police.heliLight.target.updateMatrixWorld();
      }
    }
    g.police.clearRoadblocks();
    g.police.spawnRoadblock(g.player.pos, g.player.heading, 60);
    g.tod = 0.72; // golden hour: sun still up (0.79 was past sunset, black)
    g.updateTimeOfDay(0);
  } else if (shot === 'chase-ambush-rear') {
    // CHASE AMBUSH — Rear Pursuit View (police POV)
    // Camera behind police car, looking at Furia ahead
    const car = g.spawnCar('furia', 0xf2c230, -60, 0, Math.PI / 2);
    g.enterCar(car);
    car.speed = 50;
    car.upgrades = { armor: 0, engine: 2, tires: 1 };
    car.applyUpgrades(car.upgrades);
    // Add a police car as the "camera car" - we'll position camera behind it
    const copCam = g.spawnCar('police', 0x1d2733, -110, 0, Math.PI / 2);
    copCam.speed = 48;
    g.scene.add(copCam.mesh);
    g.player.pos.copy(copCam.pos);
    g.player.heading = copCam.heading;
    g.player.camYaw = copCam.heading + Math.PI;
    g.player.camPitch = 0.15;
    g.player.camDist = 8;
    g.keys.KeyW = true;
    // CR-4: the lane-clear loop below uses fx/fz — define them here,
    // mirroring the other chase-ambush branches.
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    // Clear lane
    for (const c of [...g.traffic.cars]) {
      const dx = c.pos.x - car.pos.x, dz = c.pos.z - car.pos.z;
      const ahead = dx * fx + dz * fz;
      const side = Math.abs(dx * fz - dz * fx);
      if (ahead > -20 && ahead < 120 && side < 6) {
        g.scene.remove(c.mesh);
        g.traffic.cars = g.traffic.cars.filter((x) => x !== c);
      }
    }
    stagePolice(g, 3, 4); // 3 more police
    const rearSpots = [[-30, 20], [30, 20], [0, -60]];
    g.police.cars.forEach((c, i) => {
      const spot = rearSpots[i] || [0, -80];
      c.pos.set(car.pos.x + spot[0], 0, car.pos.z + spot[1]);
      c.heading = Math.atan2(g.player.pos.x - c.pos.x, g.player.pos.z - c.pos.z);
      c.speed = 42 + i * 3;
      c.syncMesh();
    })
    if (g.police.heli) {
      g.police.heli.position.set(car.pos.x + 10, 45, car.pos.z + 60);
      if (g.police.heliLight) {
        g.police.heliLight.target.position.set(car.pos.x, 0, car.pos.z + 20);
        g.police.heliLight.target.updateMatrixWorld();
      }
    }
    g.police.clearRoadblocks();
    g.police.spawnRoadblock(car.pos, car.heading, 50);
    g.tod = 0.79;
    g.updateTimeOfDay(0);
  } else if (shot === 'gang-war-wide') {
    // GANG WAR — Wide Cinematic (establishing shot)
    // Pull back, show full semicircle, Rio small but centered
    const car = g.spawnCar('carguero', 0x8e2f32, 20, -20, Math.PI * 0.25);
    g.enterCar(car);
    car.speed = 0;
    g.player.pos.set(car.pos.x - 2.5, 1.6, car.pos.z + 1.8);
    g.player.heading = Math.PI * 0.25;
    g.player.camYaw = Math.PI * 0.25 + Math.PI * 0.75; // rear three-quarter, not a flat chase cam
    g.player.camPitch = 0.25;
    g.player.camDist = 18; // wide
    g.save.currentWeapon = 'smg';
    g.save.weapons.smg = { owned: true, ammo: 32 };
    const redVipers = GANGS.find(g => g.name === 'Red Vipers');
    const blueSyndicate = GANGS.find(g => g.name === 'Blue Syndicate');
    const gangPositions = [
      { x: 50, z: 25, gang: redVipers }, { x: 65, z: 10, gang: redVipers },
      { x: 75, z: -10, gang: redVipers }, { x: 65, z: -30, gang: redVipers },
      { x: 20, z: -55, gang: blueSyndicate }, { x: 5, z: -65, gang: blueSyndicate },
      { x: -15, z: -70, gang: blueSyndicate }, { x: -30, z: -65, gang: blueSyndicate },
    ];
    for (const gp of gangPositions) if (gp.gang) g.peds.spawnGang(gp.gang, 1, gp.x, gp.z);
    const gangPeds = g.peds.peds.filter(p => p.role === 'gang' && !p.dead);
    gangPositions.forEach((gp, i) => {
      if (gangPeds[i]) {
        gangPeds[i].pos.set(gp.x, 0, gp.z);
        gangPeds[i].heading = Math.atan2(g.player.pos.x - gp.x, g.player.pos.z - gp.z);
        gangPeds[i].armed = true; gangPeds[i].aggro = 50;
        gangPeds[i].mesh.position.set(gp.x, 0, gp.z);
      }
    });
    g.particles.flame({ x: 40, y: 3, z: 0 }, 4);
    g.particles.smoke({ x: 40, y: 2.5, z: 0 }, 3);
    const cop = g.spawnCar('police', 0x1d2733, -80, 80, -Math.PI * 0.75);
    cop.speed = 30; cop.ai = { axis: 'x', dir: 1, targetSpeed: 32, wait: 0 };
    g.scene.add(cop.mesh); g.traffic.cars.push(cop);
    g.particles.smoke({ x: -50, y: 0.5, z: 50 }, 5);
    g.particles.sparks({ x: -50, y: 0.5, z: 50 }, 8);
    g.traffic.spawn(3, { x: -100, z: -100 }, 60);
    g.tod = 0.5; g.updateTimeOfDay(0); // noon: the wide shot faces away from the low sun, dusk left it black
  } else if (shot === 'gang-war-dutch') {
    // GANG WAR — Dutch Angle (tension, chaos)
    // Tilted horizon, close over-shoulder, immediate threat
    const car = g.spawnCar('carguero', 0x8e2f32, 20, -20, Math.PI * 0.25);
    g.enterCar(car);
    car.speed = 0;
    g.player.pos.set(car.pos.x - 2.5, 1.6, car.pos.z + 1.8);
    g.player.heading = Math.PI * 0.25;
    g.player.camYaw = Math.PI * 0.25 + Math.PI * 0.9;
    g.player.camPitch = 0.35;
    g.player.camDist = 6; // tighter
    // Dutch angle via camera roll (z rotation)
    g.player.mesh.rotation.z = 0.15; // ~8.5 deg tilt
    g.save.currentWeapon = 'smg';
    g.save.weapons.smg = { owned: true, ammo: 32 };
    const redVipers = GANGS.find(g => g.name === 'Red Vipers');
    const blueSyndicate = GANGS.find(g => g.name === 'Blue Syndicate');
    const gangPositions = [
      { x: 45, z: 15, gang: redVipers }, { x: 55, z: 5, gang: redVipers },
      { x: 60, z: -10, gang: redVipers }, { x: 55, z: -25, gang: redVipers },
      { x: 15, z: -45, gang: blueSyndicate }, { x: 5, z: -55, gang: blueSyndicate },
      { x: -10, z: -60, gang: blueSyndicate }, { x: -25, z: -55, gang: blueSyndicate },
    ];
    for (const gp of gangPositions) if (gp.gang) g.peds.spawnGang(gp.gang, 1, gp.x, gp.z);
    const gangPeds = g.peds.peds.filter(p => p.role === 'gang' && !p.dead);
    gangPositions.forEach((gp, i) => {
      if (gangPeds[i]) {
        gangPeds[i].pos.set(gp.x, 0, gp.z);
        gangPeds[i].heading = Math.atan2(g.player.pos.x - gp.x, g.player.pos.z - gp.z);
        gangPeds[i].armed = true; gangPeds[i].aggro = 50;
        gangPeds[i].mesh.position.set(gp.x, 0, gp.z);
      }
    });
    g.particles.flame({ x: 35, y: 2.5, z: -5 }, 3);
    g.particles.smoke({ x: 35, y: 2, z: -5 }, 2);
    const cop = g.spawnCar('police', 0x1d2733, -60, 60, -Math.PI * 0.75);
    cop.speed = 28; cop.ai = { axis: 'x', dir: 1, targetSpeed: 30, wait: 0 };
    g.scene.add(cop.mesh); g.traffic.cars.push(cop);
    g.particles.smoke({ x: -40, y: 0.5, z: 40 }, 4);
    g.particles.sparks({ x: -40, y: 0.5, z: 40 }, 6);
    g.traffic.spawn(3, { x: -80, z: -80 }, 50);
    g.tod = 0.92; g.updateTimeOfDay(0);
  } else if (shot === 'gang-war-overhead') {
    // GANG WAR — Overhead/Top-Down (tactical view)
    // Shows formation, semicircle geometry, Rio at center
    const car = g.spawnCar('carguero', 0x8e2f32, 20, -20, Math.PI * 0.25);
    g.enterCar(car);
    car.speed = 0;
    g.player.pos.set(car.pos.x - 2.5, 1.6, car.pos.z + 1.8);
    g.player.heading = Math.PI * 0.25;
    g.player.camYaw = Math.PI * 0.25 + Math.PI;
    g.player.camPitch = 0.05; // almost straight down
    g.player.camDist = 35; // high up
    g.save.currentWeapon = 'smg';
    g.save.weapons.smg = { owned: true, ammo: 32 };
    const redVipers = GANGS.find(g => g.name === 'Red Vipers');
    const blueSyndicate = GANGS.find(g => g.name === 'Blue Syndicate');
    const gangPositions = [
      { x: 45, z: 15, gang: redVipers }, { x: 55, z: 5, gang: redVipers },
      { x: 60, z: -10, gang: redVipers }, { x: 55, z: -25, gang: redVipers },
      { x: 15, z: -45, gang: blueSyndicate }, { x: 5, z: -55, gang: blueSyndicate },
      { x: -10, z: -60, gang: blueSyndicate }, { x: -25, z: -55, gang: blueSyndicate },
    ];
    for (const gp of gangPositions) if (gp.gang) g.peds.spawnGang(gp.gang, 1, gp.x, gp.z);
    const gangPeds = g.peds.peds.filter(p => p.role === 'gang' && !p.dead);
    gangPositions.forEach((gp, i) => {
      if (gangPeds[i]) {
        gangPeds[i].pos.set(gp.x, 0, gp.z);
        gangPeds[i].heading = Math.atan2(g.player.pos.x - gp.x, g.player.pos.z - gp.z);
        gangPeds[i].armed = true; gangPeds[i].aggro = 50;
        gangPeds[i].mesh.position.set(gp.x, 0, gp.z);
      }
    });
    g.particles.flame({ x: 35, y: 2.5, z: -5 }, 3);
    g.particles.smoke({ x: 35, y: 2, z: -5 }, 2);
    g.tod = 0.92; g.updateTimeOfDay(0);
  } else if (shot === 'heist-getaway-side') {
    // HEIST GETAWAY — Side Convoy View (formation emphasis)
    // Camera parallel to road, all 3 cars visible in line
    const furia = g.spawnCar('furia', 0xf2c230, -120, 0, Math.PI / 2);
    g.enterCar(furia);
    furia.speed = 42;
    furia.upgrades = { armor: 1, engine: 2, tires: 2 };
    furia.applyUpgrades(furia.upgrades);
    g.player.pos.set(furia.pos.x + 20, 4, furia.pos.z); // offset to side
    g.player.heading = Math.PI / 2;
    g.player.camYaw = Math.PI; // looking perpendicular to convoy
    g.player.camPitch = 0.15;
    g.player.camDist = 22;
    g.keys.KeyW = true;
    const vento = g.spawnCar('vento', 0x2b3a55, -120, -7, Math.PI / 2);
    vento.speed = 42; vento.kind = 'mission'; g.scene.add(vento.mesh);
    const carguero = g.spawnCar('carguero', 0x8e2f32, -120, 7, Math.PI / 2);
    carguero.speed = 42; carguero.kind = 'mission'; g.scene.add(carguero.mesh);
    [vento, carguero].forEach(c => { c.ai = { axis: 'z', dir: 1, targetSpeed: 42, wait: 0, convoy: true, lead: furia }; });
    if (!g.police.heli) g.police.spawnHeli();
    if (g.police.heli) {
      g.police.heli.position.set(-120, 60, 40);
      g.police.heli.rotation.y = -Math.PI / 2;
      if (g.police.heliLight) {
        g.police.heliLight.target.position.set(-120, 0, 10);
        g.police.heliLight.target.updateMatrixWorld(); g.police.heliLight.intensity = 1200;
      }
    }
    g.police.clearRoadblocks();
    const spikePos = { x: -100, z: 55 };
    const spikeGeo = new THREE.PlaneGeometry(14, 0.8);
    const spikeMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.3, metalness: 0.7, emissive: 0x333333, emissiveIntensity: 0.3 });
    const spikeStrip = new THREE.Mesh(spikeGeo, spikeMat);
    spikeStrip.rotation.x = -Math.PI / 2; spikeStrip.position.set(spikePos.x, 0.09, spikePos.z); g.scene.add(spikeStrip);
    g.traffic.spawn(3, { x: -150, z: -100 }, 60); g.peds.spawn(4, { x: -120, z: 20 }, 40);
    g.tod = 0.95; g.updateTimeOfDay(0);
  } else if (shot === 'heist-getaway-aerial') {
    // HEIST GETAWAY — Aerial Top-Down (heli POV)
    // Shows convoy from above, spike strip ahead, city walls closing
    const furia = g.spawnCar('furia', 0xf2c230, -100, 0, Math.PI / 2);
    g.enterCar(furia);
    furia.speed = 42;
    furia.upgrades = { armor: 1, engine: 2, tires: 2 };
    furia.applyUpgrades(furia.upgrades);
    g.player.pos.copy(furia.pos);
    g.player.heading = Math.PI / 2;
    g.player.camYaw = Math.PI / 2 + Math.PI;
    g.player.camPitch = 0.02; // nearly straight down
    g.player.camDist = 50;
    g.keys.KeyW = true;
    const vento = g.spawnCar('vento', 0x2b3a55, -100, -7, Math.PI / 2);
    vento.speed = 42; vento.kind = 'mission'; g.scene.add(vento.mesh);
    const carguero = g.spawnCar('carguero', 0x8e2f32, -100, 7, Math.PI / 2);
    carguero.speed = 42; carguero.kind = 'mission'; g.scene.add(carguero.mesh);
    [vento, carguero].forEach(c => { c.ai = { axis: 'z', dir: 1, targetSpeed: 42, wait: 0, convoy: true, lead: furia }; });
    if (!g.police.heli) g.police.spawnHeli();
    g.police.clearRoadblocks();
    const spikePos = { x: -80, z: 55 };
    const spikeGeo = new THREE.PlaneGeometry(14, 0.8);
    const spikeMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.3, metalness: 0.7, emissive: 0x333333, emissiveIntensity: 0.3 });
    const spikeStrip = new THREE.Mesh(spikeGeo, spikeMat);
    spikeStrip.rotation.x = -Math.PI / 2; spikeStrip.position.set(spikePos.x, 0.09, spikePos.z); g.scene.add(spikeStrip);
    g.traffic.spawn(3, { x: -150, z: -100 }, 60); g.peds.spawn(4, { x: -120, z: 20 }, 40);
    g.tod = 0.95; g.updateTimeOfDay(0);
  } else if (shot === 'heist-getaway-rear') {
    // HEIST GETAWAY — Rear Formation (pursuit view)
    // Camera behind Carguero, seeing Furia + Vento ahead, heli beam behind
    const furia = g.spawnCar('furia', 0xf2c230, -60, 0, Math.PI / 2);
    furia.speed = 42;
    furia.upgrades = { armor: 1, engine: 2, tires: 2 };
    furia.applyUpgrades(furia.upgrades);
    const vento = g.spawnCar('vento', 0x2b3a55, -60, -7, Math.PI / 2);
    vento.speed = 42; vento.kind = 'mission'; g.scene.add(vento.mesh);
    const carguero = g.spawnCar('carguero', 0x8e2f32, -60, 7, Math.PI / 2);
    g.enterCar(carguero); // player in rear car
    carguero.speed = 42; carguero.kind = 'mission';
    g.player.pos.copy(carguero.pos); g.player.heading = Math.PI / 2;
    g.player.camYaw = Math.PI / 2 + Math.PI; g.player.camPitch = 0.2; g.player.camDist = 10;
    g.keys.KeyW = true;
    [vento, furia].forEach(c => { c.ai = { axis: 'z', dir: 1, targetSpeed: 42, wait: 0, convoy: true, lead: carguero }; });
    if (!g.police.heli) g.police.spawnHeli();
    if (g.police.heli) {
      g.police.heli.position.set(-60, 55, -40); // behind convoy
      g.police.heli.rotation.y = Math.PI / 2;
      if (g.police.heliLight) {
        g.police.heliLight.target.position.set(-60, 0, -10);
        g.police.heliLight.target.updateMatrixWorld(); g.police.heliLight.intensity = 1200;
      }
    }
    g.police.clearRoadblocks();
    g.tod = 0.95; g.updateTimeOfDay(0);
  } else if (shot === 'midnight-grand-prix-pole') {
    // MIDNIGHT GRAND PRIX — Pole Position (driver POV)
    // Low, cockpit-adjacent, start lights filling view, neon reflection on hood
    const cars = []; const startX = -180; const startZ = 100;
    const colors = [0xf2c230, 0xff4444, 0x44ff44, 0x4488ff, 0xff8844, 0xff44ff, 0x88ff44, 0xffff44];
    const types = ['furia', 'vento', 'furia', 'vento', 'furia', 'vento', 'furia', 'vento'];
    for (let i = 0; i < 8; i++) {
      const car = g.spawnCar(types[i], colors[i], startX, startZ + (i - 3.5) * 5.5, Math.PI);
      car.speed = 0; car.upgrades = { armor: 0, engine: 2, tires: 2 }; car.applyUpgrades(car.upgrades);
      if (i % 2 === 0) g.particles.smoke({ x: car.pos.x, y: 0.4, z: car.pos.z }, 2);
      cars.push(car); g.scene.add(car.mesh);
    }
    g.enterCar(cars[3]); // pole position (index 3 = center-left)
    g.player.pos.set(cars[3].pos.x, 1.2, cars[3].pos.z + 1.5); // hood level
    g.player.heading = Math.PI; g.player.camYaw = Math.PI; g.player.camPitch = 0.35; g.player.camDist = 5;
    const lightGeo = new THREE.SphereGeometry(0.6, 16, 12);
    for (let i = 0; i < 5; i++) {
      const light = new THREE.Mesh(lightGeo, new THREE.MeshBasicMaterial({ color: i < 4 ? 0xff2222 : 0x22ff22, transparent: true, opacity: 1 }));
      light.position.set(startX - 8, 4.5, startZ + (i - 2) * 5.5); g.scene.add(light);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: i < 4 ? 0xff2222 : 0x22ff22, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.position.copy(light.position); glow.scale.setScalar(3); g.scene.add(glow);
    }
    for (let i = 0; i < 3; i++) {
      const ringGeo = new THREE.RingGeometry(10, 11, 32);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.4, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
      const ring = new THREE.Mesh(ringGeo, ringMat); ring.rotation.x = -Math.PI / 2; ring.position.set(startX, 0.1, startZ + 40 + i * 35); g.scene.add(ring);
    }
    g.traffic.cars.forEach(c => g.scene.remove(c.mesh)); g.traffic.cars = [];
    g.tod = 0.5; g.updateTimeOfDay(0); // noon: the pole shot faces away from the low sun, dusk left it black
  } else if (shot === 'midnight-grand-prix-wide') {
    // MIDNIGHT GRAND PRIX — Wide Grid (full 8-car symmetry)
    // High angle, centered, neon Coral Row stretching both ways
    const cars = []; const startX = -180; const startZ = 100;
    const colors = [0xf2c230, 0xff4444, 0x44ff44, 0x4488ff, 0xff8844, 0xff44ff, 0x88ff44, 0xffff44];
    const types = ['furia', 'vento', 'furia', 'vento', 'furia', 'vento', 'furia', 'vento'];
    for (let i = 0; i < 8; i++) {
      const car = g.spawnCar(types[i], colors[i], startX, startZ + (i - 3.5) * 5.5, Math.PI);
      car.speed = 0; car.upgrades = { armor: 0, engine: 2, tires: 2 }; car.applyUpgrades(car.upgrades);
      if (i % 2 === 0) g.particles.smoke({ x: car.pos.x, y: 0.4, z: car.pos.z }, 2);
      cars.push(car); g.scene.add(car.mesh);
    }
    g.enterCar(cars[3]);
    g.player.pos.set(startX + 10, 15, startZ + 20); // elevated corner
    g.player.heading = Math.PI; g.player.camYaw = Math.PI * 0.8; g.player.camPitch = 0.1; g.player.camDist = 28;
    const lightGeo = new THREE.SphereGeometry(0.6, 16, 12);
    for (let i = 0; i < 5; i++) {
      const light = new THREE.Mesh(lightGeo, new THREE.MeshBasicMaterial({ color: i < 4 ? 0xff2222 : 0x22ff22, transparent: true, opacity: 1 }));
      light.position.set(startX - 8, 4.5, startZ + (i - 2) * 5.5); g.scene.add(light);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: i < 4 ? 0xff2222 : 0x22ff22, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.position.copy(light.position); glow.scale.setScalar(2.5); g.scene.add(glow);
    }
    for (let i = 0; i < 3; i++) {
      const ringGeo = new THREE.RingGeometry(10, 11, 32);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.4, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
      const ring = new THREE.Mesh(ringGeo, ringMat); ring.rotation.x = -Math.PI / 2; ring.position.set(startX, 0.1, startZ + 40 + i * 35); g.scene.add(ring);
    }
    for (let side of [-1, 1]) { for (let i = 0; i < 12; i++) {
      const ped = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.4, 4, 8), new THREE.MeshBasicMaterial({ color: 0x1a1a2e }));
      ped.position.set(startX + side * 14, 0.7, startZ + (i - 5.5) * 5.5); ped.rotation.y = -side * Math.PI / 2; g.scene.add(ped);
    }}
    g.traffic.cars.forEach(c => g.scene.remove(c.mesh)); g.traffic.cars = [];
    g.tod = 0.72; g.updateTimeOfDay(0); // golden hour (0.0 was midnight, black)
  } else if (shot === 'midnight-grand-prix-neon') {
    // MIDNIGHT GRAND PRIX — Neon Reflection Close-Up
    // Extreme low angle, clearcoat reflecting Coral Row signs, start light bokeh
    const cars = []; const startX = -180; const startZ = 100;
    const colors = [0xf2c230, 0xff4444, 0x44ff44, 0x4488ff, 0xff8844, 0xff44ff, 0x88ff44, 0xffff44];
    const types = ['furia', 'vento', 'furia', 'vento', 'furia', 'vento', 'furia', 'vento'];
    for (let i = 0; i < 8; i++) {
      const car = g.spawnCar(types[i], colors[i], startX, startZ + (i - 3.5) * 5.5, Math.PI);
      car.speed = 0; car.upgrades = { armor: 0, engine: 2, tires: 2 }; car.applyUpgrades(car.upgrades);
      if (i % 2 === 0) g.particles.smoke({ x: car.pos.x, y: 0.4, z: car.pos.z }, 2);
      cars.push(car); g.scene.add(car.mesh);
    }
    g.enterCar(cars[3]);
    g.player.pos.set(cars[3].pos.x - 1.5, 0.3, cars[3].pos.z + 3); // ground level, side
    g.player.heading = Math.PI; g.player.camYaw = Math.PI * 1.1; g.player.camPitch = 0.6; g.player.camDist = 3;
    const lightGeo = new THREE.SphereGeometry(0.6, 16, 12);
    for (let i = 0; i < 5; i++) {
      const light = new THREE.Mesh(lightGeo, new THREE.MeshBasicMaterial({ color: i < 4 ? 0xff2222 : 0x22ff22, transparent: true, opacity: 1 }));
      light.position.set(startX - 8, 4.5, startZ + (i - 2) * 5.5); g.scene.add(light);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: i < 4 ? 0xff2222 : 0x22ff22, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.position.copy(light.position); glow.scale.setScalar(4); g.scene.add(glow);
    }
    g.traffic.cars.forEach(c => g.scene.remove(c.mesh)); g.traffic.cars = [];
    g.tod = 0.0; g.updateTimeOfDay(0);
  }
  // Let the world settle for a beat so the first rendered frame is composed.
  g.warmupFrames = 30;
}
