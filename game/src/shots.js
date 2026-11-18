// BRISA BAY — screenshot staging. `?shot=menu|foot|chase|mission` drops the
// game straight into a composed scene so a screenshot shows the systems at
// their best, with no menu in the way. Used only for the entry's screenshots.
export function shotParam() {
  const q = new URLSearchParams(location.search);
  return q.get('shot');
}

// Put `count` BCPD cars on the street at once, with the helicopter up.
// (The live police manager paces spawns at one per 2.5s, so staging through
// update() could only ever show a single car in the frame.)
function stagePolice(g, count) {
  g.setWanted(3);
  for (let i = 0; i < count; i++) {
    // Point each unit at Rio so the chase reads in the frame.
    const car = g.police.spawnOne(g.player.pos);
    car.heading = Math.atan2(g.player.pos.x - car.pos.x, g.player.pos.z - car.pos.z);
    car.syncMesh();
  }
  // One update tick brings the helicopter in (wanted >= 3).
  g.police.update(0.1, 3, g.player.pos, true, g.allCars());
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
    // Rio on foot downtown, traffic and pedestrians around him.
    g.player.pos.set(-30, 0, 30);
    g.player.heading = Math.PI * 0.75;
    g.player.camYaw = Math.PI * 0.75 + Math.PI;
    g.traffic.spawn(10, { x: -30, z: 30 }, 120);
    g.peds.spawn(14, { x: -30, z: 30 }, 90);
    g.missions.startMission(0);
    g.player.camDist = 8;
  } else if (shot === 'chase') {
    // Driving fast with a 3-star wanted level: two BCPD cars and the heli.
    const car = g.spawnCar('furia', 0xf2c230, -60, 60, Math.PI / 2);
    g.enterCar(car);
    car.speed = 24;
    // Hold the throttle down so the car is still at speed when the frame
    // is captured (without input it coasts to a stop in ~3 seconds).
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
    stagePolice(g, 2);
    g.traffic.spawn(8, { x: 60, z: -60 }, 130);
    g.peds.spawn(8, { x: -60, z: 60 }, 80);
    g.missions.startMission(5);
    g.player.camDist = 11;
  } else if (shot === 'mission') {
    // Mission 3 in progress: package run at the docks, three stars, heli up.
    // Staged east of the SPRAY & GO shop (150,-150) so its sign board is
    // nowhere near the camera; Rio faces the docks package and the sea.
    g.missions.startMission(2);
    g.missions.stepIndex = 1; // the collect step
    g.missions.beginStep();
    g.player.pos.set(170, 0, -132);
    g.player.heading = 2.63; // facing the package at (180,-150)
    g.player.camYaw = 2.63 + Math.PI;
    stagePolice(g, 2);
    g.traffic.spawn(6, { x: 170, z: -132 }, 110);
    g.peds.spawn(6, { x: 170, z: -132 }, 70);
    g.player.camDist = 9;
  }
  // Let the world settle for a beat so the first rendered frame is composed.
  g.warmupFrames = 30;
}
