// BRISA BAY — boot, game loop and the glue between systems.
import * as THREE from 'three';
import { WEAPONS, MISSION_META, RESPRAY_COLORS, UPGRADES, PARKED_SPOTS, PERFORMER_SPOT, GANGS } from './config.js';
import { clamp, dist2, mulberry32, pick, fmtMoney, theftWitnessed } from './utils.js';
import { buildCity, nearestRoadCoord } from './city.js';
import { Car, TrafficManager, PoliceManager, carsOverlap } from './vehicles.js';
import { Player } from './player.js';
import { PedManager } from './pedestrians.js';
import { Combat, ParticleSystem } from './combat.js';
import { MissionManager } from './missions.js';
import { CutsceneManager } from './cutscene.js';
import { PickupManager } from './pickups.js';
import { TaxiManager } from './taxi.js';
import { CollectibleManager } from './collectibles.js';
import { Birds } from './birds.js';
import { AudioEngine } from './audio.js';
import { HUD } from './hud.js';
import { TouchControls } from './touch.js';
import { loadSave, writeSave, defaultSave, clearSave } from './save.js';
import { shotParam, stageShot } from './shots.js';
import { glowTexture } from './textures.js';

class Game {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game'), antialias: true });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Filmic tone mapping + sRGB, so the sunset grades like a photo.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 2000);

    this.world = buildCity(this.scene);
    // Time-of-day references from world
    this.sun = this.world.sun;
    this.skyMaterial = this.world.skyMaterial;
    this.hemiLight = this.world.hemiLight;
    this.sunDisc = this.world.sunDisc;
    this.sunGlow = this.world.sunGlow;

    this.particles = new ParticleSystem(this.scene);
    this.audio = new AudioEngine();
    this.hud = new HUD(this.world, this);
    this.save = loadSave() || defaultSave();
    if (!this.save.upgrades) this.save.upgrades = { armor: 0, engine: 0, tires: 0 };
    if (!this.save.packages) this.save.packages = [];
    if (this.save.settings) {
      this.audio.setVolume(this.save.settings.volume ?? 0.5);
      this.audio.setRadioVolume(this.save.settings.radio ?? 0.8);
    }

    this.player = new Player(this.scene, -140, 140);
    this.player.health = 100;
    this.player.armor = this.save.armor || 0;
    this.traffic = new TrafficManager(this.scene, this.world, mulberry32(99));
    this.police = new PoliceManager(this.scene, this.world, mulberry32(7));
    this.peds = new PedManager(this.scene, this.world);
    this.combat = new Combat(this.scene, this.particles);
    this.missions = new MissionManager(this);
    this.cutscenes = new CutsceneManager(this);
    this.pickups = new PickupManager(this.scene, this.world);
    // The side activities — taxi fares and collectible packages.
    this.taxi = new TaxiManager(this);
    this.collectibles = new CollectibleManager(this.scene, this.save);
    // Birds over the lighthouse and the pier, and the parked cars
    // Rio can steal (see spawnParked).
    this.birds = new Birds(this.scene);
    this.parked = [];
    // Headlight pool: real SpotLights for the driven car, plus a soft
    // glow mesh for the cheap fill. SpotLights cast shadows at night.
    this.headlightPool = new THREE.Group();
    const poolMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 9),
      new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffe9a8, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    poolMesh.rotation.x = -Math.PI / 2;
    this.headlightPool.add(poolMesh);
    // Two SpotLights for left/right headlights (only for player car)
    this.headlightLeft = new THREE.SpotLight(0xffe9a8, 0, 35, Math.PI / 6, 0.3, 0.5);
    this.headlightLeft.position.set(-1.2, 0.8, 0);
    this.headlightLeft.target.position.set(-1.2, 0, 20);
    this.headlightLeft.castShadow = true;
    this.headlightLeft.shadow.mapSize.set(512, 512);
    this.headlightLeft.shadow.camera.near = 1;
    this.headlightLeft.shadow.camera.far = 40;
    this.headlightLeft.shadow.camera.fov = 50;
    this.headlightRight = new THREE.SpotLight(0xffe9a8, 0, 35, Math.PI / 6, 0.3, 0.5);
    this.headlightRight.position.set(1.2, 0.8, 0);
    this.headlightRight.target.position.set(1.2, 0, 20);
    this.headlightRight.castShadow = true;
    this.headlightRight.shadow.mapSize.set(512, 512);
    this.headlightRight.shadow.camera.near = 1;
    this.headlightRight.shadow.camera.far = 40;
    this.headlightRight.shadow.camera.fov = 50;
    this.headlightPool.add(this.headlightLeft, this.headlightLeft.target, this.headlightRight, this.headlightRight.target);
    this.headlightPool.visible = false;
    this.scene.add(this.headlightPool);

    this.keys = {};
    this.state = 'menu'; // menu | playing | paused | wasted | busted | ending
    this.wanted = 0;
    this.wantedDecay = 0;
    this.bustedTimer = 0;
    this.clockSec = 18 * 3600 + 24 * 60;
    this.elapsed = 0;
    this.warmupFrames = 0;
    this.nearShop = null;
    this.shopOpen = false;
    this.dragging = false;
    this.touchBrake = false;
    this.promptText = null;
    this.dragDist = 0;
    this.lastX = 0;
    this.lastY = 0;
    this.shotMode = shotParam();
    this.exhaustTimer = 0;
    this.dustTimer = 0;
    this.roadblockAlerted = false;

    // Time-of-day cycle (24 min real = 24 hours game)
    this.tod = 0.775;           // start at 18:24 (0.775 of 24h)
    this.todSpeed = 1 / (24 * 60); // per second
    this.sun = null;        // reference to sun light
    this.skyMaterial = null;
    this.hemiLight = null;
    this.fogColor = new THREE.Color();
    this.sunDisc = null;
    this.sunGlow = null;

    this.traffic.spawn(14, { x: -140, z: 140 }, 150);
    this.peds.spawn(24, { x: -140, z: 140 }, 120);
    // A few parked cars near the start so the first minute has wheels.
    this.spawnParked('brisa', 0xc94f43, -120, 120, Math.PI / 2);
    this.spawnParked('vento', 0x2b3a55, -100, 160, -Math.PI / 2);
    this.spawnParked('taxi', 0xf2a007, -160, 100, 0);
    // The city wakes up: waiters, performer, vendors, parked rides, groups.
    for (const stop of this.world.busStops.slice(0, 2)) this.peds.spawnWaiters(stop, 2);
    this.peds.spawnPerformer(PERFORMER_SPOT.x, PERFORMER_SPOT.z);
    this.peds.spawnVendors(this.world.vendorSpots);
    for (const s of PARKED_SPOTS) this.spawnParked(s.defKey, s.color, s.x, s.z, s.heading);
    this.peds.spawnGroup(-132, 130, 3);
    this.peds.spawnGroup(-110, 150, 2);
    // Gang muscle holds its turf from the start; heat rises when Rio hits them.
    this.gangHeat = [0, 0];
    for (const g of GANGS) this.peds.spawnGang(g, 3);

    this.bindInput();
    this.touch = new TouchControls({
      onEnter: () => this.onInteract(),
      onShoot: () => { if (this.state === 'playing' && !this.player.inCar) this.shoot(); },
      onJump: () => { if (this.state === 'playing' && !this.player.inCar) this.player.jump(); },
      onWeapon: () => this.cycleWeapon(),
      onPause: () => { if (this.state === 'playing') this.pause(); },
      onBrake: (down) => { this.touchBrake = down; },
    });
    this.touch.attach();
    this.hud.bindTouch(this.touch);
    addEventListener('resize', () => this.onResize());
    this.showStartScreen();
    this.clock = new THREE.Clock();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  // Start screen: the HUD builds it from this data; the story, controls
  // and save ledger live in hud.js now, not in a string here.
  showStartScreen() {
    this.state = 'menu';
    const next = this.save.missionIndex < MISSION_META.length ? MISSION_META[this.save.missionIndex] : null;
    this.hud.showStartScreen({
      hasSave: !!loadSave(),
      next,
      cash: this.save.cash,
      chapter: this.save.missionIndex + 1,
      total: MISSION_META.length,
      pkgs: (this.save.packages || []).length,
      fares: (this.save.stats && this.save.stats.faresDone) || 0,
      faresEarned: (this.save.stats && this.save.stats.faresEarned) || 0,
    }, {
      onContinue: () => this.startPlaying(false),
      onNew: () => this.startPlaying(true),
    });
  }

  writeSave() { writeSave(this.save); }

  notify(text) { this.hud.notify(text); }
  setWanted(n) { this.wanted = clamp(Math.round(n), 0, 5); this.wantedDecay = 0; }
  addWanted(n) { this.setWanted(this.wanted + n); }

  // Objective: active mission, else live fare, else next mission.
  objectiveText() {
    if (this.missions.state === 'active') return this.missions.objectiveText();
    const taxi = this.taxi.objectiveText();
    if (taxi) return taxi;
    const base = this.missions.objectiveText();
    const n = this.save.packages ? this.save.packages.length : 0;
    return n > 0 ? base + ' · Packages ' + n + '/20' : base;
  }

  // --- input ---
  bindInput() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      this.audio.ensure();
      this.audio.resume();
      if (e.code === 'Enter' && this.state === 'menu') this.startPlaying(false);
      if (e.code === 'Enter' && (this.state === 'wasted' || this.state === 'busted')) this.respawn();
      if (e.code === 'KeyN' && this.state === 'menu') this.startPlaying(true);
      if (e.code === 'KeyC' && this.state === 'menu') this.startPlaying(false);
      if ((e.code === 'KeyP' || e.code === 'Escape') && this.state === 'playing') this.pause();
      else if ((e.code === 'KeyP' || e.code === 'Escape') && this.state === 'paused') this.resume();
      if (e.code === 'KeyM' && this.state === 'playing' && this.missions.state !== 'active') {
        const next = this.save.missionIndex;
        if (next < MISSION_META.length) this.missions.startMission(next);
        else this.notify('Story complete - free roam, Rio.');
      }
      if (e.code === 'KeyR' && this.state === 'playing') {
        this.audio.setStation(this.audio.station + 1);
        this.notify('Radio: ' + this.audio.stationName());
      }
      if (e.code === 'KeyQ' && this.state === 'playing') {
        const on = this.audio.toggleRadio();
        this.notify(on ? 'Radio on: ' + this.audio.stationName() : 'Radio off');
      }
      if (e.code === 'KeyH' && this.state === 'playing' && this.player.inCar) this.audio.horn();
      if (e.code === 'KeyE') this.onInteract();
      if (e.code === 'KeyF' && this.state === 'playing' && !this.player.inCar) this.punch();
      if (e.code === 'Space' && this.state === 'playing' && !this.player.inCar) this.player.jump();
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    const canvas = document.getElementById('game');
    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true; this.dragDist = 0; this.lastX = e.clientX; this.lastY = e.clientY;
      this.audio.ensure(); this.audio.resume();
    });
    // Right-drag orbits the camera too — don't let the browser menu pop up.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
      this.dragDist += Math.abs(dx) + Math.abs(dy);
      this.lastX = e.clientX; this.lastY = e.clientY;
      this.player.camYaw -= dx * 0.005;
      this.player.camPitch = clamp(this.player.camPitch + dy * 0.004, 0.05, 0.9);
    });
    addEventListener('pointerup', () => { this.dragging = false; });
    canvas.addEventListener('click', (e) => {
      if (this.state !== 'playing' || this.player.inCar) return;
      if (e.target !== canvas) return;
      if ((this.dragDist || 0) > 6) return; // it was a camera drag, not a shot
      this.shoot();
    });
    // Shop buttons are plain DOM; clicks there must not shoot.
    document.getElementById('shop-items').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-buy]');
      if (b) this.buyItem(b.dataset.buy);
    });
    document.getElementById('shop-close').addEventListener('click', () => this.closeShop());
  }

  startPlaying(newGame) {
    if (newGame) {
      clearSave();
      this.save = defaultSave();
      // New game must re-point the collectible manager at the new save.
      this.collectibles.reset(this.save);
      this.player.health = 100;
      this.player.armor = 0;
      this.setWanted(0);
      this.notify('New game - welcome back to Brisa Bay, Rio.');
    } else {
      this.notify('Welcome back, Rio. ' + fmtMoney(this.save.cash) + ' in your pocket.');
    }
    this.state = 'playing';
    this.hud.hideMenu();
    this.audio.ensure();
    this.audio.resume();
    this.audio.startEngine();
    this.audio.startSiren();
  }

  pause() {
    this.state = 'paused';
    this.hud.showPause({ volume: this.audio.volume, radio: this.audio.radioVol }, {
      onResume: () => this.resume(),
      onRestart: () => this.restartMission(),
      onMenu: () => this.showStartScreen(),
      onVolume: (kind, v) => this.setVolume(kind, v),
    });
  }
  resume() { this.state = 'playing'; this.hud.hideMenu(); }

  setVolume(kind, v) {
    if (kind === 'radio') this.audio.setRadioVolume(v);
    else this.audio.setVolume(v);
    if (!this.save.settings) this.save.settings = { volume: 0.5, radio: 0.8 };
    this.save.settings[kind === 'radio' ? 'radio' : 'volume'] = v;
    this.writeSave();
  }

  // Restart the active mission, or the next one when free-roaming.
  restartMission() {
    const i = this.missions.state === 'active' ? this.missions.active : this.save.missionIndex;
    if (i < MISSION_META.length) {
      this.hud.hideMenu();
      this.state = 'playing';
      this.missions.startMission(i);
    } else this.resume();
  }

  // Touch WEAPON button: step to the next owned gun in slot order.
  cycleWeapon() {
    if (this.state !== 'playing') return;
    const order = ['fists', 'pistol', 'smg', 'shotgun'];
    const cur = order.indexOf(this.save.currentWeapon || 'fists');
    for (let n = 1; n <= order.length; n++) {
      const k = order[(cur + n) % order.length];
      if (this.save.weapons[k]) {
        this.save.currentWeapon = k;
        this.notify(WEAPONS[k].name + ' equipped.');
        return;
      }
    }
  }

  // --- cars -------------------------------------------------------------------
  spawnCar(defKey, color, x, z, heading) {
    const car = new Car(defKey, color, x, z, heading);
    this.scene.add(car.mesh);
    return car;
  }
  // A parked car Rio can steal: it joins this.parked, so E sees it.
  spawnParked(defKey, color, x, z, heading) {
    const car = new Car(defKey, color, x, z, heading);
    car.kind = 'parked';
    this.scene.add(car.mesh);
    this.parked.push(car);
    return car;
  }
  removeCar(car) {
    this.scene.remove(car.mesh);
    if (this.player.inCar === car) this.player.inCar = null;
  }
  allCars() {
    const list = [...this.traffic.cars, ...this.police.cars, ...this.police.blockerCars(), ...this.parked];
    if (this.missions.rival) list.push(this.missions.rival);
    if (this.missions.tail) list.push(this.missions.tail);
    if (this.missions.targetCar) list.push(this.missions.targetCar);
    for (const r of this.missions.racers) list.push(r);
    return list.filter((c) => !c.dead);
  }

  nearestCar(maxDist) {
    let best = null, bd = maxDist;
    for (const c of this.allCars()) {
      const d = dist2(this.player.pos.x, this.player.pos.z, c.pos.x, c.pos.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  enterCar(car) {
    this.player.inCar = car;
    car.driver = 'player';
    // Whatever Rio drives gets his garage upgrades — armour, engine, tyres.
    car.applyUpgrades(this.save.upgrades || { armor: 0, engine: 0, tires: 0 });
    this.player.mesh.visible = false;
    // Snap the chase cam behind the car at once (no 2 s swing).
    this.player.camYaw = car.heading + Math.PI;
    this.audio.blip(660, 0.1, 0.12);
  }

  exitCar() {
    const car = this.player.inCar;
    if (!car) return;
    this.player.inCar = null;
    car.driver = null;
    car.speed = 0;
    const side = car.heading + Math.PI / 2;
    this.player.pos.set(car.pos.x + Math.sin(side) * 2.2, 0, car.pos.z + Math.cos(side) * 2.2);
    this.player.heading = car.heading;
    this.player.mesh.visible = true;
    this.player.camYaw = car.heading + Math.PI;
  }

  onInteract() {
    if (this.state !== 'playing') return;
    if (this.shopOpen) return;
    // A fare pickup beats exiting the car.
    if (this.taxi.tryPickup()) return;
    if (this.player.inCar) { this.exitCar(); return; }
    if (this.nearShop) { this.openShop(this.nearShop); return; }
    const car = this.nearestCar(3.4);
    if (car) {
      const stealing = car.kind === 'traffic' || car.kind === 'mission' || car.kind === 'parked';
      this.enterCar(car);
      if (stealing) {
        this.save.stats.carsStolen++;
        if (theftWitnessed(car.kind, this.police.nearestPoliceDist(car.pos))) {
          this.addWanted(1);
          this.notify('You stole the ' + car.def.label + '. The BCPD noticed.');
        }
      } else if (car.kind === 'police') {
        this.addWanted(2);
        this.notify('You stole a BCPD Interceptor. Bold, Rio.');
      }
    }
  }

  // Rival cars drive like traffic, only faster and angrier.
  trafficLikeDrive(car, dt, targetSpeed) {
    const ai = car.ai || (car.ai = { axis: 'x', dir: 1, targetSpeed, wait: 0 });
    let blocked = false;
    for (const other of this.allCars()) {
      if (other === car || other.dead) continue;
      const dx = other.pos.x - car.pos.x, dz = other.pos.z - car.pos.z;
      const ahead = dx * Math.sin(car.heading) + dz * Math.cos(car.heading);
      const side = Math.abs(dx * Math.cos(car.heading) - dz * Math.sin(car.heading));
      if (ahead > 0 && ahead < 9 && side < 2.2) { blocked = true; break; }
    }
    car.drive(dt, blocked ? -0.4 : (car.speed < targetSpeed ? 0.7 : 0.15), 0, this.world.colliders);
    // Turn only at intersections, snapped on, so rivals stay on roads.
    const onX = Math.abs(car.pos.x - nearestRoadCoord(car.pos.x)) < 1.2;
    const onZ = Math.abs(car.pos.z - nearestRoadCoord(car.pos.z)) < 1.2;
    const onLine = ai.axis === 'x' ? onZ : onX;
    if (onLine && onX && onZ && Math.random() < dt * 0.5) {
      car.pos.x = nearestRoadCoord(car.pos.x);
      car.pos.z = nearestRoadCoord(car.pos.z);
      ai.axis = ai.axis === 'x' ? 'z' : 'x';
      car.heading += Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
    }
  }

  // --- combat (player side) ---------------------------------------------------
  punch() {
    const targets = [];
    for (const p of this.peds.peds) if (!p.dead) targets.push(p);
    const dir = { x: Math.sin(this.player.heading), z: Math.cos(this.player.heading) };
    const origin = { x: this.player.pos.x, y: 1.2, z: this.player.pos.z };
    const hit = this.combat.fire('fists', origin, dir, targets, null);
    if (hit && hit.target.role === 'guard') this.missions.onGuardKilled();
    if (hit && hit.target.role === 'gang') this.onGangHit(hit.target);
    if (hit && hit.killed) this.addWanted(1);
  }

  // Hitting a gang member raises that gang's heat: wider aggro, more men.
  onGangHit(ped) {
    const gi = GANGS.indexOf(ped.gang);
    if (gi < 0) return;
    this.gangHeat[gi]++;
    for (const p of this.peds.peds) {
      if (p.role === 'gang' && p.gang === ped.gang) p.aggro = Math.min(44, 26 + this.gangHeat[gi] * 3);
    }
    const alive = this.peds.peds.filter((p) => !p.dead && p.role === 'gang' && p.gang === ped.gang).length;
    if (alive < 4 + this.gangHeat[gi]) this.peds.spawnGang(ped.gang, 2);
    this.notify('The ' + ped.gang.name + ' are gunning for you now.');
  }

  shoot() {
    const wkey = this.save.currentWeapon || 'fists';
    if (wkey === 'fists') { this.punch(); return; }
    const w = this.save.weapons[wkey];
    if (!w || w.ammo <= 0) { this.audio.blip(220, 0.08, 0.15); this.notify('Out of ammo - visit IRONWORKS.'); return; }
    const dir = { x: Math.sin(this.player.heading), z: Math.cos(this.player.heading) };
    const origin = { x: this.player.pos.x + dir.x * 0.8, y: 1.35, z: this.player.pos.z + dir.z * 0.8 };
    const targets = [];
    for (const p of this.peds.peds) if (!p.dead) targets.push(p);
    for (const c of this.allCars()) targets.push(c);
    const hit = this.combat.fire(wkey, origin, dir, targets, this.audio);
    if (w.ammo !== Infinity) w.ammo--;
    if (hit) {
      this.addWanted(1);
      if (hit.target.role === 'guard' && hit.killed) this.missions.onGuardKilled();
      if (hit.target.role === 'gang') this.onGangHit(hit.target);
      if (hit.target.kind === 'rival' && hit.killed) this.missions.onRivalDead();
    }
  }

  // --- shops ------------------------------------------------------------------
  openShop(shop) {
    this.shopOpen = true;
    let html = '';
    if (shop.kind === 'guns') {
      html = this.shopButton('pistol', 'P9 Pistol - $250', '12 rounds, reliable') +
        this.shopButton('smg', 'Vespa SMG - $900', '32 rounds, full auto') +
        this.shopButton('shotgun', 'Boomstick - $1400', '6 shells, close range') +
        this.shopButton('ammo', 'Ammo refill - $50', 'Top up the current gun') +
        this.shopButton('armor', 'Body armor - $300', '+50 armor');
    } else if (shop.kind === 'garage') {
      // The garage sells upgrades that change the car for real.
      html = this.upgradeButton('armor') + this.upgradeButton('engine') + this.upgradeButton('tires') +
        this.shopButton('respray', 'Respray - $150', 'New paint, less heat') +
        this.shopButton('repair', 'Repair - $200', 'Fix your ride up');
    } else {
      html = this.shopButton('taco', 'Taco - $20', '+25 health') +
        this.shopButton('burrito', 'Burrito - $40', '+50 health');
    }
    this.hud.showShop(shop.name + ' - ' + fmtMoney(this.save.cash), html);
  }
  shopButton(id, label, desc) {
    return '<button data-buy="' + id + '"><b>' + label + '</b><span>' + desc + '</span></button>';
  }
  // One garage upgrade row: level owned, next price, or MAX.
  upgradeButton(key) {
    const u = UPGRADES[key];
    const lvl = (this.save.upgrades && this.save.upgrades[key]) || 0;
    if (lvl >= 2) return '<button data-buy="up-' + key + '" disabled><b>' + u.name + ' - MAX</b><span>' + u.desc + '</span></button>';
    const price = u.levels[lvl];
    return '<button data-buy="up-' + key + '"><b>' + u.name + ' Lv ' + (lvl + 1) + ' - $' + price + '</b><span>' + u.desc + '</span></button>';
  }
  closeShop() { this.shopOpen = false; this.hud.hideShop(); }

  buyItem(id) {
    const s = this.save;
    const spend = (n) => { if (s.cash < n) { this.notify('Not enough cash.'); return false; } s.cash -= n; return true; };
    if (id === 'pistol' || id === 'smg' || id === 'shotgun') {
      const w = WEAPONS[id];
      if (s.weapons[id]) { this.notify('You already own the ' + w.name + '.'); return; }
      if (!spend(w.price)) return;
      s.weapons[id] = { owned: true, ammo: w.ammo };
      s.currentWeapon = id;
      this.notify('Bought the ' + w.name + '. Press 1/2/3 to switch guns.');
    } else if (id === 'ammo') {
      if (!spend(50)) return;
      const w = s.weapons[s.currentWeapon];
      if (w && w.ammo !== Infinity) w.ammo = WEAPONS[s.currentWeapon].ammo;
      this.notify('Ammo topped up.');
    } else if (id === 'armor') {
      if (!spend(300)) return;
      this.player.armor = Math.min(100, this.player.armor + 50);
      s.armor = this.player.armor;
      this.notify('Armor on. +50.');
    } else if (id === 'up-armor' || id === 'up-engine' || id === 'up-tires') {
      // Garage upgrades — pay, level up, fit to the current ride.
      const key = id.slice(3);
      const lvl = (s.upgrades && s.upgrades[key]) || 0;
      if (lvl >= 2) { this.notify('Already at max level.'); return; }
      const price = UPGRADES[key].levels[lvl];
      if (!spend(price)) return;
      if (!s.upgrades) s.upgrades = { armor: 0, engine: 0, tires: 0 };
      s.upgrades[key] = lvl + 1;
      if (this.player.inCar) this.player.inCar.applyUpgrades(s.upgrades);
      this.audio.upgrade();
      this.notify(UPGRADES[key].name + ' Lv ' + (lvl + 1) + ' fitted.');
    } else if (id === 'respray') {
      if (!this.player.inCar) { this.notify('Bring a car to respray.'); return; }
      if (!spend(150)) return;
      // Repaint the body mesh (kept in userData).
      const body = this.player.inCar.mesh.userData.body;
      body.material = body.material.clone();
      body.material.color.setHex(pick(mulberry32(Date.now() % 100000), RESPRAY_COLORS));
      this.setWanted(Math.max(0, this.wanted - 1));
      this.notify('Fresh paint. The heat drops a star.');
    } else if (id === 'repair') {
      if (!this.player.inCar) { this.notify('Bring a car to repair.'); return; }
      if (!spend(200)) return;
      this.player.inCar.repair();
      this.notify('Good as new.');
    } else if (id === 'taco') {
      if (!spend(20)) return;
      this.player.heal(25);
      this.notify('Taco Sol. +25 health.');
    } else if (id === 'burrito') {
      if (!spend(40)) return;
      this.player.heal(50);
      this.notify('Burrito. +50 health.');
    }
    this.writeSave();
    if (this.nearShop) this.openShop(this.nearShop);
  }

  // --- death / arrest ---------------------------------------------------------
  deathStats() {
    return {
      missions: (this.save.stats && this.save.stats.missionsDone) || 0,
      stolen: (this.save.stats && this.save.stats.carsStolen) || 0,
      time: (this.save.stats && this.save.stats.playSeconds) || 0,
      cash: this.save.cash,
    };
  }
  wasted() {
    this.state = 'wasted';
    const lost = Math.round(this.save.cash * 0.1);
    this.save.cash -= lost;
    this.writeSave();
    if (this.missions.state === 'active') this.missions.fail('Rio got wasted');
    this.hud.showDeath('WASTED', lost, this.deathStats(), { onRespawn: () => this.respawn() });
    this.audio.fail();
  }
  busted() {
    this.state = 'busted';
    const lost = Math.round(this.save.cash * 0.15);
    this.save.cash -= lost;
    this.writeSave();
    if (this.missions.state === 'active') this.missions.fail('Busted by the BCPD');
    this.hud.showDeath('BUSTED', lost, this.deathStats(), { onRespawn: () => this.respawn() });
    this.audio.fail();
  }
  respawn() {
    // Exit the car first, or exitCar overwrites the hospital spot.
    if (this.player.inCar) this.exitCar();
    const h = this.world.places.hospital;
    this.player.reset(h.x, h.z + 10);
    this.setWanted(0);
    this.state = 'playing';
    this.hud.hideMenu();
    this.notify('Patched up at the hospital. Back to work, Rio.');
  }

  // Time-of-day cycle: animate sun, sky, fog, lights over 24 min = 24 hours
  updateTimeOfDay(dt) {
    this.tod = (this.tod + dt * this.todSpeed) % 1;
    const angle = this.tod * Math.PI * 2 - Math.PI / 2; // 0 = midnight, PI/2 = sunrise, PI = noon, 3PI/2 = sunset
    const sunHeight = Math.sin(angle);
    const sunAzimuth = Math.cos(angle);

    // Sun position (orbit around city)
    const radius = 350;
    if (this.sun) {
      this.sun.position.set(sunAzimuth * radius, Math.max(20, sunHeight * radius), -120);
      this.sun.target.position.set(0, 0, 0);
      // Intensity: 0 at night, 2.8 at noon
      const intensity = THREE.MathUtils.clamp(sunHeight * 3.5, 0, 2.8);
      this.sun.intensity = intensity;
      this.sun.castShadow = intensity > 0.1;
    }

    // Sun disc & glow (on sky dome)
    const skyRadius = 830;
    if (this.sunDisc) {
      this.sunDisc.position.set(sunAzimuth * skyRadius, Math.max(10, sunHeight * skyRadius), -120);
      this.sunDisc.lookAt(0, 0, 0);
      this.sunDisc.visible = sunHeight > -0.2;
    }
    if (this.sunGlow) {
      this.sunGlow.position.set(sunAzimuth * 820, Math.max(10, sunHeight * 820), -120);
      this.sunGlow.material.opacity = THREE.MathUtils.clamp((sunHeight + 0.3) * 1.2, 0, 0.85);
      this.sunGlow.visible = sunHeight > -0.3;
    }

    // Sky shader uniforms (top, mid, horizon colors)
    if (this.skyMaterial) {
      const uniforms = this.skyMaterial.uniforms;
      // Night colors
      const nightTop = new THREE.Color(0x0a1220);
      const nightMid = new THREE.Color(0x1a1a3a);
      const nightHorizon = new THREE.Color(0x2a1a2a);
      // Dawn/dusk colors
      const dawnHorizon = new THREE.Color(0xff6a3a);
      const dawnMid = new THREE.Color(0xff8a5a);
      // Day colors
      const dayTop = new THREE.Color(0x2a4f7e);
      const dayMid = new THREE.Color(0x6a9fd6);
      const dayHorizon = new THREE.Color(0xffb87a);

      let top, mid, horizon;
      if (sunHeight < -0.3) {
        // Night
        top = nightTop; mid = nightMid; horizon = nightHorizon;
      } else if (sunHeight < 0) {
        // Dawn/dusk transition
        const t = (sunHeight + 0.3) / 0.3; // 0..1
        top = nightTop.clone().lerp(dayTop, t * 0.3);
        mid = nightMid.clone().lerp(dawnMid, t);
        horizon = nightHorizon.clone().lerp(dawnHorizon, t);
      } else if (sunHeight < 0.5) {
        // Morning
        const t = sunHeight / 0.5;
        top = dayTop.clone().lerp(dawnMid, 0.2).lerp(dayTop, t);
        mid = dawnMid.clone().lerp(dayMid, t);
        horizon = dawnHorizon.clone().lerp(dayHorizon, t);
      } else {
        // Day
        top = dayTop; mid = dayMid; horizon = dayHorizon;
      }
      uniforms.top.value.lerp(top, 0.02);
      uniforms.mid.value.lerp(mid, 0.02);
      uniforms.horizon.value.lerp(horizon, 0.02);
    }

    // Hemisphere light (ambient)
    if (this.hemiLight) {
      const groundCol = new THREE.Color(0x5a4a38);
      const skyCol = new THREE.Color(0x9db8d6);
      const nightSky = new THREE.Color(0x1a1a2e);
      const nightGround = new THREE.Color(0x1a1210);
      const t = THREE.MathUtils.clamp((sunHeight + 0.2) / 0.7, 0, 1);
      this.hemiLight.color.lerp(nightSky, 1 - t);
      this.hemiLight.groundColor.lerp(nightGround, 1 - t);
      this.hemiLight.intensity = THREE.MathUtils.clamp(0.3 + t * 0.7, 0.3, 1.0);
    }

    // Fog color
    if (this.scene.fog) {
      const dayFog = new THREE.Color(0xe8965f);
      const nightFog = new THREE.Color(0x1a1a2e);
      const dawnFog = new THREE.Color(0xff6a3a);
      let fogCol;
      if (sunHeight < -0.3) fogCol = nightFog;
      else if (sunHeight < 0) fogCol = nightFog.clone().lerp(dawnFog, (sunHeight + 0.3) / 0.3);
      else if (sunHeight < 0.5) fogCol = dawnFog.clone().lerp(dayFog, sunHeight / 0.5);
      else fogCol = dayFog;
      this.fogColor.lerp(fogCol, 0.01);
      this.scene.fog.color.copy(this.fogColor);
    }

    // Update clock display (24h format)
    const gameHour = Math.floor(this.tod * 24);
    const gameMin = Math.floor((this.tod * 24 * 60) % 60);
    this.clockSec = gameHour * 3600 + gameMin * 60;
  }

  // --- per-frame update -------------------------------------------------------
  update(dt) {
    this.elapsed += dt;
    this.save.stats.playSeconds = (this.save.stats.playSeconds || 0) + dt;
    this.clockSec += dt * 12; // a game minute every 5 real seconds

    // Time-of-day cycle
    this.updateTimeOfDay(dt);

    const p = this.player;

    // Weapon switching.
    if (this.keys.Digit0) this.save.currentWeapon = 'fists';
    if (this.keys.Digit1 && this.save.weapons.pistol) this.save.currentWeapon = 'pistol';
    if (this.keys.Digit2 && this.save.weapons.smg) this.save.currentWeapon = 'smg';
    if (this.keys.Digit3 && this.save.weapons.shotgun) this.save.currentWeapon = 'shotgun';

    // Movement input, in camera space: keys plus the touch stick, so a
    // phone player steers exactly like a keyboard one. Stick to the edge
    // to run, the same as holding SHIFT.
    const ta = this.touch.axes;
    const fwd = clamp((this.keys.KeyW || this.keys.ArrowUp ? 1 : 0) - (this.keys.KeyS || this.keys.ArrowDown ? 1 : 0) + ta.fwd, -1, 1);
    const strafe = clamp((this.keys.KeyD || this.keys.ArrowRight ? 1 : 0) - (this.keys.KeyA || this.keys.ArrowLeft ? 1 : 0) + ta.strafe, -1, 1);
    const running = !!(this.keys.ShiftLeft || this.keys.ShiftRight) || ta.run;
    if (p.inCar) {
      const car = p.inCar;
      car.drive(dt, fwd, strafe, this.world.colliders);
      // Space is the handbrake: hard stop, brake lights on. The touch
      // BRAKE button holds the same line.
      const handbrake = !!this.keys.Space || this.touchBrake;
      if (handbrake) car.speed *= Math.max(0, 1 - 4 * dt);
      p.pos.copy(car.pos);
      p.heading = car.heading;
      this.audio.setEngine(clamp(Math.abs(car.speed) / car.eff.topSpeed, 0, 1), true);
      // Brake lights: S while rolling forward, or the handbrake.
      car.brakeLight((fwd < 0 && car.speed > 0.5) || handbrake);
      // Exhaust puffs at the tailpipe under throttle.
      const rearX = car.pos.x - Math.sin(car.heading) * (car.length / 2 + 0.3);
      const rearZ = car.pos.z - Math.cos(car.heading) * (car.length / 2 + 0.3);
      if (fwd > 0 && Math.abs(car.speed) > 8) {
        this.exhaustTimer -= dt;
        if (this.exhaustTimer <= 0) {
          this.exhaustTimer = 0.12;
          if (car.upgrades.engine > 0) this.particles.flame({ x: rearX, y: 0.5, z: rearZ }, 2);
          else this.particles.smoke({ x: rearX, y: 0.5, z: rearZ }, 1);
        }
      }
      // Dust kicked up by a hard turn at speed, with a tyre screech.
      if (Math.abs(strafe) > 0.7 && Math.abs(car.speed) > 15) {
        this.dustTimer -= dt;
        if (this.dustTimer <= 0) {
          this.dustTimer = 0.2;
          this.particles.smoke({ x: rearX, y: 0.5, z: rearZ }, 1);
          this.audio.skid();
        }
      }
      if (car.smoking) this.particles.smoke({ x: car.pos.x, y: 1.2, z: car.pos.z }, 1);
      // A wrecked ride blows up once (damage() already marks it dead).
      if (car.health <= 0 && !car.exploded) {
        car.exploded = true;
        this.combat.explode({ x: car.pos.x, y: 1, z: car.pos.z }, 9, this.allCars().concat(this.peds.peds), this.audio);
        this.exitCar();
        this.notify('Your ride just blew up.');
        if (this.missions.state === 'active') this.missions.fail('Ride destroyed');
      }
    } else {
      // Camera space: screen-forward is MINUS the camera offset vector.
      const yaw = p.camYaw;
      const mx = -Math.sin(yaw) * fwd + Math.cos(yaw) * strafe;
      const mz = -Math.cos(yaw) * fwd - Math.sin(yaw) * strafe;
      p.updateOnFoot(dt, { x: mx, z: mz }, running, this.world.colliders);
      this.audio.setEngine(0, false);
      // On foot, Rio is solid: cars push him out of their box instead of
      // driving through him, and a fast one hurts.
      for (const car of this.allCars()) {
        if (car.dead) continue;
        const dx = p.pos.x - car.pos.x, dz = p.pos.z - car.pos.z;
        const ah = dx * Math.sin(car.heading) + dz * Math.cos(car.heading);
        const as = dx * Math.cos(car.heading) - dz * Math.sin(car.heading);
        const hl = car.length / 2 + 0.6, hw = 1.05 + 0.6;
        if (Math.abs(ah) < hl && Math.abs(as) < hw) {
          const pushF = hl - Math.abs(ah), pushS = hw - Math.abs(as);
          if (pushF < pushS) p.pos.x += Math.sin(car.heading) * Math.sign(ah) * pushF, p.pos.z += Math.cos(car.heading) * Math.sign(ah) * pushF;
          else p.pos.x += Math.cos(car.heading) * Math.sign(as) * pushS, p.pos.z -= Math.sin(car.heading) * Math.sign(as) * pushS;
          if (Math.abs(car.speed) > 5 && p.damage(8)) { this.wasted(); return; }
        }
      }
      // ...and so are the peds: Rio shoves through a crowd, not through it.
      for (const ped of this.peds.peds) {
        if (ped.dead) continue;
        const dx = ped.pos.x - p.pos.x, dz = ped.pos.z - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.01 && d < 0.9) {
          ped.pos.x += (dx / d) * (0.9 - d);
          ped.pos.z += (dz / d) * (0.9 - d);
        }
      }
    }

    // Headlight pool follows the driven car (hidden on foot).
    // SpotLights only active at night (tod: 0.75..1.0 = 18:00..24:00, 0.0..0.25 = 0:00..6:00)
    const night = this.tod > 0.75 || this.tod < 0.25;
    if (p.inCar) {
      const car = p.inCar;
      this.headlightPool.visible = true;
      this.headlightPool.position.set(car.pos.x, 0, car.pos.z);
      this.headlightPool.rotation.y = car.heading;
      // Update SpotLight targets to point forward
      const forward = 30;
      this.headlightLeft.target.position.set(-1.2, 0, forward);
      this.headlightRight.target.position.set(1.2, 0, forward);
      this.headlightLeft.intensity = night ? 2.5 : 0;
      this.headlightRight.intensity = night ? 2.5 : 0;
      // Update car's own SpotLights (casts shadows)
      car.updateHeadlights(this.tod, true);
    } else {
      this.headlightPool.visible = false;
      this.headlightLeft.intensity = 0;
      this.headlightRight.intensity = 0;
    }
    // Update traffic car headlights (no shadows for performance)
    for (const car of this.traffic.cars) {
      car.updateHeadlights(this.tod, false);
    }
    for (const car of this.police.cars) {
      car.updateHeadlights(this.tod, false);
    }
    for (const car of this.parked) {
      car.updateHeadlights(this.tod, false);
    }

    // Car-vs-car / car-vs-ped collisions for the player's car.
    if (p.inCar) {
      const car = p.inCar;
      for (const other of this.allCars()) {
        if (other === car || other.dead) continue;
        const pen = carsOverlap(car, other);
        if (pen > 0) {
          const dx = car.pos.x - other.pos.x, dz = car.pos.z - other.pos.z;
          const d = Math.hypot(dx, dz) || 1;
          const nx = dx / d, nz = dz / d;
          car.pos.x += nx * pen / 2; car.pos.z += nz * pen / 2;
          other.pos.x -= nx * pen / 2; other.pos.z -= nz * pen / 2;
          const impact = Math.abs(car.speed - other.speed);
          if (impact > 4) {
            car.damage(impact * 1.2);
            const died = other.damage(impact * 1.6);
            this.audio.crash();
            this.particles.burst({ x: car.pos.x, y: 1, z: car.pos.z }, 10, new THREE.Color(0xffd34d), 4, 0.5);
            if (other.kind === 'rival' && died) this.missions.onRivalDead();
            car.speed *= 0.5;
          }
        }
      }
      // Peds under the wheels.
      for (const ped of this.peds.peds) {
        if (ped.dead) continue;
        if (dist2(car.pos.x, car.pos.z, ped.pos.x, ped.pos.z) < 2.4 && Math.abs(car.speed) > 3) {
          const killed = ped.hit(100, car.pos.x, car.pos.z);
          this.save.stats.pedsHit++;
          this.addWanted(2);
          this.audio.crash();
          this.notify(killed ? 'Pedestrian down. The BCPD saw that.' : 'You clipped a pedestrian!');
        }
      }
    }

    // Traffic + police + peds + missions + pickups + fares + packages.
    this.traffic.update(dt, p.pos, this.allCars(), this.peds.peds);
    // A dwelling bus boards its waiters — once per stop, so the same
    // bus does not keep boarding an empty bench for four seconds.
    for (const d of this.traffic.dwelling) {
      const car = d.car;
      if (car.ai.boardedThisStop) continue;
      car.ai.boardedThisStop = true;
      const n = this.peds.boardWaiters(d.stop);
      if (n > 0) this.notify(n + (n === 1 ? ' passenger' : ' passengers') + ' boarded the bus.');
    }
    this.police.update(dt, this.wanted, p.pos, !!p.inCar, this.allCars(), p.heading);
    // Peds flee a danger zone: wanted heat, or Rio speeding at them in
    // a car even with no stars — a fast car is danger on its own.
    const speeding = p.inCar && Math.abs(p.inCar.speed) > 10;
    const danger = (this.wanted > 0 || speeding) ? { x: p.pos.x, z: p.pos.z, r: this.wanted > 0 ? 25 : 12 } : null;
    this.peds.update(dt, danger, p.pos);
    this.missions.update(dt);
    this.pickups.update(dt, p.pos, this);
    this.taxi.update(dt);
    this.collectibles.update(dt, p.pos, this);
    this.combat.update(dt);
    this.particles.update(dt);
    this.birds.update(dt, this.elapsed);
    this.audio.update();

    // Roadblock alert: once, when the first block goes up.
    if (this.police.blockers.length > 0 && !this.roadblockAlerted) {
      this.roadblockAlerted = true;
      this.audio.roadblock();
      this.notify('Roadblock ahead - the BCPD is blocking the road!');
    } else if (this.police.blockers.length === 0) {
      this.roadblockAlerted = false;
    }

    // Guards shoot back at Rio; gang muscle closes in and swings, or
    // shoots when armed. Melee and gunfire share the shoot timer.
    for (const ped of this.peds.peds) {
      if (!ped.hostile || ped.dead) continue;
      const d = dist2(ped.pos.x, ped.pos.z, p.pos.x, p.pos.z);
      if (ped.role === 'gang') {
        if (d > 26) continue;
        ped.shootTimer -= dt;
        ped.heading = Math.atan2(p.pos.x - ped.pos.x, p.pos.z - ped.pos.z);
        if (ped.shootTimer <= 0) {
          ped.shootTimer = 1.0 + Math.random() * 0.6;
          if (d < 2.2 && !p.inCar) {
            if (p.damage(8 + Math.random() * 5)) { this.wasted(); return; }
          } else if (ped.armed) {
            if (p.damage(5 + Math.random() * 5)) { this.wasted(); return; }
            this.particles.sparks({ x: ped.pos.x, y: 1.4, z: ped.pos.z }, 4);
          }
          this.hud.flashDamage();
          this.audio.blip(180, 0.1, 0.12);
        }
        continue;
      }
      if (d < 26) {
        ped.shootTimer -= dt;
        ped.heading = Math.atan2(p.pos.x - ped.pos.x, p.pos.z - ped.pos.z);
        if (ped.shootTimer <= 0) {
          ped.shootTimer = 1.1 + Math.random() * 0.7;
          if (p.damage(6 + Math.random() * 7)) { this.wasted(); return; }
          this.hud.flashDamage();
          this.audio.blip(180, 0.1, 0.12);
        }
      }
    }

    // Wanted decay: out of every cop's sight long enough, lose a star.
    if (this.wanted > 0) {
      const nearest = this.police.nearestPoliceDist(p.pos);
      if (nearest > 70) {
        this.wantedDecay += dt;
        if (this.wantedDecay > 14) { this.setWanted(this.wanted - 1); this.notify('The heat is cooling off.'); }
      } else this.wantedDecay = 0;
      // Busted: on foot, a cop right on top of a slow Rio.
      if (!p.inCar && nearest < 3.2 && p.speed < 1) {
        this.bustedTimer += dt;
        if (this.bustedTimer > 2) { this.busted(); return; }
      } else this.bustedTimer = 0;
    }
    this.audio.setSiren(this.wanted > 0, this.police.nearestPoliceDist(p.pos));

    // Interaction detection for context prompts
    this.nearShop = null;
    this.nearCar = null;
    this.nearPickup = null;
    this.nearMission = null;

    if (!p.inCar) {
      // Nearest shop
      for (const s of this.world.shops) {
        if (dist2(p.pos.x, p.pos.z, s.x, s.z) < 7) { this.nearShop = s; break; }
      }
      // Nearest car (steal/enter)
      this.nearCar = !this.taxi.offer ? this.nearestCar(3.4) : null;
      // Nearest pickup
      const pickups = this.pickups.activePickups();
      let bestPickup = null, bestDist2 = 9;
      for (const pu of pickups) {
        const d2 = dist2(p.pos.x, p.pos.z, pu.x, pu.z);
        if (d2 < bestDist2) { bestDist2 = d2; bestPickup = pu; }
      }
      this.nearPickup = bestPickup;
      // Nearest mission marker
      if (this.missions.markerPos) {
        const d2m = dist2(p.pos.x, p.pos.z, this.missions.markerPos.x, this.missions.markerPos.z);
        if (d2m < 9) this.nearMission = { name: this.missions.meta?.name || 'Mission' };
      }
    }

    // Legacy prompt text (for compatibility)
    this.promptText = this.shopOpen ? null
      : this.taxi.offer ? 'E — Pick up ' + this.taxi.offer.name
      : this.nearShop ? 'E — ' + this.nearShop.name + ': ' + this.nearShop.blurb
      : this.nearCar ? 'E — Steal the ' + this.nearCar.def.label : null;

    // Keep the city populated around the player.
    if (this.traffic.cars.filter((c) => !c.dead).length < 10) this.traffic.spawn(4, p.pos, 130);
    if (this.peds.peds.filter((x) => !x.dead).length < 16) this.peds.spawn(6, p.pos, 100);
    // Keep the bus stops staffed — when the waiters thin out, send
    // two more to a random stop. A stop with no waiters is just a bench.
    if (this.peds.waiters().length < 4) {
      const stop = this.world.busStops[Math.floor(Math.random() * this.world.busStops.length)];
      this.peds.spawnWaiters(stop, 2);
    }
    // A fresh walking group now and then, so the sidewalks are not
    // only lone walkers.
    if (this.peds.peds.filter((x) => !x.dead && x.role === 'group').length < 3 && Math.random() < dt * 0.1) {
      this.peds.spawnGroup(p.pos.x + 20, p.pos.z + 10, 3);
    }

    // Sea shimmer + camera + HUD.
    this.world.seaMaterial.uniforms.t.value = this.elapsed;
    const target = p.inCar ? { x: p.inCar.pos.x, y: 1.5, z: p.inCar.pos.z } : { x: p.pos.x, y: 1.5, z: p.pos.z };
    p.updateCamera(dt, this.camera, target);
    this.hud.update(dt, {
      cash: this.save.cash,
      health: p.health,
      armor: p.armor,
      wanted: this.wanted,
      weaponName: WEAPONS[this.save.currentWeapon || 'fists'].name,
      ammo: this.save.weapons[this.save.currentWeapon || 'fists']?.ammo ?? 0,
      weaponKey: this.save.currentWeapon || 'fists',
      weapons: this.save.weapons,
      speedKmh: p.inCar ? Math.abs(p.inCar.speed) * 3.6 : p.speed * 3.6,
      carHealth: p.inCar ? p.inCar.health : null,
      carSpeed: p.inCar ? p.inCar.speed : 0,
      carTop: p.inCar ? (p.inCar.eff ? p.inCar.eff.topSpeed : p.inCar.def.topSpeed) : 0,
      inCar: !!p.inCar,
      prompt: this.promptText,
      radio: this.audio.stationName(),
      objective: this.objectiveText(),
      clockSec: this.clockSec % 86400,
      player: { x: p.pos.x, z: p.pos.z, heading: p.heading },
      cars: this.allCars(),
      heliPos: this.police.heli ? { x: this.police.heli.position.x, z: this.police.heli.position.z } : null,
      markerPos: this.missions.markerPos || null,
      pickups: this.pickups.activePickups(),
      roadblocks: this.police.blockers.map((b) => ({ x: b.x, z: b.z, heading: b.heading })),
      mods: this.save.upgrades || { armor: 0, engine: 0, tires: 0 },
      fare: this.taxi.minimapBlip(),
      busStops: this.world.busStops,
      gangs: GANGS,
      nearShop: this.nearShop,
      nearCar: this.nearCar,
      nearPickup: this.nearPickup,
      nearMission: this.nearMission,
    });
    if (this.elapsed % 30 < dt) this.writeSave();
  }

  loop() {
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.state === 'playing') this.update(dt);
    else if (this.state === 'menu' || this.state === 'paused') {
      // Slow cinematic orbit behind the start menu.
      const t = performance.now() / 1000;
      this.camera.position.set(Math.sin(t * 0.05) * 120, 60, Math.cos(t * 0.05) * 120);
      this.camera.lookAt(0, 10, 0);
      this.world.seaMaterial.uniforms.t.value = t;
      this.particles.update(dt);
      // Update time-of-day in menu too
      this.updateTimeOfDay(dt);
    }
    // Update cutscenes in all states
    if (this.cutscenes) this.cutscenes.update(dt);
    // The lighthouse beam sweeps the bay in every state.
    if (this.world.lighthouseBeam) this.world.lighthouseBeam.rotation.y += dt * 0.5;
    if (this.warmupFrames > 0) this.warmupFrames--;
    this.renderer.render(this.scene, this.camera);
    if (!window.__BRISABAY_READY) {
      window.__BRISABAY_READY = true;
      document.title = 'BRISA BAY - ready';
    }
  }

  // Race Map System: swap city for a dedicated race track
  enterRaceMap(track) {
    // Store current scene objects we need to preserve
    this.raceScene = new THREE.Scene();
    this.raceScene.background = this.scene.background;
    this.raceScene.fog = this.scene.fog;

    // Copy lights
    this.sun = this.world.sun;
    this.hemiLight = this.world.hemiLight;
    this.raceScene.add(this.sun, this.sun.target, this.hemiLight);

    // Build race track geometry (simple road mesh with checkpoints)
    this.buildRaceTrack(track);

    // Swap scenes
    this.cityScene = this.scene;
    this.scene = this.raceScene;
    this.missions.raceMode = true;

    // Reset traffic/police for race
    this.traffic.cars.forEach(c => this.removeCar(c));
    this.traffic.cars = [];
    this.police.cars.forEach(c => this.removeCar(c));
    this.police.cars = [];

    this.notify('Race map loaded: ' + track.name);
  }

  buildRaceTrack(track) {
    // Create a simple road path following checkpoints
    const roadWidth = 14;
    const points = track.checkpoints.map(cp => new THREE.Vector3(cp.x, 0.05, cp.z));
    // Close the loop for circuit tracks
    if (track.type === 'circuit') {
      points.push(points[0].clone());
    }

    // Road mesh using a tube-like geometry
    const curve = new THREE.CatmullRomCurve3(points, track.type === 'circuit');
    const roadGeo = new THREE.TubeGeometry(curve, points.length * 8, roadWidth / 2, 8, track.type === 'circuit');
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x2b2e33,
      roughness: 0.9,
      metalness: 0.1,
    });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    this.raceScene.add(roadMesh);

    // Checkpoint markers
    track.checkpoints.forEach((cp, i) => {
      const ringGeo = new THREE.RingGeometry(cp.radius - 1, cp.radius, 24);
      const ringMat = new THREE.MeshBasicMaterial({
        color: i === 0 ? 0x00ff88 : 0xffd34d,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(cp.x, 0.1, cp.z);
      this.raceScene.add(ring);
    });

    // Start/finish line
    const start = track.checkpoints[0];
    const lineGeo = new THREE.PlaneGeometry(roadWidth + 2, 1);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
    const line = new THREE.Mesh(lineGeo, lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(start.x, 0.12, start.z);
    this.raceScene.add(line);

    // Drift zones (for drift track)
    if (track.driftZones) {
      track.driftZones.forEach(dz => {
        const zoneGeo = new THREE.RingGeometry(dz.radius - 5, dz.radius, 32);
        const zoneMat = new THREE.MeshBasicMaterial({
          color: 0xff6a00,
          transparent: true,
          opacity: 0.15,
          side: THREE.DoubleSide,
        });
        const zone = new THREE.Mesh(zoneGeo, zoneMat);
        zone.rotation.x = -Math.PI / 2;
        zone.position.set(dz.x, 0.08, dz.z);
        this.raceScene.add(zone);
      });
    }
  }

  exitRaceMap() {
    if (!this.raceScene) return;

    // Clean up race scene
    this.raceScene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });

    // Restore city scene
    this.scene = this.cityScene;
    this.cityScene = null;
    this.raceScene = null;
    this.missions.raceMode = false;

    // Re-add sun/hemi to city scene
    this.cityScene.add(this.sun, this.sun.target, this.hemiLight);

    // Respawn traffic
    this.traffic.spawn(18, { x: 0, z: 0 }, 300);
    this.police.spawn(4, { x: 0, z: 0 }, 300);

    this.notify('Returned to city');
  }
}

window.addEventListener('error', (e) => { document.title = 'ERR: ' + (e.message || 'unknown'); });

const game = new Game();
window.game = game; // Expose for debugging
// Screenshot staging must run after the first boot, before capture.
if (game.shotMode) {
  // Test hook: live probes reach the game only in shot mode, never in
  // normal play. The CDP verification drives missions, fares and
  // packages through this handle.
  window.__game = game;
  requestAnimationFrame(() => setTimeout(() => stageShot(game, game.shotMode), 300));
}
