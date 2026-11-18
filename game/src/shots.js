// BRISA BAY — screenshot staging. `?shot=menu|foot|chase|mission` drops the
// game straight into a composed scene so a screenshot shows the systems at
// their best, with no menu in the way. `?shot=garage` opens the garage shop
// for a verification shot. The race shot is the Grand Prix cover, taxi
// shows a fare offer with passenger and amber beacon in frame, packages
// shows Rio on foot beside a gold collectible parcel, and street is the
// busy-city cover: Rio on a Moto weaving toward a dwelling bus. Used only
// for the entry's screenshots and for testing the new systems.
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
    g.state = 'menu';
    g.hud.showMenu('start', 'BRISA BAY', g.startMenuBody(), 'Press ENTER to start');
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
    g.missions.startMission(8); // Sunset Run: the timed delivery
    g.player.camDist = 11;
  } else if (shot === 'mission') {
    // Mission 10 in progress: Lose the Tail. Rio in a Furia on the
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
    g.missions.startMission(9);
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
    // Row (x=-180 road, facing south toward the first checkpoint), the
    // race already running. The goto step completes on the first update
    // frame — Rio is already on the line — and the race step spawns the
    // mission Furia and the two rival Ventos ahead of him, with the gold
    // checkpoint beacon 60m down the road. (Same ~0.15s rule as the chase
    // shot: stage it, don't drive it.)
    const car = g.spawnCar('furia', 0xf2c230, -180, 120, Math.PI);
    g.enterCar(car);
    car.speed = 20;
    g.player.pos.copy(car.pos); // see chase: staging reads player.pos
    g.player.heading = car.heading;
    g.player.camYaw = car.heading + Math.PI; // see chase: no mid-swing camera
    g.keys.KeyW = true;
    g.missions.startMission(10);
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
  }
  // Let the world settle for a beat so the first rendered frame is composed.
  g.warmupFrames = 30;
}
