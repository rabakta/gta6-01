// BRISA BAY — the story: 17 missions of Jason "Jay" Torres' return to
// Brisa Bay. Chapter 1 (missions 1-5) focuses on street racing and
// rebuilding the Torres Tuning crew. Missions 6-16 continue the story.
// Race missions load special race maps (circuit/sprint/drift/grandprix).
import * as THREE from 'three';
import { MISSION_META, RACE_TRACKS, RACE_CHECKPOINTS } from './config.js';
import { dist2, mulberry32, randomPointInCircle, angleDiff, clamp } from './utils.js';

// Exported so tests can check every step's coordinates against the real city colliders.
export const MISSIONS = [
  // Mission 1: Homecoming (Story)
  {
    steps: [
      { type: 'goto', x: -150, z: 150, radius: 10, text: 'Reach the safehouse on Coral Row' },
    ],
  },
  // Mission 2: First Test (Race - Circuit)
  {
    steps: [
      { type: 'race_start', track: 'circuit', text: 'Miko challenges you: "Show me you still got it."' },
      { type: 'race_circuit', track: 'circuit', text: 'Complete 3 laps of Brisa Circuit. Beat the rivals.', timeLimit: 180 },
    ],
  },
  // Mission 3: Parts Run (Fetch + Race - Sprint)
  {
    steps: [
      { type: 'race_start', track: 'sprint', text: 'Ro needs parts from the docks. Grab them before the tide comes in.' },
      { type: 'race_sprint', track: 'sprint', text: 'Race from Docks to Torres Tuning. Cops on your tail.', timeLimit: 95 },
    ],
  },
  // Mission 4: Ro's Garage (Story - unlocks tuning)
  {
    steps: [
      { type: 'goto', x: 150, z: -150, radius: 10, text: 'Meet Ro Delgado at Garage 24' },
      { type: 'goto', x: -150, z: 150, radius: 10, text: 'Return to the safehouse' },
    ],
  },
  // Mission 5: Qualifier (Race - Circuit)
  {
    steps: [
      { type: 'race_start', track: 'circuit', text: 'Enter the underground league. Top 3 earns crew respect.' },
      { type: 'race_circuit', track: 'circuit', text: 'Qualifier: 3 laps, 5 AI racers. Finish top 3.', timeLimit: 180 },
    ],
  },
  // Mission 6: Hot Wheels (Story)
  {
    steps: [
      { type: 'steal', x: 180, z: 150, defKey: 'furia', color: 0xf2c230, text: 'Steal the yellow Furia GT at the marina' },
      { type: 'driveTo', x: 150, z: -150, radius: 10, text: 'Deliver the Furia to the garage' },
    ],
  },
  // Mission 7: The Pickup (Story)
  {
    steps: [
      { type: 'goto', x: 180, z: -150, radius: 8, text: 'Pick up the package at the docks' },
      { type: 'collect', x: 180, z: -150, radius: 4, text: 'Grab the package' },
      { type: 'driveTo', x: -150, z: 150, radius: 10, text: 'Bring the package home - the BCPD is onto you', wanted: 2 },
    ],
  },
  // Mission 8: Payback (Story)
  {
    steps: [
      { type: 'ram', text: 'Ram Vane\'s Vento until it burns' },
      { type: 'driveTo', x: -150, z: 150, radius: 10, text: 'Lay low at the safehouse' },
    ],
  },
  // Mission 9: Silent Harbor (Story)
  {
    steps: [
      { type: 'goto', x: 120, z: -120, radius: 10, text: 'Reach the warehouse on foot - stay quiet' },
      { type: 'eliminate', count: 3, spawn: [{ x: 112, z: -118 }, { x: 128, z: -126 }, { x: 120, z: -110 }], text: 'Deal with the three guards' },
      { type: 'collect', x: 120, z: -120, radius: 4, text: 'Take the case from the warehouse' },
      { type: 'goto', x: -150, z: 150, radius: 10, text: 'Get the case back to the safehouse' },
    ],
  },
  // Mission 10: The Getaway (Story)
  {
    steps: [
      { type: 'timed', x: 210, z: 0, radius: 10, seconds: 90, text: 'Cross the bridge in 90 seconds - three stars and counting', wanted: 3 },
    ],
  },
  // Mission 11: Harbor Lights (Story)
  {
    steps: [
      { type: 'steal', x: 180, z: -150, defKey: 'caminar', color: 0x9c6b3c, text: 'Take the Caminar truck at the docks' },
      { type: 'driveTo', x: -180, z: -180, radius: 12, text: 'Drive the truck to the airfield - through the roadblocks', wanted: 2 },
    ],
  },
  // Mission 12: The Last Job (Story)
  {
    steps: [
      { type: 'goto', x: 0, z: -180, radius: 18, text: 'Get inside the Solmar Casino' },
      { type: 'collect', x: 0, z: -180, radius: 16, text: 'Empty the vault' },
      { type: 'driveTo', x: -150, z: 150, radius: 10, text: 'Five stars. Get home, Jay.', wanted: 5 },
    ],
  },
  // Mission 13: Sunset Run (Story)
  {
    steps: [
      { type: 'goto', x: 180, z: -150, radius: 8, text: 'Pick up the sunset parcel at the docks' },
      { type: 'collect', x: 180, z: -150, radius: 4, text: 'Grab the parcel' },
      { type: 'timed', x: -180, z: -180, radius: 12, seconds: 75, text: 'Deliver it to the airfield in 75 seconds', wanted: 2 },
    ],
  },
  // Mission 14: Lose the Tail (Story)
  {
    steps: [
      { type: 'evade', seconds: 60, text: 'Lose the tail - keep Vane off you for 60 seconds' },
      { type: 'driveTo', x: -150, z: 150, radius: 10, text: 'Get home to the safehouse' },
    ],
  },
  // Mission 15: Midnight Grand Prix (Race - Grand Prix)
  {
    steps: [
      { type: 'goto', x: -180, z: 120, radius: 10, text: 'Meet Vane at the Coral Row start line' },
      { type: 'race_start', track: 'grandprix', text: 'The Grand Prix begins. Beat Vane\'s crew around the city.' },
      { type: 'race_circuit', track: 'grandprix', text: '3 laps, 6 checkpoints, 6 AI + Vane. 150 seconds.', timeLimit: 150 },
      { type: 'goto', x: 0, z: 0, radius: 10, text: 'Collect the prize at the Plaza' },
    ],
  },
  // Mission 16: The Last Ferry (Story)
  {
    steps: [
      { type: 'goto', x: 180, z: 120, radius: 10, text: 'Reach the Marina' },
      { type: 'steal', x: 180, z: 130, defKey: 'furia', color: 0xd94f43, text: 'Steal the red Furia GT — the fastest car in town' },
      { type: 'goto', x: 180, z: -150, radius: 10, text: 'Reach the ferry terminal at the docks' },
      { type: 'timed', x: -180, z: -180, radius: 12, seconds: 120, wanted: 5, text: '5-star escape — reach the airfield in 120s' },
    ],
  },
  {
    id: 17, name: 'Harbor Run', intro: 'Miko: "Ro needs a crate across the bay. Boat\'s at the marina — four buoys, two minutes."', outro: 'Crate delivered dry. Ro owes you one, Jay.',
    steps: [
      { type: 'goto', x: 250, z: 152, radius: 10, text: 'Go to the marina dock' },
      { type: 'boat_board', text: 'Board a boat (E)' },
      { type: 'boat_delivery', timeLimit: 120, checkpoints: [
        { x: 400, z: -60 }, { x: 520, z: 60 }, { x: 460, z: 240 }, { x: 330, z: 300 },
      ], text: 'Run the buoys across the bay' },
      { type: 'goto', x: 250, z: 152, radius: 10, text: 'Bring the boat back to the marina' },
    ],
  },
];

// Mission dialogue: character lines the cutscenes play after the brief
// (intro) and after the reward (outro). [speaker, line] pairs — Jay,
// Miko, Ro, Vane, Lena (dock fixer) and Sarge (BCPD). Text only; the
// cutscene steps are skipped when a mission has no entry.
export const MISSION_DIALOGUE = [
  { intro: [['MIKO', 'Five years, Jay. The city did not wait for you.'], ['JAY', 'Good. I did not come back to wait.']], outro: [['MIKO', 'Same Jay. Same trouble. Welcome home.']] },
  { intro: [['MIKO', 'Show me you still got it. Three laps, no excuses.'], ['JAY', 'You talk too much. Start the clock.']], outro: [['MIKO', 'Okay. Maybe the five years did not slow you down.']] },
  { intro: [['RO', 'Parts at the docks. Tide comes in, cops come out. Move.'], ['JAY', 'Tide, cops, Ro — same order as always.']], outro: [['RO', 'Clean run. The garage owes you one, Jay.']] },
  { intro: [['RO', 'Garage 24. Engine, tyres, armour — I build, you pay.'], ['JAY', 'Pay with what? I just got out.']], outro: [['RO', 'Family discount. Do not tell the others.']] },
  { intro: [['VANE', 'Torres? The league eats rookies for breakfast.'], ['JAY', 'Then I hope you brought lunch money.']], outro: [['MIKO', 'Top three. The league knows your name now.']] },
  { intro: [['LENA', 'Yellow Furia at the marina. Keys in it. Do not ask why.'], ['JAY', 'I never ask why. I just drive.']], outro: [['RO', 'That Furia purrs like it knows it is stolen.']] },
  { intro: [['LENA', 'Package at the docks. Grab it, bring it back. Quietly.'], ['JAY', 'Quietly. Me. Sure.']], outro: [['LENA', 'No sirens, no holes in the package. Nice.']] },
  { intro: [['MIKO', 'Vane jumped me, Jay. My ribs still remember.'], ['JAY', 'Then his Vento is about to remember me.']], outro: [['JAY', 'Tell Vane: next time, he jumps me instead.']] },
  { intro: [['RO', 'Warehouse, one case, guards with guns. On foot.'], ['JAY', 'On foot. Like the old days, but older.']], outro: [['RO', 'Case is ours. You still move like a ghost, Jay.']] },
  { intro: [['SARGE', 'All units: Torres on the bridge. Do not let him cross.'], ['JAY', 'Ninety seconds. One bridge. No brakes.']], outro: [['MIKO', 'Three stars and you still made it. Unbelievable.']] },
  { intro: [['LENA', 'Caminar truck, two roadblocks, one airfield. Drive.'], ['JAY', 'Roadblocks are just suggestions with sirens.']], outro: [['RO', 'Truck is through. The airfield crew says thanks.']] },
  { intro: [['RO', 'Solmar vault. Five stars on the way out. Get home, Jay.'], ['JAY', 'Five stars. I have had worse odds at cards.']], outro: [['MIKO', 'The vault is empty and you are alive. That is a win.']] },
  { intro: [['LENA', 'Parcel at the docks, airfield deadline. Seventy-five seconds.'], ['JAY', 'Sunset, two stars, one parcel. Easy money.']], outro: [['LENA', 'Delivered with time to spare. The tide is impressed.']] },
  { intro: [['VANE', 'Sixty seconds, Torres. My bumper knows your paint.'], ['JAY', 'Sixty seconds. Try to keep up, Vane.']], outro: [['JAY', 'He lost me. He always loses me.']] },
  { intro: [['VANE', 'Six checkpoints, two rivals, one start line. Mine.'], ['JAY', 'Yours? I do not see your name on the trophy yet.']], outro: [['MIKO', 'Grand Prix champion. Torres Tuning is back, Jay.']] },
  { intro: [['LENA', 'Fastest car in town, one ferry, then five stars to the airfield.'], ['JAY', 'The last job. I have heard that line before.']], outro: [['RO', 'Ferry made it. Whatever comes next, we are ready.']] },
  { intro: [['LENA', 'Boat, four buoys, two minutes. The tide turns fast, Jay.'], ['JAY', 'Two minutes. The bay is mine tonight.']], outro: [['LENA', 'Four buoys, one delivery, zero splashes on my shoes.']] },
];

export class MissionManager {
  constructor(game) {
    this.game = game;
    this.active = -1; // mission index, -1 = free roam
    this.stepIndex = 0;
    this.state = 'idle'; // idle | active | done | failed | race_loading | race_mode
    this.timer = 0;
    this.caughtTimer = 0;
    this.kills = 0;
    this.beacon = null;
    this.marker = null;
    this.packageMesh = null;
    this.rival = null;
    this.tail = null;
    this.guards = [];
    this.targetCar = null;
    this.racers = [];
    this.raceIndex = 0;
    this.failReason = '';
    this.doneName = '';
    this.scene = game.scene;
    // Race mode state
    this.raceTrack = null;
    this.savedCityState = null;
    this.raceMode = false;
    this.raceResult = null; // { position, total, finished } of the last race
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
      if (step.type === 'race_circuit' || step.type === 'race_sprint' || step.type === 'race_drift') {
        t += '  CHECKPOINT ' + (this.raceIndex + 1) + '/' + (this.raceTrack?.checkpoints?.length || 0) + '  [' + Math.max(0, Math.ceil(this.timer)) + 's]';
      }
      if (step.type === 'boat_delivery') t += '  CHECKPOINT ' + (this.boatIndex + 1) + '/' + step.checkpoints.length + '  [' + Math.max(0, Math.ceil(this.timer)) + 's]';
      if (step.type === 'evade' && this.caughtTimer > 0) t += '  - SHAKE HIM!';
      if (step.type === 'eliminate') t += '  (' + this.kills + '/' + step.count + ')';
      return 'MISSION ' + (this.active + 1) + ' - ' + this.meta.name + ': ' + t;
    }
    if (this.state === 'done') return 'Mission complete - ' + this.doneName;
    if (this.state === 'failed') return 'Mission failed - ' + this.failReason;
    if (this.state === 'race_mode') {
      const step = this.currentStep;
      let t = step?.text || 'Racing...';
      if (this.raceTrack) t += '  LAP ' + (this.raceLap || 1) + '/' + (this.raceTrack.laps || 1) + '  CP ' + (this.raceIndex + 1) + '/' + this.raceTrack.checkpoints.length + '  [' + Math.max(0, Math.ceil(this.timer)) + 's]';
      return 'RACE - ' + this.meta.name + ': ' + t;
    }
    const next = this.game.save.missionIndex;
    if (next >= MISSIONS.length) return 'Story complete - Brisa Bay is yours. Free roam, Jay.';
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
    this.raceLap = 1;

    // Play mission intro cutscene
    const meta = MISSION_META[index];
    this.game.cutscenes.playMissionIntro(meta.name, meta.brief, () => {
      // CR-2: the mission may have been failed, quit or lost during the
      // ~11 s intro — if it is no longer this mission, the intro ending
      // must not start (or complete) anything.
      if (this.active !== index || this.state !== 'active') return;
      this.beginStep();
      this.game.audio.jingle();
      this.game.notify('Mission ' + (index + 1) + ': ' + meta.name + ' - ' + meta.brief);
    }, MISSION_DIALOGUE[index]?.intro || []);
    return true;
  }

  beginStep() {
    // CR-2: a pending intro/countdown callback can fire after the
    // mission was failed mid-cutscene (active === -1) — never begin a
    // step for a mission that is no longer running.
    if (this.active < 0) return;
    this.clearMarker();
    const step = this.currentStep;
    if (!step) { this.complete(); return; }
    if (step.wanted) this.game.setWanted(step.wanted);

    if (step.type === 'timed') this.timer = step.seconds;
    if (step.type === 'evade') this.timer = step.seconds;
    if (step.type === 'race_circuit' || step.type === 'race_sprint' || step.type === 'race_drift') {
      this.timer = step.timeLimit || RACE_TRACKS[step.track]?.timeLimit || 180;
    }

    // Race start step: load race map, then run the countdown. The race
    // itself is entered at GO (from the countdown's onGo) — entering it
    // here too would spawn a second set of cars and let the rivals drive
    // during the countdown.
    if (step.type === 'race_start') {
      this.loadRaceTrack(step.track);
      if (this.state === 'race_loading') {
        this.game.cutscenes.playRaceStart(() => {
          this.beginStep();
        });
      }
      return; // race mode handles the rest
    }

    if (step.type === 'race_circuit' || step.type === 'race_sprint' || step.type === 'race_drift') {
      this.enterRaceMode(step.track, step.type);
      return;
    }

    if (step.type === 'race') {
      // Legacy Grand Prix race
      this.timer = step.seconds;
      this.raceIndex = 0;
      this.racers = [];
      this.targetCar = this.game.spawnCar('furia', 0xf2c230, step.startX, step.startZ, Math.PI);
      this.targetCar.kind = 'mission';
      for (const s of [{ x: step.startX, z: step.startZ - 10 }, { x: step.startX, z: step.startZ - 25 }]) {
        const r = this.game.spawnCar('vento', 0x8e2f32, s.x, s.z, Math.PI);
        r.kind = 'race';
        r.raceIndex = 0;
        this.racers.push(r);
      }
      this.placeMarker(step.checkpoints[0].x, step.checkpoints[0].z);
    }
    if (step.type === 'boat_delivery') {
      this.timer = step.timeLimit || 120;
      this.boatIndex = 0;
      this.placeMarker(step.checkpoints[0].x, step.checkpoints[0].z);
    }
    if (step.type === 'evade') {
      this.caughtTimer = 0;
      const g = this.game;
      const a = Math.random() * Math.PI * 2;
      const spot = { x: g.player.pos.x + Math.sin(a) * 38, z: g.player.pos.z + Math.cos(a) * 38 };
      this.tail = g.spawnCar('vento', 0x8e2f32, spot.x, spot.z, 0);
      this.tail.kind = 'tail';
      this.tail.ai = { axis: 'x', dir: 1, targetSpeed: 17, wait: 0 };
      g.notify('Vane is on your tail - do not let him touch you!');
    }
    if (step.type === 'eliminate') {
      this.kills = 0;
      this.guards = this.game.peds.spawnGuards(step.spawn, 60);
    }
    if (step.type === 'ram' && !this.rival) {
      const g = this.game;
      const spot = randomPointInCircle(mulberry32((Date.now() % 100000) + 3), g.player.pos.x, g.player.pos.z, 45);
      this.rival = g.spawnCar('vento', 0x8e2f32, spot.x, spot.z, 0);
      this.rival.kind = 'rival';
      this.rival.ai = { axis: 'x', dir: 1, targetSpeed: 16, wait: 0 };
      g.notify('Vane is running - catch his Vento and ram it!');
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
    if (this.stepIndex > 0) this.game.notify(step.text);
    if (this.game.hud) this.game.hud.banner(this.objectiveText());
  }

  // Load a race track: save city state, swap to race map
  loadRaceTrack(trackKey) {
    const track = RACE_TRACKS[trackKey];
    if (!track) { this.fail('Race track not found: ' + trackKey); return; }

    this.state = 'race_loading';
    this.raceTrack = track;
    this.raceTrackKey = trackKey;

    // Save current city state
    this.savedCityState = this.saveCityState();

    // Notify game to swap to race map
    this.game.enterRaceMap(track);

    // Advance to the race step, but do NOT begin it yet: the countdown
    // runs while state is 'race_loading' (update() waits it out), and
    // the race_circuit step is begun from the countdown's onGo at GO.
    this.stepIndex++;
  }

  enterRaceMode(trackKey, raceType) {
    const track = RACE_TRACKS[trackKey];
    if (!track) { this.fail('Race track not found: ' + trackKey); return; }

    this.state = 'race_mode';
    this.raceTrack = track;
    this.raceTrackKey = trackKey;
    this.raceType = raceType;
    this.raceLap = 1;
    this.raceIndex = 0;
    this.racers = [];

    // Spawn player car at track spawn
    const spawn = track.spawn;
    this.targetCar = this.game.spawnCar('furia', 0xf2c230, spawn.x, spawn.z, spawn.heading);
    this.targetCar.kind = 'mission_race';
    this.game.enterCar(this.targetCar);

    // Spawn AI racers
    const aiDiff = track.aiDifficulty || { baseSpeed: 22, catchUpFactor: 0.015 };
    for (let i = 0; i < (track.aiRacers || 4); i++) {
      const carDef = track.rival?.car || 'vento';
      const carColor = track.rival?.color || [0x8e2f32, 0x2b3a55, 0xf2c230, 0x5a7d5a][i % 4];
      const r = this.game.spawnCar(carDef, carColor,
        spawn.x + (Math.random() - 0.5) * 10,
        spawn.z + (Math.random() - 0.5) * 10,
        spawn.heading);
      r.kind = 'race';
      r.raceIndex = 0;
      r.raceLap = 1;
      r.aiDifficulty = aiDiff;
      r.aiSkill = track.rival && i === 0 ? track.rival.skill : 0.7 + Math.random() * 0.2;
      this.racers.push(r);
    }

    // Place first checkpoint marker
    this.placeMarker(track.checkpoints[0].x, track.checkpoints[0].z);
    this.game.notify('Race started! ' + track.name);
    if (this.game.hud) this.game.hud.showRaceHUD(track, this);
  }

  saveCityState() {
    const g = this.game;
    const p = g.player;

    // If player is in a car, save car info
    let carInfo = null;
    // A boat is never the saved car: restoreCityState spawns from
    // CAR_DEFS, which has no 'boat' — saving one would crash the load.
    if (p.inCar && !p.inCar.isBoat) {
      carInfo = {
        defKey: p.inCar.defKey,
        health: p.inCar.health,
        color: p.inCar.mesh.userData.body?.material?.color?.getHex() || 0xc94f43,
      };
    }

    return {
      player: {
        pos: { x: p.pos.x, z: p.pos.z },
        heading: p.heading,
        health: p.health,
        armor: p.armor,
        inCar: carInfo,
        currentWeapon: g.save.currentWeapon,
      },
      traffic: g.traffic.cars.map(c => ({
        pos: { x: c.pos.x, z: c.pos.z },
        heading: c.heading,
        speed: c.speed,
        defKey: c.defKey,
        color: c.mesh.userData.body?.material?.color?.getHex() || 0x888888,
      })),
      police: {
        cars: g.police.cars.map(c => ({ pos: { x: c.pos.x, z: c.pos.z }, heading: c.heading })),
        wantedLevel: g.wanted,
        roadblocks: g.police.blockers || [],
      },
      peds: g.peds.peds.map(ped => ({ pos: { x: ped.pos.x, z: ped.pos.z }, state: ped.state })),
      timeOfDay: g.tod,
      wanted: g.wanted,
      activeMission: this.active,
    };
  }

  restoreCityState() {
    if (!this.savedCityState) return;
    const s = this.savedCityState;
    const g = this.game;

    // Restore player position and stats
    g.player.pos.set(s.player.pos.x, 0, s.player.pos.z);
    g.player.heading = s.player.heading;
    g.player.health = s.player.health;
    g.player.armor = s.player.armor;

    // Restore player's car if they had one
    if (s.player.inCar) {
      const car = g.spawnCar(s.player.inCar.defKey, s.player.inCar.color, s.player.pos.x, s.player.pos.z, s.player.heading);
      car.health = s.player.inCar.health;
      g.enterCar(car);
    }

    g.save.currentWeapon = s.player.currentWeapon;

    // Restore time of day
    g.tod = s.timeOfDay;
    g.setWanted(s.wanted);

    // Traffic and police will respawn naturally via their managers
    // (We don't fully restore every car position for simplicity)

    this.savedCityState = null;
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
    // CR-2: completing a mission that is no longer running (failed or
    // quit mid-intro) must not pay a reward or play an outro — meta is
    // null once active === -1.
    if (!this.meta) return;
    this.clearMarker();
    const reward = this.meta.reward;
    const name = this.meta.name;
    const missionsDone = this.game.save.stats.missionsDone + 1;
    const cash = this.game.save.cash + reward;

    // Play mission outro cutscene
    this.game.cutscenes.playMissionOutro(name, reward, () => {
      this.state = this.active + 1 >= MISSIONS.length ? 'idle' : 'done';
      this.doneName = name;
      this.game.save.cash += reward;
      this.game.save.missionIndex = Math.max(this.game.save.missionIndex, this.active + 1);
      this.game.save.stats.missionsDone++;
      this.game.writeSave();
      this.game.audio.jingle();
      this.game.notify('Mission complete! +' + '$' + reward.toLocaleString('en-US'));
      if (this.game.hud) {
        this.game.hud.showMissionSplash({
          kind: 'complete', title: 'MISSION COMPLETE', name,
          lines: ['Reward $' + reward.toLocaleString('en-US'), 'Missions done ' + missionsDone, 'Cash $' + cash.toLocaleString('en-US')],
        });
      }
      this.game.setWanted(0);
      this.cleanupEntities();
      this.active = -1;
      this.stepIndex = 0;
      this.raceMode = false;
    }, MISSION_DIALOGUE[this.active]?.outro || []);
  }

  fail(reason) {
    this.clearMarker();
    const name = this.meta ? this.meta.name : 'Mission';
    // H-9: snapshot the race standings BEFORE cleanup removes the
    // racers, and hide the race HUD — a failed race leaves no timer,
    // no AI and no frozen HUD behind.
    const inRace = this.raceMode || this.state === 'race_mode';
    let raceLines = [];
    if (inRace && this.raceTrack) {
      const pos = this.racePosition();
      this.raceResult = { position: pos, total: this.racers.length + 1, finished: false };
      raceLines = ['Position ' + pos + '/' + (this.racers.length + 1)];
      if (this.game.hud) this.game.hud.hideRaceHUD();
      // Get the player out of any race car first: removeCar() would
      // leave them invisible on foot (it nulls inCar but never shows
      // the player mesh again).
      const g = this.game;
      if (g.player.inCar && (g.player.inCar === this.targetCar || this.racers.includes(g.player.inCar))) {
        g.exitCar();
      }
    }
    this.state = 'failed';
    this.failReason = reason;
    // H-9: stop the race dead — the timer, the track and the
    // checkpoint loop all end here, on every end path.
    this.timer = 0;
    this.raceTrack = null;
    this.game.audio.fail();
    this.game.notify('Mission failed - ' + reason + '. Press M to retry.');
    if (this.game.state === 'playing' && this.game.hud) {
      this.game.hud.showMissionSplash({
        kind: 'fail', title: 'MISSION FAILED', name,
        lines: [reason, ...raceLines, 'Press M to retry'],
      });
    }
    this.cleanupEntities();
    // If we were in race mode, restore city
    if (this.raceMode && this.savedCityState) {
      this.game.exitRaceMap();
      this.restoreCityState();
    }
    this.active = -1;
    this.stepIndex = 0;
    this.raceMode = false;
  }

  cleanupEntities() {
    if (this.rival) { this.game.removeCar(this.rival); this.rival = null; }
    if (this.tail) { this.game.removeCar(this.tail); this.tail = null; }
    for (const r of this.racers) this.game.removeCar(r);
    this.racers = [];
    for (const g of this.guards) this.game.peds.remove(g);
    this.guards = [];
    this.targetCar = null;
    if (this.raceMode) {
      this.game.exitRaceMap();
      this.restoreCityState();
    }
  }

  cleanup() {
    this.clearMarker();
    this.cleanupEntities();
  }

  onGuardKilled() {
    if (this.state !== 'active' || !this.currentStep || this.currentStep.type !== 'eliminate') return;
    this.kills++;
    if (this.kills >= this.currentStep.count) this.nextStep();
  }

  onRivalDead() {
    if (this.state === 'active' && this.currentStep && this.currentStep.type === 'ram') {
      this.game.notify('Vane\u2019s Vento is burning. Nice work.');
      this.nextStep();
    }
  }

  raceDrive(car, target, dt) {
    const dx = target.x - car.pos.x, dz = target.z - car.pos.z;
    const targetHeading = Math.atan2(dx, dz);
    const turn = angleDiff(car.heading, targetHeading);
    const steer = clamp(-turn * 1.6, -1, 1);
    const throttle = Math.abs(turn) > 0.6 ? 0.3 : (car.speed < 20 ? 0.85 : 0.2);
    car.drive(dt, throttle, steer, this.game.world.colliders);
  }

  update(dt) {
    if (this.state === 'race_loading') return; // waiting for map load
    if (this.state !== 'active' && this.state !== 'race_mode') return;
    const step = this.currentStep;
    const g = this.game;
    const p = g.player.pos;

    if (this.beacon) {
      this.beacon.rotation.y += dt * 0.8;
      this.beacon.material.opacity = 0.22 + Math.sin(performance.now() / 300) * 0.08;
    }
    if (this.marker) {
      const s = 1 + Math.sin(performance.now() / 300) * 0.08;
      this.marker.scale.set(s, s, 1);
    }
    if (this.packageMesh) this.packageMesh.rotation.y += dt * 2;

    // Standard step types
    if (step && step.type === 'timed') {
      this.timer -= dt;
      if (this.timer <= 0) { this.fail('Out of time'); return; }
      if (dist2(p.x, p.z, step.x, step.z) < step.radius) { this.nextStep(); return; }
    }
    if (step && step.type === 'evade') {
      this.timer -= dt;
      if (this.timer <= 0) { this.nextStep(); return; }
      if (this.tail) {
        if (this.tail.dead) {
          this.game.notify('Tail\'s gone. Nice driving.');
          this.nextStep();
          return;
        }
        const dx = p.x - this.tail.pos.x, dz = p.z - this.tail.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        if (d < 8 && this.tail.speed > 6) this.tail.speed = 6;
        const targetHeading = Math.atan2(dx, dz);
        const steer = clamp(-angleDiff(this.tail.heading, targetHeading) * 1.6, -1, 1);
        const throttle = d > 10 ? 1 : (d > 6 ? 0.5 : 0.15);
        this.tail.drive(dt, throttle, steer, g.world.colliders);
        if (d < 6) {
          this.caughtTimer += dt;
          if (this.caughtTimer > 1.5) { this.fail('Vane caught up with you'); return; }
        } else {
          this.caughtTimer = Math.max(0, this.caughtTimer - dt * 2);
        }
      }
    }
    if (step && (step.type === 'goto' || step.type === 'driveTo')) {
      if (dist2(p.x, p.z, step.x, step.z) < step.radius) this.nextStep();
    } else if (step && step.type === 'collect') {
      if (dist2(p.x, p.z, step.x, step.z) < step.radius) {
        if (step.wanted) g.setWanted(step.wanted);
        g.audio.blip(1200, 0.12, 0.2);
        this.nextStep();
      }
    } else if (step && step.type === 'steal') {
      if (g.player.inCar === this.targetCar) {
        g.save.stats.carsStolen++;
        g.notify('That\u2019s the one. Now deliver it.');
        this.nextStep();
      }
    } else if (step && step.type === 'ram') {
      if (this.rival && this.rival.dead) this.onRivalDead();
      else if (this.rival) {
        this.game.trafficLikeDrive(this.rival, dt, 16);
      }
    } else if (step && step.type === 'race') {
      // Legacy Grand Prix
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
      for (const r of this.racers) {
        if (r.dead) continue;
        const target = step.checkpoints[r.raceIndex];
        if (!target) continue;
        if (dist2(r.pos.x, r.pos.z, target.x, target.z) < 8) {
          r.raceIndex++;
          if (r.raceIndex >= step.checkpoints.length) { this.fail('Vane\u2019s crew beat you to the line'); return; }
          continue;
        }
        this.raceDrive(r, target, dt);
      }
    } else if (step && step.type === 'boat_board') {
      if (g.player.inCar && g.player.inCar.isBoat) this.nextStep();
    } else if (step && step.type === 'boat_delivery') {
      this.timer -= dt;
      if (this.timer <= 0) { this.fail('Out of time'); return; }
      const cp = step.checkpoints[this.boatIndex];
      if (cp && dist2(p.x, p.z, cp.x, cp.z) < (cp.radius || 12)) {
        this.boatIndex++;
        g.audio.blip(1320, 0.12, 0.2);
        if (this.boatIndex >= step.checkpoints.length) { this.nextStep(); return; }
        this.clearMarker();
        const next = step.checkpoints[this.boatIndex];
        this.placeMarker(next.x, next.z);
        g.notify('Checkpoint ' + this.boatIndex + '/' + step.checkpoints.length);
      }
    }

    // Race mode update
    if (this.state === 'race_mode' && this.raceTrack) {
      this.updateRaceMode(dt);
    }
  }

  updateRaceMode(dt) {
    const track = this.raceTrack;
    const g = this.game;
    const p = g.player.pos;

    // Timer
    this.timer -= dt;
    if (this.timer <= 0) { this.fail('Out of time'); return; }

    // Check checkpoint
    const cp = track.checkpoints[this.raceIndex];
    if (cp && dist2(p.x, p.z, cp.x, cp.z) < (cp.radius || 8)) {
      this.raceIndex++;
      g.audio.blip(1320, 0.12, 0.2);
      g.notify('Checkpoint ' + this.raceIndex + '/' + track.checkpoints.length);
      if (this.raceIndex >= track.checkpoints.length) {
        // Lap complete or race complete
        this.raceLap++;
        if (this.raceLap > track.laps) {
          this.raceFinish();
          return;
        }
        this.raceIndex = 0;
        g.notify('Lap ' + this.raceLap + '/' + track.laps);
      }
      this.clearMarker();
      const next = track.checkpoints[this.raceIndex];
      this.placeMarker(next.x, next.z);
    }

    // Update AI racers
    for (const r of this.racers) {
      if (r.dead) continue;
      const target = track.checkpoints[r.raceIndex];
      if (!target) continue;
      if (dist2(r.pos.x, r.pos.z, target.x, target.z) < 8) {
        r.raceIndex++;
        if (r.raceIndex >= track.checkpoints.length) {
          r.raceLap++;
          if (r.raceLap > track.laps) {
            // AI finished race
            if (this.raceLap <= track.laps) {
              this.fail('An opponent beat you to the finish!');
              // H-9: the race is over — stop here, or the AI keeps
              // driving (and the timer keeps ticking) after the fail.
              return;
            }
            continue;
          }
          r.raceIndex = 0;
        }
        continue;
      }
      this.raceDriveAI(r, target, dt, track);
    }

    // Update HUD
    if (g.hud && g.hud.updateRaceHUD) {
      g.hud.updateRaceHUD(this);
    }
  }

  raceDriveAI(car, target, dt, track) {
    const dx = target.x - car.pos.x, dz = target.z - car.pos.z;
    const targetHeading = Math.atan2(dx, dz);
    const turn = angleDiff(car.heading, targetHeading);

    // Hybrid AI: base skill + light catch-up
    const baseSkill = car.aiSkill || 0.7;
    let catchUp = 0;
    if (this.game.player.pos) {
      const d2 = dist2(this.game.player.pos.x, this.game.player.pos.z, car.pos.x, car.pos.z);
      catchUp = Math.max(0, (d2 - 2500) * 0.001);
    }
    const targetSpeed = (car.aiDifficulty?.baseSpeed || 22) * baseSkill + catchUp;

    const steer = clamp(-turn * (1.4 + baseSkill * 0.4), -1, 1);
    const throttle = Math.abs(turn) > 0.7 ? 0.4 : (car.speed < targetSpeed ? 0.9 : 0.1);
    car.drive(dt, throttle, steer, this.game.world.colliders);
  }

  // Player's current race position (1 = leading), from lap/checkpoint
  // progress — the same rule the HUD uses. Read before cleanup removes
  // the racers.
  racePosition() {
    if (!this.raceTrack) return 1;
    let pos = 1;
    for (const r of this.racers) {
      if (r.raceLap > this.raceTrack.laps || (r.raceLap === this.raceTrack.laps && r.raceIndex >= this.raceTrack.checkpoints.length)) {
        pos++;
      }
    }
    return pos;
  }

  raceFinish() {
    // Player finished race
    const track = this.raceTrack;
    const g = this.game;

    const playerPos = this.racePosition();
    this.raceResult = { position: playerPos, total: this.racers.length + 1, finished: true };

    g.notify('Race finished! Position: ' + playerPos);
    if (g.hud) g.hud.hideRaceHUD();

    // CR-3 / H-9: leave race_mode for real — the state, the timer and
    // the track all end here, so the M15 post-race goto runs as a
    // normal step and a won race can never fail "Out of time" later.
    this.state = 'active';
    this.raceMode = false;
    this.raceTrack = null;
    this.timer = 0;

    // CR-3: get the player out of the race car BEFORE the race scene
    // is torn down — otherwise they keep driving a disposed, invisible
    // car around the city (player.mesh stays hidden, inCar stays set).
    if (g.player.inCar === this.targetCar) g.exitCar();

    // Remove the race grid from the race scene, then exit the race map
    // and restore the city (re-entering the player's saved car, if any).
    for (const r of this.racers) g.removeCar(r);
    this.racers = [];
    if (this.targetCar) { g.removeCar(this.targetCar); this.targetCar = null; }
    g.exitRaceMap();
    this.restoreCityState();

    this.nextStep();
  }
}