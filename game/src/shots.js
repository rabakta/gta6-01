// BRISA BAY — screenshot staging. `?shot=menu|foot|chase|mission` drops the
// game straight into a composed scene so a screenshot shows the systems at
// their best, with no menu in the way. Used only for the entry's screenshots.
export function shotParam() {
  const q = new URLSearchParams(location.search);
  return q.get('shot');
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
    g.setWanted(3);
    g.police.update(0.1, 3, g.player.pos, true, g.allCars());
    g.police.update(0.1, 3, g.player.pos, true, g.allCars());
    g.traffic.spawn(8, { x: -60, z: 60 }, 130);
    g.peds.spawn(8, { x: -60, z: 60 }, 80);
    g.missions.startMission(5);
    g.player.camDist = 11;
  } else if (shot === 'mission') {
    // Mission 3 in progress: package run at the docks, two stars, guards.
    g.missions.startMission(2);
    g.missions.stepIndex = 1; // the collect step
    g.missions.beginStep();
    g.player.pos.set(150, 0, -150);
    g.player.heading = Math.PI / 2;
    g.player.camYaw = Math.PI / 2 + Math.PI;
    g.setWanted(2);
    g.police.update(0.1, 2, g.player.pos, false, g.allCars());
    g.traffic.spawn(6, { x: 150, z: -150 }, 110);
    g.peds.spawn(6, { x: 150, z: -150 }, 70);
    g.player.camDist = 9;
  }
  // Let the world settle for a beat so the first rendered frame is composed.
  g.warmupFrames = 30;
}
