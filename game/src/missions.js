// BRISA BAY — the story: eight chapters of Rio Marin's return to Brisa Bay.
// A mission is a list of steps; the manager runs them in order, plants a
// beacon on the current objective, and pays out when the last step clears.
import * as THREE from 'three';
import { MISSION_META } from './config.js';
import { dist2 } from './utils.js';

const MISSIONS = [
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
      { type: 'goto', x: 0, z: -180, radius: 10, text: 'Get inside the Solmar Casino' },
      { type: 'collect', x: 0, z: -180, radius: 5, text: 'Empty the vault' },
      { type: 'driveTo', x: -150, z: 150, radius: 10, text: 'Five stars. Get home, Rio.', wanted: 5 },
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
    this.kills = 0;
    this.beacon = null;
    this.marker = null;
    this.packageMesh = null;
    this.rival = null;
    this.guards = [];
    this.targetCar = null;
    this.failReason = '';
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
      if (step.type === 'timed') t += '  [' + Math.max(0, Math.ceil(this.timer)) + 's]';
      if (step.type === 'eliminate') t += '  (' + this.kills + '/' + step.count + ')';
      return 'MISSION ' + (this.active + 1) + ' - ' + this.meta.name + ': ' + t;
    }
    if (this.state === 'done') return 'Mission complete - ' + this.meta.name;
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
    if (step.type === 'eliminate') {
      this.kills = 0;
      this.guards = this.game.peds.spawnGuards(step.spawn, 60);
    }
    if (step.type === 'ram' && !this.rival) {
      const g = this.game;
      const x = g.player.pos.x + 40, z = g.player.pos.z - 20;
      this.rival = g.spawnCar('vento', 0x8e2f32, x, z, 0);
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
    this.state = 'done';
    const reward = this.meta.reward;
    this.game.save.cash += reward;
    this.game.save.missionIndex = Math.max(this.game.save.missionIndex, this.active + 1);
    this.game.save.stats.missionsDone++;
    this.game.writeSave();
    this.game.audio.jingle();
    this.game.notify('Mission complete! +' + '$' + reward.toLocaleString('en-US'));
    this.game.setWanted(0);
    this.cleanupEntities();
    this.active = -1;
    this.stepIndex = 0;
  }

  fail(reason) {
    this.clearMarker();
    this.state = 'failed';
    this.failReason = reason;
    this.game.audio.fail();
    this.game.notify('Mission failed - ' + reason + '. Press M to retry.');
    this.cleanupEntities();
    this.active = -1;
    this.stepIndex = 0;
  }

  cleanupEntities() {
    if (this.rival) { this.game.removeCar(this.rival); this.rival = null; }
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

  update(dt) {
    if (this.state !== 'active' || !this.currentStep) return;
    const step = this.currentStep;
    const g = this.game;
    const p = g.player.pos;
    if (this.beacon) {
      this.beacon.rotation.y += dt * 0.8;
      this.beacon.material.opacity = 0.22 + Math.sin(performance.now() / 300) * 0.08;
    }
    if (this.packageMesh) this.packageMesh.rotation.y += dt * 2;
    if (step.type === 'timed') {
      this.timer -= dt;
      if (this.timer <= 0) { this.fail('Out of time'); return; }
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
    }
  }
}
