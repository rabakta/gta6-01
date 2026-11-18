// BRISA BAY — boot, game loop and the glue between systems.
// Rio Marin is back in Brisa Bay: drive, steal, run missions, dodge the BCPD.
import * as THREE from 'three';
import { CITY, CAR_DEFS, WEAPONS, SHOPS, MISSION_META, STORY_INTRO } from './config.js';
import { clamp, damp, dist2, mulberry32, pick, fmtMoney } from './utils.js';
import { buildCity, roadLines } from './city.js';
import { Car, TrafficManager, PoliceManager } from './vehicles.js';
import { Player } from './player.js';
import { PedManager } from './pedestrians.js';
import { Combat, ParticleSystem } from './combat.js';
import { MissionManager } from './missions.js';
import { AudioEngine } from './audio.js';
import { HUD } from './hud.js';
import { loadSave, writeSave, defaultSave, clearSave } from './save.js';
import { shotParam, stageShot } from './shots.js';

const SAVE_VERSION = 1;

class Game {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game'), antialias: true });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 2000);

    this.world = buildCity(this.scene);
    this.particles = new ParticleSystem(this.scene);
    this.audio = new AudioEngine();
    this.hud = new HUD(this.world);
    this.save = loadSave() || defaultSave();
    this.save._v = SAVE_VERSION;

    this.player = new Player(this.scene, -140, 140);
    this.player.health = 100;
    this.player.armor = this.save.armor || 0;
    this.traffic = new TrafficManager(this.scene, this.world, mulberry32(99));
    this.police = new PoliceManager(this.scene, this.world, mulberry32(7));
    this.peds = new PedManager(this.scene, this.world);
    this.combat = new Combat(this.scene, this.particles);
    this.missions = new MissionManager(this);

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
    this.lastX = 0;
    this.lastY = 0;
    this.ownedCars = new Map(); // car -> true (player's parked rides)
    this.shotMode = shotParam();

    this.traffic.spawn(14, { x: -140, z: 140 }, 150);
    this.peds.spawn(24, { x: -140, z: 140 }, 120);
    // A few parked cars near the start so the first minute has wheels.
    this.spawnCar('brisa', 0xc94f43, -120, 120, Math.PI / 2);
    this.spawnCar('vento', 0x2b3a55, -100, 160, -Math.PI / 2);
    this.spawnCar('taxi', 0xf2a007, -160, 100, 0);

    this.bindInput();
    addEventListener('resize', () => this.onResize());
    this.hud.showMenu('start', 'BRISA BAY', this.startMenuBody(), 'Press ENTER to start - New Game or Continue');
    this.clock = new THREE.Clock();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  startMenuBody() {
    const hasSave = !!loadSave();
    const next = this.save.missionIndex < MISSION_META.length ? MISSION_META[this.save.missionIndex] : null;
    return (
      '<p class="story">' + STORY_INTRO.join('<br>') + '</p>' +
      '<p class="controls">WASD drive / walk &nbsp;·&nbsp; SHIFT run &nbsp;·&nbsp; E enter car &nbsp;·&nbsp; F punch &nbsp;·&nbsp; CLICK shoot<br>' +
      'R radio &nbsp;·&nbsp; M next mission &nbsp;·&nbsp; P pause &nbsp;·&nbsp; Mouse drag: camera</p>' +
      (next ? '<p class="next">Next mission: <b>' + next.name + '</b> — ' + next.brief + '</p>' : '<p class="next">Story complete. Free roam, Rio.</p>') +
      '<p class="save-line">' + (hasSave ? 'Save found: ' + fmtMoney(this.save.cash) + ' - chapter ' + (this.save.missionIndex + 1) + ' of 8. [C] Continue &nbsp; [N] New game' : 'No save yet. [N] New game') + '</p>'
    );
  }

  writeSave() { writeSave(this.save); }

  notify(text) { this.hud.notify(text); }
  setWanted(n) { this.wanted = clamp(Math.round(n), 0, 5); this.wantedDecay = 0; }
  addWanted(n) { this.setWanted(this.wanted + n); }

  // --- input ------------------------------------------------------------------
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
      if (e.code === 'KeyE') this.onInteract();
      if (e.code === 'KeyF' && this.state === 'playing' && !this.player.inCar) this.punch();
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    const canvas = document.getElementById('game');
    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true; this.dragDist = 0; this.lastX = e.clientX; this.lastY = e.clientY;
      this.audio.ensure(); this.audio.resume();
    });
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
    this.hud.showMenu('pause', 'PAUSED', '<p>Take a breath, Rio. The city waits.</p><p class="controls">P / ESC resume &nbsp;·&nbsp; R radio &nbsp;·&nbsp; M next mission</p>', 'Press P to resume');
  }
  resume() { this.state = 'playing'; this.hud.hideMenu(); }

  // --- cars -------------------------------------------------------------------
  spawnCar(defKey, color, x, z, heading) {
    const car = new Car(defKey, color, x, z, heading);
    this.scene.add(car.mesh);
    return car;
  }
  removeCar(car) {
    this.scene.remove(car.mesh);
    if (this.player.inCar === car) this.player.inCar = null;
  }
  allCars() {
    const list = [...this.traffic.cars, ...this.police.cars];
    if (this.missions.rival) list.push(this.missions.rival);
    if (this.missions.targetCar) list.push(this.missions.targetCar);
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
    car.mesh.visible = true;
    this.player.mesh.visible = false;
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
    if (this.player.inCar) { this.exitCar(); return; }
    if (this.nearShop) { this.openShop(this.nearShop); return; }
    const car = this.nearestCar(3.4);
    if (car) {
      const stealing = car.kind === 'traffic' || car.kind === 'mission';
      this.enterCar(car);
      if (stealing) {
        this.addWanted(1);
        this.save.stats.carsStolen++;
        this.notify('You stole the ' + car.def.label + '. The BCPD noticed.');
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
    const onLine = ai.axis === 'x'
      ? Math.abs(car.pos.z - this.nearestRoad(car.pos.z)) < 1.4
      : Math.abs(car.pos.x - this.nearestRoad(car.pos.x)) < 1.4;
    if (onLine && Math.random() < dt * 0.5) {
      ai.axis = ai.axis === 'x' ? 'z' : 'x';
      car.heading += Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
    }
  }

  nearestRoad(v) {
    const lines = roadLines();
    let best = lines[0], bd = Math.abs(v - lines[0]);
    for (const l of lines) { const d = Math.abs(v - l); if (d < bd) { bd = d; best = l; } }
    return best;
  }

  // --- combat (player side) ---------------------------------------------------
  punch() {
    const targets = [];
    for (const p of this.peds.peds) if (!p.dead) targets.push(p);
    const dir = { x: Math.sin(this.player.heading), z: Math.cos(this.player.heading) };
    const origin = { x: this.player.pos.x, y: 1.2, z: this.player.pos.z };
    const hit = this.combat.fire('fists', origin, dir, targets, null);
    if (hit && hit.target.role === 'guard') this.missions.onGuardKilled();
    if (hit && hit.killed) this.addWanted(1);
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
      if (hit.target.kind === 'car' && hit.target.kind === 'rival') { /* rival handled below */ }
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
    } else if (shop.kind === 'paint') {
      html = this.shopButton('respray', 'Respray - $150', 'New paint, less heat') +
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
    } else if (id === 'respray') {
      if (!this.player.inCar) { this.notify('Bring a car to respray.'); return; }
      if (!spend(150)) return;
      this.player.inCar.mesh.children[0].material = this.player.inCar.mesh.children[0].material.clone();
      this.player.inCar.mesh.children[0].material.color.setHex(pick(mulberry32(Date.now() % 100000), [0xc94f43, 0x4a6fa5, 0xf2c230, 0x5a7d5a, 0xd21f2b]));
      this.setWanted(Math.max(0, this.wanted - 1));
      this.notify('Fresh paint. The heat drops a star.');
    } else if (id === 'repair') {
      if (!this.player.inCar) { this.notify('Bring a car to repair.'); return; }
      if (!spend(200)) return;
      this.player.inCar.health = 100;
      this.player.inCar.smoking = false;
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
  wasted() {
    this.state = 'wasted';
    const lost = Math.round(this.save.cash * 0.1);
    this.save.cash -= lost;
    this.writeSave();
    if (this.missions.state === 'active') this.missions.fail('Rio got wasted');
    this.hud.showMenu('dead', 'WASTED', '<p>Rio went down in Brisa Bay.</p><p>Hospital bill: ' + fmtMoney(lost) + '.</p>', 'Press ENTER to get back up');
    this.audio.fail();
  }
  busted() {
    this.state = 'busted';
    const lost = Math.round(this.save.cash * 0.15);
    this.save.cash -= lost;
    this.writeSave();
    if (this.missions.state === 'active') this.missions.fail('Busted by the BCPD');
    this.hud.showMenu('dead', 'BUSTED', '<p>The BCPD hauled Rio in.</p><p>Bail: ' + fmtMoney(lost) + '.</p>', 'Press ENTER to walk free');
    this.audio.fail();
  }
  respawn() {
    const h = this.world.places.hospital;
    this.player.pos.set(h.x, 0, h.z + 10);
    this.player.heading = 0;
    this.player.health = 100;
    if (this.player.inCar) this.exitCar();
    this.setWanted(0);
    this.state = 'playing';
    this.hud.hideMenu();
    this.notify('Patched up at the hospital. Back to work, Rio.');
  }

  // --- per-frame update -------------------------------------------------------
  update(dt) {
    this.elapsed += dt;
    this.clockSec += dt * 12; // a game minute every 5 real seconds
    const p = this.player;

    // Weapon switching.
    if (this.keys.Digit1 && this.save.weapons.pistol) this.save.currentWeapon = 'pistol';
    if (this.keys.Digit2 && this.save.weapons.smg) this.save.currentWeapon = 'smg';
    if (this.keys.Digit3 && this.save.weapons.shotgun) this.save.currentWeapon = 'shotgun';

    // Movement input, in camera space.
    const fwd = (this.keys.KeyW || this.keys.ArrowUp ? 1 : 0) - (this.keys.KeyS || this.keys.ArrowDown ? 1 : 0);
    const strafe = (this.keys.KeyD || this.keys.ArrowRight ? 1 : 0) - (this.keys.KeyA || this.keys.ArrowLeft ? 1 : 0);
    if (p.inCar) {
      const car = p.inCar;
      car.drive(dt, fwd, strafe, this.world.colliders);
      p.pos.copy(car.pos);
      p.heading = car.heading;
      this.audio.setEngine(clamp(Math.abs(car.speed) / car.def.topSpeed, 0, 1), true);
      if (car.smoking) this.particles.smoke({ x: car.pos.x, y: 1.2, z: car.pos.z }, 1);
      if (car.health <= 0 && !car.dead) {
        car.dead = true;
        this.combat.explode({ x: car.pos.x, y: 1, z: car.pos.z }, 9, this.allCars().concat(this.peds.peds), this.audio);
        this.exitCar();
        this.notify('Your ride just blew up.');
        if (this.missions.state === 'active') this.missions.fail('Ride destroyed');
      }
    } else {
      const yaw = p.camYaw;
      const mx = Math.sin(yaw) * fwd + Math.cos(yaw) * strafe;
      const mz = Math.cos(yaw) * fwd - Math.sin(yaw) * strafe;
      p.updateOnFoot(dt, { x: mx, z: mz }, !!(this.keys.ShiftLeft || this.keys.ShiftRight), this.world.colliders);
      this.audio.setEngine(0, false);
    }

    // Car-vs-car and car-vs-ped collisions for the player's car.
    if (p.inCar) {
      const car = p.inCar;
      for (const other of this.allCars()) {
        if (other === car || other.dead) continue;
        const d = dist2(car.pos.x, car.pos.z, other.pos.x, other.pos.z);
        if (d < 3.6) {
          const impact = Math.abs(car.speed - other.speed);
          const nx = (car.pos.x - other.pos.x) / (d || 1), nz = (car.pos.z - other.pos.z) / (d || 1);
          car.pos.x += nx * 0.4; car.pos.z += nz * 0.4;
          other.pos.x -= nx * 0.4; other.pos.z -= nz * 0.4;
          if (impact > 4) {
            car.damage(impact * 1.2);
            const died = other.damage(impact * 1.6);
            this.audio.crash();
            this.particles.burst({ x: car.pos.x, y: 1, z: car.pos.z }, 10, new THREE.Color(0xffd34d), 4, 0.5);
            if (other.kind === 'rival' && died) this.missions.onRivalDead();
            if (other.kind === 'police') this.addWanted(0);
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

    // Traffic + police + peds + missions.
    this.traffic.update(dt, p.pos, this.allCars());
    this.police.update(dt, this.wanted, p.pos, !!p.inCar, this.allCars());
    const danger = this.wanted > 0 ? { x: p.pos.x, z: p.pos.z, r: 25 } : null;
    this.peds.update(dt, danger);
    this.missions.update(dt);
    this.combat.update(dt);
    this.particles.update(dt);
    this.audio.update();

    // Guards shoot back at Rio.
    for (const ped of this.peds.peds) {
      if (!ped.hostile || ped.dead) continue;
      const d = dist2(ped.pos.x, ped.pos.z, p.pos.x, p.pos.z);
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

    // Shops: nearest one within reach shows its prompt.
    this.nearShop = null;
    if (!p.inCar) {
      for (const s of this.world.shops) {
        if (dist2(p.pos.x, p.pos.z, s.x, s.z) < 7) { this.nearShop = s; break; }
      }
    }

    // Keep the city populated around the player.
    if (this.traffic.cars.filter((c) => !c.dead).length < 10) this.traffic.spawn(4, p.pos, 130);
    if (this.peds.peds.filter((x) => !x.dead).length < 16) this.peds.spawn(6, p.pos, 100);

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
      speedKmh: p.inCar ? Math.abs(p.inCar.speed) * 3.6 : p.speed * 3.6,
      radio: this.audio.stationName(),
      objective: this.missions.objectiveText(),
      clockSec: this.clockSec % 86400,
      player: { x: p.pos.x, z: p.pos.z, heading: p.heading },
      cars: this.allCars(),
      markerPos: this.missions.markerPos || null,
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
    }
    if (this.warmupFrames > 0) this.warmupFrames--;
    this.renderer.render(this.scene, this.camera);
    if (!window.__BRISABAY_READY) {
      window.__BRISABAY_READY = true;
      document.title = 'BRISA BAY - ready';
    }
  }
}

window.addEventListener('error', (e) => { document.title = 'ERR: ' + (e.message || 'unknown'); });

const game = new Game();
// Screenshot staging must run after the first boot, before capture.
if (game.shotMode) {
  requestAnimationFrame(() => setTimeout(() => stageShot(game, game.shotMode), 300));
}
