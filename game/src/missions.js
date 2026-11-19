// BRISA BAY — the story: twelve chapters of Rio Marin's return to
// Brisa Bay. A mission is a list of steps; the manager runs them in order,
// plants a beacon on the current objective, and pays out when the last
// step clears. Two later chapters add a checkpoint street race (Midnight
// Grand Prix, new `race` step type) and the finale (The Last Ferry), and
// fix Mission 8 — its first two steps sat on the casino tower itself,
// so the radii could never be reached from outside the building.
import * as THREE from 'three';
import { MISSION_META, RACE_CHECKPOINTS } from './config.js';
import { dist2, mulberry32, randomPointInCircle, angleDiff, clamp } from './utils.js';

// Exported so tests (and future rounds) can check every step's
// coordinates against the real city colliders.
export const MISSIONS = [
  {
    steps: [
      { type: 'goto', x: -150, z: 150, radius: 10, text: 'Reach the safehouse on Coral Row' },
    ],
  },
  {
    steps: [
      { type: 'steal', x: 180, z: 150, defKey: 'furia', color: 0xf2c230, text: 'Steal the yellow Furia GT at the marina' },
      { type: 'driveTo', x: 150, z: -150, radius: 10, text: 'Deliver the Furia to the garage' },
    ],
  },
  {
    steps: [
      { type: 'goto', x: 180, z: -150, radius: 8, text: 'Pick up the package at the docks' },
      { type: 'collect', x: 180, z: -150, radius: 4, text: 'Grab the package' },
      { type: 'driveTo', x: -150, z: 150, radius: 10, text: 'Bring the package home - the BCPD is onto you', wanted: 2 },
    ],
  },
  {
    steps: [
      { type: 'ram', text: 'Ram Vex\u2019s Vento until it burns' },
      { type: 'driveTo', x: -150, z: 150, radius: 10, text: 'Lay low at the safehouse' },
    ],
  },
  {
    steps: [
      { type: 'goto', x: 120, z: -120, radius: 10, text: 'Reach the warehouse on foot - stay quiet' },
      { type: 'eliminate', count: 3, spawn: [{ x: 112, z: -118 }, { x: 128, z: -126 }, { x: 120, z: -110 }], text: 'Deal with the three guards' },
      { type: 'collect', x: 120, z: -120, radius: 4, text: 'Take the case from the warehouse' },
      { type: 'goto', x: -150, z: 150, radius: 10, text: 'Get the case back to the safehouse' },
    ],
  },
  {
    steps: [
      { type: 'timed', x: 210, z: 0, radius: 10, seconds: 90, text: 'Cross the bridge in 90 seconds - three stars and counting', wanted: 3 },
    ],
  },
  {
    steps: [
      { type: 'steal', x: 180, z: -150, defKey: 'caminar', color: 0x9c6b3c, text: 'Take the Caminar truck at the docks' },
      { type: 'driveTo', x: -180, z: -180, radius: 12, text: 'Drive the truck to the airfield - through the roadblocks', wanted: 2 },
    ],
  },
  {
    steps: [
      // The Solmar Casino tower sits on the (0,-180) intersection
      // itself, so the centre of the building is inside a collider and no
      // player can ever stand within 10m of it. The radii here reach the
      // tower's faces (closest approach ~14m), so the steps complete from
      // the south door instead of never completing at all.
      { type: 'goto', x: 0, z: -180, radius: 18, text: 'Get inside the Solmar Casino' },
      { type: 'collect', x: 0, z: -180, radius: 16, text: 'Empty the vault' },
      { type: 'driveTo', x: -150, z: 150, radius: 10, text: 'Five stars. Get home, Rio.', wanted: 5 },
    ],
  },
  {
    steps: [
      { type: 'goto', x: 180, z: -150, radius: 8, text: 'Pick up the sunset parcel at the docks' },
      { type: 'collect', x: 180, z: -150, radius: 4, text: 'Grab the parcel' },
      { type: 'timed', x: -180, z: -180, radius: 12, seconds: 75, text: 'Deliver it to the airfield in 75 seconds', wanted: 2 },
    ],
  },
  {
    steps: [
      { type: 'evade', seconds: 60, text: 'Lose the tail - keep Vex off you for 60 seconds' },
      { type: 'driveTo', x: -150, z: 150, radius: 10, text: 'Get home to the safehouse' },
    ],
  },
  // Mission 11 — the Grand Prix. The goto step puts Rio on the start line
  // at Coral Row; the race step spawns the mission Furia and two rival
  // Ventos and runs the six checkpoints around the city, timed at 150s.
  // The rivals drive the same route at a steady pace, so the race is won
  // by clean driving, not by outrunning a scripted ghost.
  {
    steps: [
      { type: 'goto', x: -180, z: 120, radius: 10, text: 'Meet Vex at the Coral Row start line' },
      {
        type: 'race',
        startX: -180,
        startZ: 110,
        checkpoints: RACE_CHECKPOINTS,
        seconds: 150,
        text: 'Beat the rivals around all 6 checkpoints',
      },
      { type: 'goto', x: 0, z: 0, radius: 10, text: 'Collect the prize at the Plaza' },
    ],
  },
  // Mission 12 — the finale. Steal the fast car at the marina (parked just
  // south of the hotel, clear of its collider), make the ferry terminal
  // at the docks, then a five-star escape drive to the airfield. When this
  // pays out, the story is complete.
  {
    steps: [
      { type: 'goto', x: 180, z: 120, radius: 10, text: 'Reach the Marina' },
      { type: 'steal', x: 180, z: 130, defKey: 'furia', color: 0xd94f43, text: 'Steal the red Furia GT — the fastest car in town' },
      { type: 'goto', x: 180, z: -150, radius: 10, text: 'Reach the ferry terminal at the docks' },
      { type: 'timed', x: -180, z: -180, radius: 12, seconds: 120, wanted: 5, text: '5-star escape — reach the airfield in 120s' },
    ],
  },
];

export class MissionManager {
  // `game` is the main game object (player, world, traffic, police, peds,
  // combat, audio, hud, save, spawnCar, addWanted, setWanted, notify).
  constructor(game) {
    this.game = game;
    this.active = -1; // mission index, -1 = free roam
    this.stepIndex = 0;
    this.state = 'idle'; // idle | active | done | failed
    this.timer = 0;
    this.caughtTimer = 0; // evade: how long the tail has sat on Rio
    this.kills = 0;
    this.beacon = null;
    this.marker = null;
    this.packageMesh = null;
    this.rival = null;
    this.tail = null; // evade step: Vex's chasing Vento
    this.guards = [];
    this.targetCar = null;
    this.racers = []; // race step: the rival cars
    this.raceIndex = 0; // race step: which checkpoint Rio is chasing
    this.failReason = '';
    this.doneName = '';
    this.scene = game.scene;
  }

  get meta() { return this.active >= 0 ? MISSION_META[this.active] : null; }
  get currentStep() {
    if (this.active < 0) return null;
    return MISSIONS[this.active].steps[this.stepIndex] || null;
  }

  objectiveText() {
    if (this.state === 'active' && this.currentStep) {
      const step = this.currentStep;
      let t = step.text;
      if (step.type === 'timed' || step.type === 'evade') t += '  [' + Math.max(0, Math.ceil(this.timer)) + 's]';
      if (step.type === 'race') t += '  CHECKPOINT ' + (this.raceIndex + 1) + '/' + step.checkpoints.length + '  [' + Math.max(0, Math.ceil(this.timer)) + 's]';
      if (step.type === 'evade' && this.caughtTimer > 0) t += '  - SHAKE HIM!';
      if (step.type === 'eliminate') t += '  (' + this.kills + '/' + step.count + ')';
      return 'MISSION ' + (this.active + 1) + ' - ' + this.meta.name + ': ' + t;
    }
    if (this.state === 'done') return 'Mission complete - ' + this.doneName;
    if (this.state === 'failed') return 'Mission failed - ' + this.failReason;
    const next = this.game.save.missionIndex;
    if (next >= MISSIONS.length) return 'Story complete - Brisa Bay is yours. Free roam, Rio.';
    return 'Next: ' + MISSION_META[next].name + ' - press M to start the mission';
  }

  startMission(index) {
    if (index < 0 || index >= MISSIONS.length) return false;
    this.cleanup();
    this.active = index;
    this.stepIndex = 0;
    this.state = 'active';
    this.timer = 0;
    this.caughtTimer = 0;
    this.kills = 0;
    this.beginStep();
    this.game.audio.jingle();
    this.game.notify('Mission ' + (index + 1) + ': ' + this.meta.name + ' - ' + this.meta.brief);
    return true;
  }

  beginStep() {
    this.clearMarker();
    const step = this.currentStep;
    if (!step) { this.complete(); return; }
    if (step.wanted) this.game.setWanted(step.wanted);
    if (step.type === 'timed') this.timer = step.seconds;
    if (step.type === 'race') {
      // The race: a mission Furia on the start line (so a player who
      // walked here can race too) and two rival Ventos ahead of it, all
      // facing south down the x=-180 road toward the first checkpoint.
      this.timer = step.seconds;
      this.raceIndex = 0;
      this.racers = [];
      this.targetCar = this.game.spawnCar('furia', 0xf2c230, step.startX, step.startZ, Math.PI);
      this.targetCar.kind = 'mission';
      // Two rival Ventos ahead of the start line, derived from the step's
      // own start point so the race survives a start-line move.
      for (const s of [{ x: step.startX, z: step.startZ - 10 }, { x: step.startX, z: step.startZ - 25 }]) {
        const r = this.game.spawnCar('vento', 0x8e2f32, s.x, s.z, Math.PI);
        r.kind = 'race';
        r.raceIndex = 0;
        this.racers.push(r);
      }
      this.placeMarker(step.checkpoints[0].x, step.checkpoints[0].z);
    }
    if (step.type === 'evade') {
      // Vex's tail: a Vento that chases Rio for the whole step. It starts
      // on a ring 38m out, so Rio always gets a head start — the step is
      // won by driving, not by spawning luck.
      this.timer = step.seconds;
      this.caughtTimer = 0;
      const g = this.game;
      const a = Math.random() * Math.PI * 2;
      const spot = { x: g.player.pos.x + Math.sin(a) * 38, z: g.player.pos.z + Math.cos(a) * 38 };
      this.tail = g.spawnCar('vento', 0x8e2f32, spot.x, spot.z, 0);
      this.tail.kind = 'tail';
      this.tail.ai = { axis: 'x', dir: 1, targetSpeed: 17, wait: 0 };
      g.notify('Vex is on your tail - do not let him touch you!');
    }
    if (step.type === 'eliminate') {
      this.kills = 0;
      this.guards = this.game.peds.spawnGuards(step.spawn, 60);
    }
    if (step.type === 'ram' && !this.rival) {
      const g = this.game;
      // Vex starts somewhere on the streets nearby, not at a fixed offset.
      const spot = randomPointInCircle(mulberry32((Date.now() % 100000) + 3), g.player.pos.x, g.player.pos.z, 45);
      this.rival = g.spawnCar('vento', 0x8e2f32, spot.x, spot.z, 0);
      this.rival.kind = 'rival';
      this.rival.ai = { axis: 'x', dir: 1, targetSpeed: 16, wait: 0 };
      g.notify('Vex is running - catch his Vento and ram it!');
    }
    if (step.type === 'steal') {
      this.targetCar = this.game.spawnCar(step.defKey, step.color, step.x, step.z, Math.PI / 2);
      this.targetCar.kind = 'mission';
      this.placeMarker(step.x, step.z);
    } else if (step.type === 'collect') {
      this.placePackage(step.x, step.z);
      this.placeMarker(step.x, step.z);
    } else if (step.x !== undefined) {
      this.placeMarker(step.x, step.z);
    }
    // Toast every new step so the player always knows what changed.
    if (this.stepIndex > 0) this.game.notify(step.text);
    // The banner says the same thing, big and gold — a step change is the
    // one moment the player must not miss while driving.
    if (this.game.hud) this.game.hud.banner(this.objectiveText());
  }

  placeMarker(x, z) {
    const geo = new THREE.CylinderGeometry(2.2, 2.2, 40, 16, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
    this.beacon = new THREE.Mesh(geo, mat);
    this.beacon.position.set(x, 20, z);
    this.scene.add(this.beacon);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3, 4.2, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.15, z);
    this.scene.add(ring);
    this.marker = ring;
    this.markerPos = { x, z };
  }

  placePackage(x, z) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.7, 1),
      new THREE.MeshBasicMaterial({ color: 0xffd34d }),
    );
    m.position.set(x, 0.9, z);
    this.scene.add(m);
    this.packageMesh = m;
  }

  clearMarker() {
    if (this.beacon) { this.scene.remove(this.beacon); this.beacon = null; }
    if (this.marker) { this.scene.remove(this.marker); this.marker = null; }
    if (this.packageMesh) { this.scene.remove(this.packageMesh); this.packageMesh = null; }
    this.markerPos = null;
  }

  nextStep() {
    this.clearMarker();
    this.stepIndex++;
    if (this.stepIndex >= MISSIONS[this.active].steps.length) this.complete();
    else this.beginStep();
  }

  complete() {
    this.clearMarker();
    // The finale: the story is over, so the objective line falls through
    // to the idle branch ("Story complete") instead of sitting on
    // "Mission complete" forever — there is no next mission to start.
    this.state = this.active + 1 >= MISSIONS.length ? 'idle' : 'done';
    // Capture the name first: active is cleared below, and the 'done'
    // objective line reads it every frame — reading this.meta after
    // clearing active would be null.name and crash the game loop.
    this.doneName = this.meta.name;
    const reward = this.meta.reward;
    this.game.save.cash += reward;
    this.game.save.missionIndex = Math.max(this.game.save.missionIndex, this.active + 1);
    this.game.save.stats.missionsDone++;
    this.game.writeSave();
    this.game.audio.jingle();
    this.game.notify('Mission complete! +' + '$' + reward.toLocaleString('en-US'));
    if (this.game.hud) {
      this.game.hud.showMissionSplash({
        kind: 'complete', title: 'MISSION COMPLETE', name: this.doneName,
        lines: ['Reward $' + reward.toLocaleString('en-US'), 'Missions done ' + this.game.save.stats.missionsDone, 'Cash $' + this.game.save.cash.toLocaleString('en-US')],
      });
    }
    this.game.setWanted(0);
    this.cleanupEntities();
    this.active = -1;
    this.stepIndex = 0;
  }

  fail(reason) {
    this.clearMarker();
    // Capture the name first: active is cleared below, and meta reads it.
    const name = this.meta ? this.meta.name : 'Mission';
    this.state = 'failed';
    this.failReason = reason;
    this.game.audio.fail();
    this.game.notify('Mission failed - ' + reason + '. Press M to retry.');
    // A fail splash only in live play — when Rio dies the WASTED screen
    // owns the moment instead, and the fail line would double up under it.
    if (this.game.state === 'playing' && this.game.hud) {
      this.game.hud.showMissionSplash({
        kind: 'fail', title: 'MISSION FAILED', name,
        lines: [reason, 'Press M to retry'],
      });
    }
    this.cleanupEntities();
    this.active = -1;
    this.stepIndex = 0;
  }

  cleanupEntities() {
    if (this.rival) { this.game.removeCar(this.rival); this.rival = null; }
    if (this.tail) { this.game.removeCar(this.tail); this.tail = null; }
    for (const r of this.racers) this.game.removeCar(r);
    this.racers = [];
    for (const g of this.guards) this.game.peds.remove(g);
    this.guards = [];
    this.targetCar = null;
  }

  cleanup() {
    this.clearMarker();
    this.cleanupEntities();
  }

  // Called by combat when a guard dies.
  onGuardKilled() {
    if (this.state !== 'active' || !this.currentStep || this.currentStep.type !== 'eliminate') return;
    this.kills++;
    if (this.kills >= this.currentStep.count) this.nextStep();
  }

  onRivalDead() {
    if (this.state === 'active' && this.currentStep && this.currentStep.type === 'ram') {
      this.game.notify('Vex\u2019s Vento is burning. Nice work.');
      this.nextStep();
    }
  }

  // A rival drives at a checkpoint like a police unit drives at Rio:
  // steer at the target, ease off the throttle for sharp turns so the
  // car actually makes the corner instead of sliding past the checkpoint
  // and looping back. Rivals run a steady 20 m/s — fast enough to win
  // if Rio dawdles, slow enough to beat in a Furia.
  raceDrive(car, target, dt) {
    const dx = target.x - car.pos.x, dz = target.z - car.pos.z;
    const targetHeading = Math.atan2(dx, dz);
    const turn = angleDiff(car.heading, targetHeading);
    const steer = clamp(-turn * 1.6, -1, 1);
    const throttle = Math.abs(turn) > 0.6 ? 0.3 : (car.speed < 20 ? 0.85 : 0.2);
    car.drive(dt, throttle, steer, this.game.world.colliders);
  }

  update(dt) {
    if (this.state !== 'active' || !this.currentStep) return;
    const step = this.currentStep;
    const g = this.game;
    const p = g.player.pos;
    if (this.beacon) {
      this.beacon.rotation.y += dt * 0.8;
      this.beacon.material.opacity = 0.22 + Math.sin(performance.now() / 300) * 0.08;
    }
    // The ground ring breathes so the objective reads from far away.
    if (this.marker) {
      const s = 1 + Math.sin(performance.now() / 300) * 0.08;
      this.marker.scale.set(s, s, 1);
    }
    if (this.packageMesh) this.packageMesh.rotation.y += dt * 2;
    if (step.type === 'timed') {
      this.timer -= dt;
      if (this.timer <= 0) { this.fail('Out of time'); return; }
      // The first build only counted the timer down — reaching the bridge
      // never completed the step, so the mission could never be won.
      if (dist2(p.x, p.z, step.x, step.z) < step.radius) { this.nextStep(); return; }
    }
    if (step.type === 'evade') {
      this.timer -= dt;
      if (this.timer <= 0) { this.nextStep(); return; }
      if (this.tail) {
        if (this.tail.dead) {
          // Ramming the tail off the road counts as losing it.
          this.game.notify('Tail\'s gone. Nice driving.');
          this.nextStep();
          return;
        }
        // The tail pursues Rio directly — steering at him like a police
        // unit, not cruising the grid like traffic. It closes fast from
        // range, then creeps in close so it can actually stay on him.
        const dx = p.x - this.tail.pos.x, dz = p.z - this.tail.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        // A tail arriving at 30 m/s would blow straight past Rio and out
        // of the 6m catch radius in one frame, so it never actually
        // catches him. Inside 8m it sheds speed first and pulls alongside.
        if (d < 8 && this.tail.speed > 6) this.tail.speed = 6;
        const targetHeading = Math.atan2(dx, dz);
        const steer = clamp(-angleDiff(this.tail.heading, targetHeading) * 1.6, -1, 1);
        const throttle = d > 10 ? 1 : (d > 6 ? 0.5 : 0.15);
        this.tail.drive(dt, throttle, steer, g.world.colliders);
        if (d < 6) {
          this.caughtTimer += dt;
          if (this.caughtTimer > 1.5) { this.fail('Vex caught up with you'); return; }
        } else {
          this.caughtTimer = Math.max(0, this.caughtTimer - dt * 2);
        }
      }
    }
    if (step.type === 'goto' || step.type === 'driveTo') {
      if (dist2(p.x, p.z, step.x, step.z) < step.radius) this.nextStep();
    } else if (step.type === 'collect') {
      if (dist2(p.x, p.z, step.x, step.z) < step.radius) {
        if (step.wanted) g.setWanted(step.wanted);
        g.audio.blip(1200, 0.12, 0.2);
        this.nextStep();
      }
    } else if (step.type === 'steal') {
      if (g.player.inCar === this.targetCar) {
        g.save.stats.carsStolen++;
        g.notify('That\u2019s the one. Now deliver it.');
        this.nextStep();
      }
    } else if (step.type === 'ram') {
      if (this.rival && this.rival.dead) this.onRivalDead();
      else if (this.rival) {
        // Rival runs: traffic-style driving, faster than normal.
        this.game.trafficLikeDrive(this.rival, dt, 16);
      }
    } else if (step.type === 'race') {
      this.timer -= dt;
      if (this.timer <= 0) { this.fail('Out of time - the Grand Prix is over'); return; }
      const cp = step.checkpoints[this.raceIndex];
      if (cp && dist2(p.x, p.z, cp.x, cp.z) < 8) {
        this.raceIndex++;
        g.audio.blip(1320, 0.12, 0.2);
        if (this.raceIndex >= step.checkpoints.length) { this.nextStep(); return; }
        this.clearMarker();
        const next = step.checkpoints[this.raceIndex];
        this.placeMarker(next.x, next.z);
        g.notify('Checkpoint ' + this.raceIndex + '/' + step.checkpoints.length);
      }
      // The rivals chase the same checkpoints. A rival that finishes
      // first wins the race — and Rio loses it.
      for (const r of this.racers) {
        if (r.dead) continue;
        const target = step.checkpoints[r.raceIndex];
        if (!target) continue;
        if (dist2(r.pos.x, r.pos.z, target.x, target.z) < 8) {
          r.raceIndex++;
          if (r.raceIndex >= step.checkpoints.length) { this.fail('Vex\u2019s crew beat you to the line'); return; }
          continue;
        }
        this.raceDrive(r, target, dt);
      }
    }
  }
}
