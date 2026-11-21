// BRISA BAY v5 — logic tests. Node-only, no browser: the game modules
// run against a stubbed document/localStorage and the real vendored
// three.js, with a fake scene and a fake game object. Run:
//   node v3test/test.mjs
// Exit code 0 = all pass. This directory is test scaffolding, NOT part of
// the entry (main.ts copies only game/ + screenshots/). v4 adds bikes,
// buses, bus stops, ped roles, birds and parked cars. v5 adds per-storey
// facades with emissive lit windows, ground detail and light halos.
import * as THREE from 'three';
import { CITY, PALETTE, MISSION_META, RACE_CHECKPOINTS, TAXI, COLLECTIBLES, COLLECTIBLE_BONUS, PICKUPS, CAR_DEFS, BUS_STOPS, VENDORS, PARKED_SPOTS, BIRD_FLOCKS, PERFORMER_SPOT, GANGS, BOAT_DOCKS, BOAT_BOUNDS, RADIO_STATIONS, SHOPS } from '../game/src/config.js';
import { defaultSave, sanitizeSave, loadSave, writeSave, SAVE_VERSION } from '../game/src/save.js';
import { dist2, clamp, angleDiff, mulberry32, theftWitnessed } from '../game/src/utils.js';
import { roadLines, buildCity, resolveCircleCollisions, PLAZA_SPOTS, facadeBucket } from '../game/src/city.js';
import { facadeTexture } from '../game/src/textures.js';
import { Car, Boat, TrafficManager, makeCarMesh, carsOverlap } from '../game/src/vehicles.js';
import { PedManager, Ped } from '../game/src/pedestrians.js';
import { Birds } from '../game/src/birds.js';
import { MissionManager, MISSIONS, MISSION_DIALOGUE } from '../game/src/missions.js';
import { TaxiManager } from '../game/src/taxi.js';
import { PROPERTIES, propEntry, shopIndex, PropertiesManager } from '../game/src/properties.js';
import { CollectibleManager } from '../game/src/collectibles.js';
import { PickupManager } from '../game/src/pickups.js';
import { weaponSlotList, gearFor, HUD } from '../game/src/hud.js';
import { joystickAxes, TouchControls } from '../game/src/touch.js';
import { clampVolume, AudioEngine, RADIO_DJS, RADIO_ADS } from '../game/src/audio.js';
import { Player } from '../game/src/player.js';
import { SideManager } from '../game/src/side.js';
import { DistrictsManager, DISTRICTS, districtAt, CLUB, ROOM } from '../game/src/districts.js';

// The game uses requestAnimationFrame in a few HUD paths (toast, prompt,
// armour bar); node has none, so stub it globally.
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

// ---------------------------------------------------------------------------
// Stubs: a 2D canvas context that absorbs every call, a document that
// hands out stub canvases, and a Map-backed localStorage.
// ---------------------------------------------------------------------------
function ctxStub() {
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get(_t, k) {
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
      if (k === 'measureText') return () => ({ width: 0 });
      // generateNormalMap / generateClearcoatNormal write pixel data into
      // a real ImageData buffer; a stub that returns undefined breaks them.
      if (k === 'createImageData') return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (k === 'getImageData') return (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      return () => {};
    },
    set() { return true; },
  });
}
function canvasStub() {
  return { width: 300, height: 150, getContext: () => ctxStub() };
}
// A DOM element stub with listeners, classList, children and the query
// helpers the HUD and the touch layer use — enough to construct a HUD,
// open its menus and fire a button click, with no browser.
function elStub(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    style: {},
    dataset: {},
    children: [],
    parentNode: null,
    nextSibling: null,
    textContent: '',
    innerHTML: '',
    value: '',
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, f) { if (f === undefined) f = !this._s.has(c); if (f) this._s.add(c); else this._s.delete(c); return f; },
      contains(c) { return this._s.has(c); },
    },
    _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    fire(type, ev) { for (const fn of (this._listeners[type] || [])) fn(ev || { target: this }); },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    insertBefore(c, ref) { const i = ref ? this.children.indexOf(ref) : -1; if (i >= 0) this.children.splice(i, 0, c); else this.children.push(c); c.parentNode = this; return c; },
    querySelector(sel) {
      if (sel.startsWith('#')) {
        let found = this.children.find((c) => c.id === sel.slice(1));
        if (!found) {
          // Real browsers parse innerHTML into children; the stub does
          // not, so vivify the looked-up id or HUD builders that wire
          // buttons right after setting innerHTML break on null.
          found = elStub('div');
          found.id = sel.slice(1);
          this.children.push(found);
          found.parentNode = this;
        }
        return found;
      }
      if (sel === '[data-act]') return this.children.find((c) => c.dataset && c.dataset.act) || null;
      if (!this._qsCache) this._qsCache = {};
      if (!this._qsCache[sel]) {
        const s = elStub('div');
        this._qsCache[sel] = s;
        this.children.push(s);
        s.parentNode = this;
      }
      return this._qsCache[sel];
    },
    querySelectorAll() { return []; },
    closest(sel) {
      if (sel === '[data-act]' && this.dataset.act) return this;
      return null;
    },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
    setPointerCapture() {},
  };
  return el;
}
const _byId = {};
const _body = elStub('body');
const _head = elStub('head');
globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? canvasStub() : elStub(tag)),
  getElementById: (id) => {
    if (!_byId[id]) {
      _byId[id] = id === 'minimap' ? canvasStub() : elStub('div');
      _byId[id].id = id;
    }
    return _byId[id];
  },
  head: _head,
  body: _body,
};
// The health bar's parent takes the armour bar the HUD injects.
_byId['health-bar'] = _byId['health-bar'] || elStub('div');
_byId['health-bar'].parentNode = elStub('div');
_byId['health-fill'] = _byId['health-fill'] || elStub('div');
_byId['health-fill'].parentNode = _byId['health-bar'];
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

// ---------------------------------------------------------------------------
// Tiny test harness.
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok ' + name);
  } catch (e) {
    failed++;
    failures.push(name + ': ' + e.message);
    console.log('  FAIL ' + name + ' — ' + e.message);
  }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || 'expected equal') + ' (got ' + a + ', want ' + b + ')');
}
function ok(v, msg) {
  if (!v) throw new Error(msg || 'expected truthy, got ' + v);
}
function near(a, b, eps, msg) {
  if (Math.abs(a - b) > eps) throw new Error((msg || 'expected near') + ' (got ' + a + ', want ~' + b + ')');
}

// ---------------------------------------------------------------------------
// Fake scene + fake game: the systems under test only need scene.add/remove,
// a player pos, audio no-ops, and the save.
// ---------------------------------------------------------------------------
function fakeScene() {
  return { add() {}, remove() {} };
}
const audioStub = {
  blip() {}, jingle() {}, fail() {}, pickup() {}, upgrade() {}, crash() {},
  gunshot() {}, horn() {}, roadblock() {}, skid() {}, explosion() {},
  setEngine() {}, setSiren() {}, startEngine() {}, startSiren() {},
  ensure() {}, resume() {}, update() {}, setStation() {}, stationName() { return 'SOL 98.5'; },
  toggleRadio() { return true; },
};
function fakeGame() {
  const scene = fakeScene();
  const save = defaultSave();
  const world = buildCity(scene);
  const game = {
    scene, world, save, audio: audioStub,
    state: 'playing',
    wanted: 0,
    tod: 0.775,
    traffic: { cars: [] },
    police: { cars: [], blockers: [] },
    notes: [],
    saved: false,
    bannerText: null,
    splash: null,
    spawnedCars: [],
    cutscenes: {
      playMissionIntro(name, brief, cb) { if (cb) cb(); },
      playMissionOutro(name, reward, cb) { if (cb) cb(); },
      playRaceStart(cb) { if (cb) cb(); },
    },
    enterRaceMap() {
      // Mirror main.js: the race map is open ground, city colliders parked.
      if (game.missions) game.missions.raceMode = true;
      game.savedCityColliders = game.world.colliders;
      game.world.colliders = [];
    },
    exitRaceMap() {
      if (game.missions) game.missions.raceMode = false;
      if (game.savedCityColliders) {
        game.world.colliders = game.savedCityColliders;
        game.savedCityColliders = null;
      }
    },
    player: {
      pos: new THREE.Vector3(-140, 0, 140), heading: 0, speed: 0,
      health: 100, armor: 0, inCar: null, camYaw: 0, camPitch: 0.32,
      mesh: { visible: true },
      // NOTE: the real Player has no enterCar/exitCar — those live on the
      // Game (main.js). A stub here once masked a live crash in
      // missions.js (player.enterCar is not a function), so keep them off.
    },
    peds: null, missions: null, taxi: null, collectibles: null,
    notify(text) { game.notes.push(text); },
    setWanted(n) { game.wanted = n; },
    addWanted(n) { game.wanted += n; },
    writeSave() { game.saved = true; },
    // Mirror main.js: enterCar/exitCar live on the Game, not the Player.
    enterCar(car) { this.player.inCar = car; car.driver = 'player'; },
    exitCar() {
      const car = this.player.inCar;
      if (!car) return;
      this.player.inCar = null;
      car.driver = null;
      car.speed = 0;
    },
    spawnCar(defKey, color, x, z, heading) {
      const c = new Car(defKey, color, x, z, heading);
      scene.add(c.mesh);
      game.spawnedCars.push(c);
      return c;
    },
    removeCar(car) { scene.remove(car.mesh); },
    trafficLikeDrive(car, dt, targetSpeed) {
      car.drive(dt, car.speed < targetSpeed ? 0.7 : 0.15, 0, world.colliders);
    },
    allCars() { return game.spawnedCars.filter((c) => !c.dead); },
  };
  game.hud = {
    banner(t) { game.bannerText = t; },
    showMissionSplash(s) { game.splash = s; },
    showRaceHUD() {},
    hideRaceHUD() {},
    updateRaceHUD() {},
  };
  game.peds = new PedManager(scene, world);
  game.missions = new MissionManager(game);
  game.taxi = new TaxiManager(game);
  game.collectibles = new CollectibleManager(scene, save);
  return game;
}

// A point is reachable on foot when some point within `radius` of it lies
// outside every collider expanded by the 0.6 m player radius. Sample the
// whole disc (centre + three rings), not just the rim — the safehouse
// door, for example, is 6.6 m from its own centre, inside the 10 m radius
// but nowhere near the rim.
function reachable(world, x, z, radius) {
  const pts = [{ x, z }];
  for (const rr of [radius / 3, (2 * radius) / 3, radius]) {
    for (let a = 0; a < 12; a++) {
      pts.push({ x: x + Math.sin((a / 12) * Math.PI * 2) * rr, z: z + Math.cos((a / 12) * Math.PI * 2) * rr });
    }
  }
  for (const p of pts) {
    let inside = false;
    for (const c of world.colliders) {
      if (p.x > c.minX - 0.6 && p.x < c.maxX + 0.6 && p.z > c.minZ - 0.6 && p.z < c.maxZ + 0.6) { inside = true; break; }
    }
    if (!inside) return true;
  }
  return false;
}
function pointInColliders(world, x, z) {
  return world.colliders.some((c) => x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ);
}
// A point inside a building, ignoring the vendor stalls' own colliders:
// buildCity adds one small collider per stall, so a stall point always
// sits inside its own box — the check that matters is whether a tower
// also covers it.
function pointInBuildings(world, x, z) {
  return world.colliders.some((c) => {
    if (VENDORS.some((v) => c.minX === v.x - 1.7 && c.maxX === v.x + 1.7 && c.minZ === v.z - 0.9 && c.maxZ === v.z + 0.9)) return false;
    return x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ;
  });
}

// ---------------------------------------------------------------------------
// 1. Config data.
// ---------------------------------------------------------------------------
console.log('config:');
test('17 missions in MISSION_META and MISSIONS', () => {
  eq(MISSION_META.length, 17, 'MISSION_META length');
  eq(MISSIONS.length, 17, 'MISSIONS length');
});
test('mission rewards in order', () => {
  const rewards = MISSION_META.map((m) => m.reward);
  eq(JSON.stringify(rewards), JSON.stringify([0, 500, 800, 0, 1500, 600, 900, 1200, 1500, 1800, 2200, 5000, 2600, 3200, 3500, 5000, 4000]), 'rewards');
});
test('race checkpoints: 6, all on road lines, all distinct', () => {
  eq(RACE_CHECKPOINTS.length, 6, 'checkpoint count');
  const lines = new Set(roadLines());
  const seen = new Set();
  for (const cp of RACE_CHECKPOINTS) {
    ok(lines.has(cp.x) || lines.has(cp.z), 'checkpoint (' + cp.x + ',' + cp.z + ') off the road grid');
    const k = cp.x + ',' + cp.z;
    ok(!seen.has(k), 'duplicate checkpoint ' + k);
    seen.add(k);
  }
});
test('taxi tuning constants', () => {
  eq(TAXI.firstOfferDelay, 20, 'firstOfferDelay');
  eq(TAXI.cooldown, 15, 'cooldown');
  eq(TAXI.offerExpiry, 75, 'offerExpiry');
  eq(TAXI.pickupRadius, 12, 'pickupRadius');
  eq(TAXI.destRadius, 10, 'destRadius');
  eq(TAXI.baseFare, 80, 'baseFare');
  eq(TAXI.perMeter, 0.3, 'perMeter');
  eq(TAXI.minTime, 45, 'minTime');
  eq(TAXI.maxTime, 90, 'maxTime');
  eq(TAXI.maxTip, 60, 'maxTip');
});
test('collectibles: 20, unique names, $5000 bonus', () => {
  eq(COLLECTIBLES.length, 20, 'package count');
  eq(COLLECTIBLE_BONUS, 5000, 'bonus');
  const names = new Set(COLLECTIBLES.map((c) => c.name));
  eq(names.size, 20, 'package names unique');
  for (const c of COLLECTIBLES) ok(c.name.length > 0, 'package name empty');
});

// ---------------------------------------------------------------------------
// 2. Save / load.
// ---------------------------------------------------------------------------
console.log('save:');
test('default save shape (v6)', () => {
  const s = defaultSave();
  eq(s.cash, 250, 'cash');
  eq(s.missionIndex, 0, 'missionIndex');
  eq(s.packages.length, 0, 'packages');
  eq(s.stats.faresDone, 0, 'faresDone');
  eq(s.stats.faresEarned, 0, 'faresEarned');
  eq(s.stats.packagesFound, 0, 'packagesFound');
  eq(s.properties.length, 0, 'properties');
  eq(s.stats.bizEarned, 0, 'bizEarned');
  eq(s.stats.sideDone, 0, 'sideDone');
  eq(s.stats.sideEarned, 0, 'sideEarned');
  eq(s.districts.length, 0, 'districts');
  eq(SAVE_VERSION, 6, 'SAVE_VERSION');
});
test('v5 save sanitises to v6 (districts default, bad ids dropped)', () => {
  const v5 = { cash: 500, missionIndex: 3, districts: [1, 1, 9, -1, 'x', 5], stats: { missionsDone: 2 } };
  const s = sanitizeSave(v5);
  eq(JSON.stringify(s.districts), '[1,5]', 'only valid unique ids kept');
  eq(sanitizeSave({}).districts.length, 0, 'a v5 save without districts gets an empty list');
});
test('v4 save sanitises to v5 (side stats default)', () => {
  const v4 = { cash: 500, missionIndex: 3, stats: { missionsDone: 2, bizEarned: 120 } };
  const s = sanitizeSave(v4);
  eq(s.stats.sideDone, 0, 'sideDone defaults');
  eq(s.stats.sideEarned, 0, 'sideEarned defaults');
  eq(s.stats.bizEarned, 120, 'bizEarned kept');
});
test('v2 save sanitises to v3 (packages + fare stats default)', () => {
  const v2 = {
    cash: 4200, missionIndex: 9, weapons: { fists: { owned: true, ammo: Infinity }, pistol: { owned: true, ammo: 12 } },
    currentWeapon: 'pistol', armor: 50, upgrades: { armor: 1, engine: 2, tires: 0 },
    ownedCars: ['furia'], stats: { missionsDone: 9, carsStolen: 4 },
  };
  const s = sanitizeSave(v2);
  eq(s.cash, 4200, 'cash kept');
  eq(s.missionIndex, 9, 'missionIndex kept');
  eq(s.packages.length, 0, 'packages default empty');
  eq(s.stats.faresDone, 0, 'faresDone default');
  eq(s.stats.packagesFound, 0, 'packagesFound default');
  eq(s.stats.missionsDone, 9, 'missionsDone kept');
  eq(s.upgrades.engine, 2, 'upgrades kept');
});
test('package ids sanitised: bad ids dropped, duplicates removed', () => {
  const s = sanitizeSave({ packages: [0, 5, 5, 21, -1, 'x', 19, 3.5], stats: {} });
  eq(JSON.stringify(s.packages), JSON.stringify([0, 5, 19]), 'packages filtered');
  eq(s.stats.packagesFound, 3, 'packagesFound derived from list');
});
test('packagesFound is derived, never trusted from the blob', () => {
  const s = sanitizeSave({ packages: [0, 1, 2], stats: { packagesFound: 99 } });
  eq(s.stats.packagesFound, 3, 'packagesFound');
});
test('loadSave/writeSave round-trip', () => {
  const s = defaultSave();
  s.cash = 1234;
  s.packages = [0, 7];
  s.stats.faresDone = 2;
  writeSave(s);
  const back = loadSave();
  eq(back.cash, 1234, 'cash round-trip');
  eq(JSON.stringify(back.packages), JSON.stringify([0, 7]), 'packages round-trip');
  eq(back.stats.faresDone, 2, 'faresDone round-trip');
});
test('property ids sanitised: bad ids dropped, duplicates removed', () => {
  const s = sanitizeSave({ properties: [3, 5, 5, 0, 99, -1, 'x', 1], stats: {} });
  eq(JSON.stringify(s.properties), JSON.stringify([3, 5, 1]), 'properties filtered');
});
test('owned businesses survive a save round-trip', () => {
  const s = defaultSave();
  s.cash = 5000;
  s.properties = [5, 3];
  s.stats.bizEarned = 120;
  writeSave(s);
  const back = loadSave();
  eq(JSON.stringify(back.properties), JSON.stringify([5, 3]), 'properties round-trip');
  eq(back.stats.bizEarned, 120, 'bizEarned round-trip');
});

// ---------------------------------------------------------------------------
// 2b. Buyable businesses.
// ---------------------------------------------------------------------------
console.log('properties:');
test('PROPERTIES: 3 shops, 3 kinds, spread across the map', () => {
  eq(PROPERTIES.length, 3, '3 for sale');
  const kinds = PROPERTIES.map((p) => SHOPS[p.shop].kind);
  eq(new Set(kinds).size, 3, '3 distinct kinds: ' + kinds.join(','));
  for (const p of PROPERTIES) {
    ok(p.price > 0 && p.income > 0, SHOPS[p.shop].name + ' priced');
    ok(propEntry(p.shop) === p, 'entry lookup');
  }
  eq(propEntry(0), undefined, 'shop 0 not for sale');
  eq(shopIndex({ x: 150, z: -150 }), 3, 'GARAGE 24 index');
});
test('shopRow: BUY button, OWNED tag, empty for other shops', () => {
  const g = fakeGame();
  const props = new PropertiesManager(g);
  const row = props.shopRow({ x: -30, z: 150 });
  ok(row.includes('data-buy="biz"'), 'BUY button');
  ok(row.includes('$2000'), 'price shown');
  eq(props.shopRow({ x: -150, z: -30 }), '', 'non-business shop: no row');
  g.save.cash = 5000;
  props.buy({ x: -30, z: 150 });
  ok(props.shopRow({ x: -30, z: 150 }).includes('OWNED'), 'owned tag after buy');
});
test('buy needs cash: short cash refuses, enough cash buys', () => {
  const g = fakeGame();
  const props = new PropertiesManager(g);
  const taco = { x: -30, z: 150 }; // TACO SOL, shop 5, $2000
  eq(props.buy(taco), false, '250 cash cannot buy $2000');
  eq(g.save.cash, 250, 'cash untouched');
  eq(props.isOwned(5), false, 'not owned');
  eq(props.buy({ x: -150, z: -30 }), false, 'non-business shop cannot be bought');
  g.save.cash = 5000;
  eq(props.buy(taco), true, 'buys with cash');
  eq(g.save.cash, 3000, 'cash after buy');
  eq(props.isOwned(5), true, 'owned');
  eq(props.rate(), 40, 'rate $40/h');
  eq(props.buy(taco), false, 'cannot buy twice');
  eq(g.save.cash, 3000, 'no double charge');
  ok(g.notes.some((n) => n.includes('TACO SOL')), 'buy toast names the shop');
});
test('rent pays once per game hour crossed, seeds first', () => {
  const g = fakeGame();
  g.save.cash = 5000;
  const props = new PropertiesManager(g);
  props.buy({ x: -30, z: 150 }); // TACO SOL $2000, $40/h
  eq(g.save.cash, 3000, 'after buy');
  g.tod = 12 / 24;
  props.update(0.05);
  eq(g.save.cash, 3000, 'first tick seeds, no payout');
  g.tod = 13 / 24;
  props.update(0.05);
  eq(g.save.cash, 3040, '+$40 for one hour');
  eq(g.save.stats.bizEarned, 40, 'bizEarned');
  g.tod = 15 / 24;
  props.update(0.05);
  eq(g.save.cash, 3120, '+$80 for two more hours');
  eq(g.save.stats.bizEarned, 120, 'bizEarned total');
});
test('rent wraps midnight: 23:00 to 01:00 pays 2 hours', () => {
  const g = fakeGame();
  g.save.cash = 10000;
  const props = new PropertiesManager(g);
  props.buy({ x: 150, z: -150 }); // GARAGE 24 $3000, $60/h
  props.buy({ x: 150, z: 30 }); // AMMU-NATION $5000, $90/h
  eq(props.rate(), 150, 'rate $150/h');
  g.tod = 23 / 24;
  props.update(0.05);
  g.tod = 1 / 24;
  props.update(0.05);
  eq(g.save.cash, 2300, '2 hours x $150');
  eq(g.save.stats.bizEarned, 300, 'bizEarned');
});
test('hudLine: empty when nothing owned, BIZ n + rate when owned', () => {
  const g = fakeGame();
  const props = new PropertiesManager(g);
  eq(props.hudLine(), '', 'no businesses');
  g.save.cash = 5000;
  props.buy({ x: -30, z: 150 });
  eq(props.hudLine(), 'BIZ 1 · +$40/h', 'one business');
});

// ---------------------------------------------------------------------------
// 2b. Side activities: rampage, stunt jumps, vigilante, payphone.
// ---------------------------------------------------------------------------
function sideGame() {
  const g = fakeGame();
  g.particles = { burst() {} };
  g.side = new SideManager(g);
  return g;
}
test('side: rampage starts 6 VEX targets, 60 s timer', () => {
  const g = sideGame();
  g.player.pos.set(-180, 0, -180);
  eq(g.side.tryInteract(), true, 'E starts the rampage');
  eq(g.side.job.kind, 'rampage', 'rampage job');
  eq(g.side.job.targets.length, 6, '6 targets');
  eq(g.side.job.timer, 60, '60 s');
  ok(g.side.job.targets.every((t) => t.role === 'gang' && t.armed), 'gang role, armed');
  ok(g.side.job.targets.every((t) => t.gang && t.gang.name === 'VEX BOYS'), 'VEX BOYS');
  eq(g.side.hudLine().slice(0, 11), 'RAMPAGE 0/6', 'HUD line');
});
test('side: rampage kill pays $100, clearing all pays $300 bonus', () => {
  const g = sideGame();
  g.player.pos.set(-180, 0, -180);
  g.side.tryInteract();
  for (const t of g.side.job.targets) t.dead = true;
  g.side.update(0.1);
  eq(g.save.cash, 250 + 600 + 300, '6 kills + bonus');
  eq(g.save.stats.sideEarned, 900, 'sideEarned');
  eq(g.save.stats.sideDone, 1, 'sideDone');
  eq(g.side.job, null, 'job ends');
  ok(g.notes.some((n) => n.includes('Rampage cleared')), 'clear toast');
});
test('side: rampage timeout removes survivors, no bonus', () => {
  const g = sideGame();
  g.player.pos.set(-180, 0, -180);
  g.side.tryInteract();
  const targets = g.side.job.targets;
  targets[0].dead = true;
  targets[1].dead = true;
  g.side.update(59.9);
  eq(g.save.cash, 250 + 200, '2 kills paid, no bonus yet');
  g.side.update(0.2); // timer hits 0
  eq(g.side.job, null, 'job ends on timeout');
  eq(g.save.cash, 450, 'no bonus on timeout');
  ok(!g.peds.peds.some((p) => targets.includes(p)), 'survivors removed');
});
test('side: jump pays by speed tier, hop fires, cooldown blocks retrigger', () => {
  const g = sideGame();
  const car = g.spawnCar('furia', 0xf2c230, -66, 0, Math.PI / 2);
  g.enterCar(car);
  car.speed = 26;
  for (let i = 0; i < 40 && g.save.cash === 250; i++) {
    car.drive(0.05, 1, 0, g.world.colliders);
    g.side.update(0.05);
  }
  eq(g.save.cash, 250 + 300, '26 m/s over the ramp pays $300');
  ok(car.hopT > 0, 'hop launched');
  eq(g.save.stats.sideDone, 1, 'jump counts as done');
  // Still on the ramp, still fast: the 20 s cooldown blocks a second payout.
  car.speed = 31;
  g.side.update(0.1);
  eq(g.save.cash, 550, 'no double payout during cooldown');
});
test('side: jump tiers 31 m/s pays $500, 19 m/s pays $150, under 18 pays nothing', () => {
  for (const [speed, award] of [[31, 500], [19, 150], [10, 0]]) {
    const g = sideGame();
    const car = g.spawnCar('furia', 0xf2c230, -60, 0, Math.PI / 2);
    g.enterCar(car);
    car.speed = speed;
    g.side.update(0.1);
    eq(g.save.cash, 250 + award, speed + ' m/s pays $' + award);
  }
});
test('side: Car.hop raises the mesh and settles', () => {
  const g = fakeGame();
  const car = g.spawnCar('furia', 0xf2c230, 0, 0, 0);
  eq(car.mesh.position.y, 0, 'on the ground');
  car.hop();
  car.drive(0.45, 0, 0, g.world.colliders); // hopT 0.9 -> 0.45
  car.drive(0, 0, 0, g.world.colliders); // sync at the peak: sin(pi/2) = 1
  ok(car.mesh.position.y > 2, 'mesh airborne at peak, y=' + car.mesh.position.y.toFixed(2));
  eq(car.pos.y, 0, 'logical pos stays on the ground');
  for (let i = 0; i < 20; i++) car.drive(0.1, 0, 0, g.world.colliders);
  eq(car.hopT, 0, 'hop ends');
  eq(car.mesh.position.y, 0, 'mesh settles back');
});
test('side: vigilante spawns a target in allCars, wrecking it pays $600', () => {
  const g = sideGame();
  g.player.pos.set(180, 0, -150);
  eq(g.side.tryInteract(), true, 'E takes the tip');
  const car = g.side.vigTarget;
  ok(car && car.kind === 'vigilante', 'target is a vigilante car');
  ok(g.allCars().includes(car), 'target is in allCars (rammable)');
  const x0 = car.pos.x, z0 = car.pos.z;
  g.side.update(0.1);
  ok(car.pos.x !== x0 || car.pos.z !== z0, 'target flees');
  car.damage(200);
  g.side.update(0.1);
  eq(g.save.cash, 250 + 600, '+$600 for the wreck');
  eq(g.side.vigTarget, null, 'target cleared');
  eq(g.side.job, null, 'job ends');
});
test('side: jacking the getaway car blows the job, car becomes traffic', () => {
  const g = sideGame();
  g.player.pos.set(180, 0, -150);
  g.side.tryInteract();
  const car = g.side.vigTarget;
  g.enterCar(car);
  g.side.update(0.1);
  eq(g.side.job, null, 'job blown');
  eq(car.kind, 'traffic', 'car joins traffic');
  ok(g.traffic.cars.includes(car), 'in the traffic list');
  eq(g.save.cash, 250, 'no payout');
});
test('side: payphone job runs Marina pickup to Docks delivery, pays $350', () => {
  const g = sideGame();
  g.player.pos.set(-138, 0, 150);
  eq(g.side.tryInteract(), true, 'E answers the payphone');
  eq(g.side.job.kind, 'phone', 'phone job');
  eq(g.side.hudLine().slice(0, 5), 'PHONE', 'HUD line');
  g.player.pos.set(180, 0, 120);
  g.side.update(0.1);
  eq(g.side.job.step, 1, 'pickup advances the step');
  g.player.pos.set(180, 0, -150);
  g.side.update(0.1);
  eq(g.side.job, null, 'delivery completes the job');
  eq(g.save.cash, 250 + 350, '+$350');
  eq(g.save.stats.sideDone, 1, 'sideDone');
});
test('side: payphone rings near the Safehouse when the line is free', () => {
  const g = sideGame();
  g.player.pos.set(-140, 0, 140);
  g.side.update(0.1);
  ok(g.notes.some((n) => n.includes('ringing')), 'ring toast');
});
test('side: E does nothing far from spots, or from inside a car', () => {
  const g = sideGame();
  eq(g.side.prompt(), null, 'no prompt in the open');
  eq(g.side.tryInteract(), false, 'no job in the open');
  const car = g.spawnCar('furia', 0xf2c230, -180, 0, Math.PI / 2);
  g.player.pos.set(-180, 0, -180);
  g.enterCar(car);
  eq(g.side.tryInteract(), false, 'no E job from inside a car');
  eq(g.side.prompt(), null, 'no prompt from inside a car');
});
test('side: all spots are reachable on foot', () => {
  const g = fakeGame();
  const spots = [
    [-180, -180], [180, -150], [-138, 150], [180, 120],
    [-60, 0], [180, -60], [-120, 120],
  ];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    spots.push([-180 + Math.sin(a) * 14, -180 + Math.cos(a) * 14]);
  }
  for (const [x, z] of spots) ok(reachable(g.world, x, z, 8), 'reachable (' + x + ',' + z + ')');
});

// ---------------------------------------------------------------------------
// 2c. Districts + Club Solmar interior.
// ---------------------------------------------------------------------------
function districtGame() {
  const g = fakeGame();
  g.districts = new DistrictsManager(g);
  return g;
}
test('districts: table has 6 unique ids, names and colours', () => {
  eq(DISTRICTS.length, 6, '6 districts');
  eq(new Set(DISTRICTS.map((d) => d.id)).size, 6, 'unique ids');
  eq(new Set(DISTRICTS.map((d) => d.name)).size, 6, 'unique names');
  for (const d of DISTRICTS) ok(/^#[0-9a-f]{6}$/.test(d.color), 'colour ' + d.name);
});
test('districts: districtAt maps every named place', () => {
  eq(districtAt(200, 60).name, 'MARINA', 'marina');
  eq(districtAt(150, -130).name, 'DOCKS', 'docks');
  eq(districtAt(0, -140).name, 'DOWNTOWN', 'downtown');
  eq(districtAt(-150, -150).name, 'AIRFIELD', 'airfield');
  eq(districtAt(-140, 120).name, 'OLD TOWN', 'old town');
  eq(districtAt(0, 30).name, 'CENTRAL', 'central');
  eq(districtAt(-150, 150).name, 'OLD TOWN', 'safehouse is old town');
  eq(districtAt(180, 150).name, 'MARINA', 'marina hotel');
  eq(districtAt(180, -150).name, 'DOCKS', 'docks corner');
  eq(districtAt(250, 152).name, 'MARINA', 'boat dock is marina');
});
test('districts: spawn is Old Town, gate signs clear every collider, room has 5 colliders', () => {
  const g = districtGame();
  eq(g.districts.current, 5, 'spawn (-140,140) is OLD TOWN');
  eq(g.districts.gateSpots.length, 5, '5 gate signs');
  for (const spot of g.districts.gateSpots) {
    for (const c of g.world.colliders) {
      ok(!(spot.x > c.minX - 3 && spot.x < c.maxX + 3 && spot.z > c.minZ - 3 && spot.z < c.maxZ + 3), 'gate ' + spot.name + ' clears colliders');
    }
  }
  eq(g.districts.roomColliders.length, 5, 'bar + 3 tables + jukebox');
  eq(g.districts.bounds(), null, 'no bounds outside');
});
test('districts: crossing into a new district records it once', () => {
  const g = districtGame();
  eq(g.save.districts.length, 0, 'none visited at spawn');
  g.player.pos.set(200, 0, 60);
  g.districts.update();
  eq(g.districts.current, 1, 'now MARINA');
  eq(g.save.districts.length, 1, 'one visited');
  ok(g.notes.some((n) => n.includes('MARINA')), 'welcome toast');
  eq(g.saved, true, 'save written');
  g.player.pos.set(0, 0, 30);
  g.districts.update();
  eq(g.save.districts.length, 2, 'two visited');
  const notes = g.notes.length;
  g.player.pos.set(200, 0, 60);
  g.districts.update();
  eq(g.save.districts.length, 2, 'no double count');
  eq(g.notes.length, notes, 'no repeat toast');
});
test('districts: E at the casino door enters Club Solmar, E at the room door leaves', () => {
  const g = districtGame();
  g.player.pos.set(0, 0, -163);
  eq(g.districts.prompt(), 'Enter Club Solmar', 'prompt at the door');
  eq(g.districts.tryInteract(), true, 'E enters');
  eq(g.districts.inside, true, 'inside');
  eq(g.player.pos.x, 600, 'teleported to the room');
  eq(g.player.pos.z, 600, 'at the entry spot');
  eq(g.districts.prompt(), null, 'no prompt mid-room');
  eq(g.districts.hudLine(), 'CLUB SOLMAR', 'HUD line inside');
  eq(JSON.stringify(g.districts.mapPlayer(g.player)), JSON.stringify({ x: CLUB.doorX, z: CLUB.doorZ, heading: g.player.heading }), 'minimap shows the door while inside');
  g.player.pos.set(600, 0, 606);
  eq(g.districts.prompt(), 'Leave Club Solmar', 'prompt at the room door');
  eq(g.districts.tryInteract(), true, 'E leaves');
  eq(g.districts.inside, false, 'outside again');
  eq(g.player.pos.x, 0, 'back at the casino door');
  eq(g.player.pos.z, -163, 'same spot');
});
test('districts: entry blocked during a mission, a side job, a fare, a cutscene, or in a car', () => {
  const g = districtGame();
  g.player.pos.set(0, 0, -163);
  g.missions = { state: 'active' };
  eq(g.districts.tryInteract(), false, 'mission active blocks');
  g.missions = { state: 'idle' };
  g.side = { job: { kind: 'rampage' } };
  eq(g.districts.tryInteract(), false, 'side job blocks');
  g.side = null;
  g.taxi = { fare: { timer: 30 } };
  eq(g.districts.tryInteract(), false, 'fare blocks');
  g.taxi = null;
  g.cutscenes = { active: true };
  eq(g.districts.tryInteract(), false, 'cutscene blocks');
  g.cutscenes = { active: false };
  g.player.inCar = { speed: 0 };
  eq(g.districts.tryInteract(), false, 'in a car blocks');
  g.player.inCar = null;
  eq(g.districts.tryInteract(), true, 'clear to enter');
});
test('districts: Player updateOnFoot clamps to the room bounds when inside, city bounds outside', () => {
  const g = districtGame();
  const p = new Player(fakeScene(), 0, 0);
  p.pos.set(608, 0, 600);
  p.updateOnFoot(1, { x: 1, z: 0 }, true, [], ROOM);
  eq(p.pos.x, 611, 'east wall holds');
  p.pos.set(600, 0, 604);
  p.updateOnFoot(1, { x: 0, z: 1 }, true, [], ROOM);
  eq(p.pos.z, 607, 'south wall holds');
  p.pos.set(592, 0, 596);
  p.updateOnFoot(1, { x: -1, z: -1 }, true, [], ROOM);
  ok(p.pos.x >= 589 && p.pos.z >= 593, 'west + north walls hold');
  p.pos.set(259, 0, 0);
  p.updateOnFoot(1, { x: 1, z: 0 }, true, [], null);
  eq(p.pos.x, 260, 'city edge still clamps without bounds');
});
test('districts: HUD line names the district and the visit count', () => {
  const g = districtGame();
  eq(g.districts.hudLine(), 'OLD TOWN · 0/6', 'spawn line');
  g.player.pos.set(200, 0, 60);
  g.districts.update();
  eq(g.districts.hudLine(), 'MARINA · 1/6', 'marina line');
});
test('HUD: district line shows in the mods row', () => {
  const hud = new HUD(buildCity(fakeScene()));
  hud.update(0.016, hudState({ district: 'MARINA · 1/6' }));
  ok(document.getElementById('mods').textContent.includes('MARINA · 1/6'), 'district in mods');
});

// ---------------------------------------------------------------------------
// 3. Geometry: every mission step, race checkpoint and package is reachable
//    in the real city (built from the same seed as the game).
// ---------------------------------------------------------------------------
console.log('geometry:');
test('all 20 packages sit outside building colliders', () => {
  const g = fakeGame();
  for (let i = 0; i < COLLECTIBLES.length; i++) {
    const c = COLLECTIBLES[i];
    ok(!pointInColliders(g.world, c.x, c.z), 'package ' + i + ' (' + c.name + ') inside a building');
  }
});
test('all 20 packages are reachable on foot (2.4 m take radius)', () => {
  const g = fakeGame();
  for (let i = 0; i < COLLECTIBLES.length; i++) {
    const c = COLLECTIBLES[i];
    ok(reachable(g.world, c.x, c.z, 2.4), 'package ' + i + ' (' + c.name + ') unreachable');
  }
});
test('every mission step target is reachable', () => {
  const g = fakeGame();
  for (let mi = 0; mi < MISSIONS.length; mi++) {
    for (let si = 0; si < MISSIONS[mi].steps.length; si++) {
      const st = MISSIONS[mi].steps[si];
      if (st.type === 'steal') {
        // The car spawns at (x,z); its first drive shoves it out of any
        // collider to the nearest face, and the player steals the car
        // where it lands. Check the shoved-out spot, not the spawn point.
        const car = new Car(st.defKey, st.color, st.x, st.z, 0);
        resolveCircleCollisions(g.world.colliders, car.pos, 1.9);
        ok(reachable(g.world, car.pos.x, car.pos.z, 2.4),
          'mission ' + (mi + 1) + ' steal car shoved to an unreachable spot (' + car.pos.x.toFixed(1) + ',' + car.pos.z.toFixed(1) + ')');
        continue;
      }
      if (st.type === 'race') {
        // Start line + both rival slots sit on the road, clear of towers.
        ok(reachable(g.world, st.startX, st.startZ, 2.4), 'mission ' + (mi + 1) + ' race start line blocked');
        ok(reachable(g.world, st.startX, st.startZ - 10, 2.4), 'mission ' + (mi + 1) + ' rival slot 1 blocked');
        ok(reachable(g.world, st.startX, st.startZ - 25, 2.4), 'mission ' + (mi + 1) + ' rival slot 2 blocked');
        continue;
      }
      if (st.x === undefined) continue; // kill/evade steps have no fixed point
      const r = st.radius || 10;
      ok(reachable(g.world, st.x, st.z, r), 'mission ' + (mi + 1) + ' step ' + si + ' (' + st.type + ' at ' + st.x + ',' + st.z + ' r=' + r + ') unreachable');
    }
  }
});
test('Mission 8 casino steps: reachable from the tower faces (v3 fix)', () => {
  const g = fakeGame();
  // The casino tower occupies x -17..17, z -193..-167. The closest a
  // player can stand is the south face at z=-166.4, 13.6 m from centre.
  ok(reachable(g.world, 0, -180, 18), 'goto radius 18 reachable');
  ok(reachable(g.world, 0, -180, 16), 'collect radius 16 reachable');
  ok(!reachable(g.world, 0, -180, 10), 'old goto radius 10 was unreachable (sanity)');
  ok(!reachable(g.world, 0, -180, 5), 'old collect radius 5 was unreachable (sanity)');
  near(dist2(0, -166.4, 0, -180), 13.6, 0.01, 'south-face distance');
});
test('race checkpoints reachable (8 m radius)', () => {
  const g = fakeGame();
  for (const cp of RACE_CHECKPOINTS) {
    ok(reachable(g.world, cp.x, cp.z, 8), 'checkpoint (' + cp.x + ',' + cp.z + ') unreachable');
  }
});
test('world pickups: 6, with a free pistol by the safehouse and a shotgun at the docks', () => {
  eq(PICKUPS.length, 6, 'pickup count');
  const guns = PICKUPS.filter((p) => p.kind === 'weapon');
  eq(guns.length, 2, 'weapon pickups');
  eq(guns[0].weapon, 'pistol', 'pistol by the safehouse');
  eq(guns[1].weapon, 'shotgun', 'shotgun at the docks');
  const g = fakeGame();
  ok(reachable(g.world, guns[0].x, guns[0].z, 2.4), 'pistol reachable on foot');
  ok(reachable(g.world, guns[1].x, guns[1].z, 2.4), 'shotgun reachable on foot');
});

// ---------------------------------------------------------------------------
// Boats + M17 Harbor Run.
// ---------------------------------------------------------------------------
console.log('boats:');
test('Boat: hull + cabin mesh, no AI, floats on the sea plane', () => {
  const b = new Boat(0xc94f43, 256, 152, Math.PI / 2);
  eq(b.kind, 'boat', 'kind');
  ok(b.isBoat, 'isBoat');
  eq(b.ai, null, 'no AI driver ever');
  eq(b.pos.y, 0.1, 'floats on the sea plane');
  eq(b.topSpeed, 24, 'top speed 24 m/s');
  eq(b.eff.topSpeed, 24, 'eff.topSpeed for the HUD/engine hum');
  ok(b.mesh.children.length >= 5, 'hull + bow + cabin + glass + motor');
  ok(!b.mesh.children.some((m) => m.castShadow), 'no shadow-casting mesh');
});
test('Boat.drive: throttle + steer, water drag, bay bounds clamp', () => {
  const b = new Boat(0xc94f43, 300, 0, 0);
  b.drive(1, 1, 0, []);
  ok(b.speed > 0 && b.speed <= 24, 'throttle builds speed');
  const h0 = b.heading;
  b.drive(0.5, 1, 1, []);
  ok(b.heading < h0, 'steer right turns right');
  b.drive(1, 0, 0, []);
  ok(b.speed < 24, 'water drag bleeds speed off throttle');
  const edge = new Boat(0xc94f43, 599, 0, Math.PI / 2); // bow east, at the edge
  edge.drive(2, 1, 0, []);
  ok(edge.pos.x <= BOAT_BOUNDS.maxX, 'clamped to the bay, cannot leave the water');
  const beach = new Boat(0xc94f43, 256, 152, -Math.PI / 2); // bow west, at the dock
  beach.drive(2, 1, 0, []);
  ok(beach.pos.x >= BOAT_BOUNDS.minX, 'clamped off the beach, cannot land');
});
test('Boat.drive: pier and bridge are no-go for the hull', () => {
  const b = new Boat(0xc94f43, 290, -40, 0);
  b.drive(0.1, 0, 0, []);
  ok(!(b.pos.x > 250 && b.pos.x < 298 && b.pos.z > -45 && b.pos.z < -35), 'hull shoved out of the pier rect');
});
test('BOAT_DOCKS: 3 boats moored at the marina, docks on land, boardable', () => {
  eq(BOAT_DOCKS.length, 3, '3 boats');
  for (const d of BOAT_DOCKS) {
    ok(d.x >= BOAT_BOUNDS.minX && d.x <= BOAT_BOUNDS.maxX, 'mooring inside the bay bounds');
    ok(d.dockX < 252, 'dock point on land (west of the wet sand)');
    ok(dist2(d.dockX, d.z, d.x, d.z) < 8.4, 'boat within board reach of its dock');
  }
});
test('M17 Harbor Run: 4 water checkpoints, 120 s, $4000', () => {
  const m = MISSIONS[16];
  eq(m.id, 17, 'id 17');
  eq(m.steps.length, 4, '4 steps');
  eq(m.steps[1].type, 'boat_board', 'step 2 boards a boat');
  const del = m.steps[2];
  eq(del.type, 'boat_delivery', 'step 3 is the delivery');
  eq(del.timeLimit, 120, '120 s');
  eq(del.checkpoints.length, 4, '4 checkpoints');
  for (const cp of del.checkpoints) {
    ok(cp.x >= BOAT_BOUNDS.minX && cp.x <= BOAT_BOUNDS.maxX && cp.z >= BOAT_BOUNDS.minZ && cp.z <= BOAT_BOUNDS.maxZ, 'checkpoint (' + cp.x + ',' + cp.z + ') in open water');
  }
  eq(MISSION_META[16].reward, 4000, 'reward $4000');
});
test('M17 flow: dock → board → 4 checkpoints → return → $4000', () => {
  const g = fakeGame();
  ok(g.missions.startMission(16), 'M17 starts');
  g.player.pos.set(250, 0, 152);
  g.missions.update(0.1);
  eq(g.missions.stepIndex, 1, 'goto dock advances');
  const boat = new Boat(0xc94f43, 256, 152, Math.PI / 2);
  g.enterCar(boat);
  g.missions.update(0.1);
  eq(g.missions.stepIndex, 2, 'boarding advances');
  const del = MISSIONS[16].steps[2];
  for (const cp of del.checkpoints) {
    boat.pos.set(cp.x, 0.1, cp.z);
    g.player.pos.copy(boat.pos);
    g.missions.update(0.1);
  }
  eq(g.missions.stepIndex, 3, 'all checkpoints advance');
  boat.pos.set(256, 0.1, 152);
  g.player.pos.copy(boat.pos);
  g.missions.update(0.1);
  // M17 is the last mission, so completing it ends the story ('idle'),
  // not 'done' — the reward and missionIndex still land.
  eq(g.missions.state, 'idle', 'story complete after the last mission');
  eq(g.save.cash, 250 + 4000, 'reward $4000 paid');
  eq(g.save.missionIndex, 17, 'missionIndex 17');
});
test('M17: fail during the intro cannot crash and pays nothing (CR-2)', () => {
  const g = fakeGame();
  let held = null;
  g.cutscenes.playMissionIntro = (_n, _b, cb) => { held = cb; };
  ok(g.missions.startMission(16), 'M17 starts');
  g.missions.fail('Out of time');
  eq(g.missions.state, 'failed', 'failed during intro');
  eq(g.save.cash, 250, 'no reward for a mission that never started');
  held(); // the intro callback fires late, after the fail
  eq(g.save.cash, 250, 'late intro pays nothing');
  eq(g.missions.state, 'failed', 'late intro does not revive the mission');
});
test('saveCityState never saves a boat as the car (no CAR_DEFS crash)', () => {
  const g = fakeGame();
  const boat = new Boat(0xc94f43, 256, 152, Math.PI / 2);
  g.enterCar(boat);
  const s = g.missions.saveCityState();
  eq(s.player.inCar, null, 'boat not saved as a car');
});

// ---------------------------------------------------------------------------
// 3b. Radio personality + story dialogue.
// ---------------------------------------------------------------------------
console.log('radio:');
// A fake WebAudio context: enough for tone/noise/jingle to run in node.
function fakeAudioCtx() {
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
  const node = () => ({ connect() {}, start() {}, stop() {}, frequency: param(), gain: param(), type: '' });
  return {
    currentTime: 0, sampleRate: 44100, destination: {},
    createGain: () => ({ gain: param(), connect() {} }),
    createOscillator: node,
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => ({ connect() {}, start() {}, buffer: null }),
    createBiquadFilter: () => ({ type: '', frequency: param(), connect() {} }),
  };
}
function liveRadio() {
  const a = new AudioEngine();
  a.ctx = fakeAudioCtx();
  a.master = a.ctx.createGain();
  a.radioGain = a.ctx.createGain();
  a.started = true;
  a.nextStepTime = 0;
  return a;
}
// Drive the sequencer forward in small time steps so bars end one at a time.
function driveBars(a, bars) {
  let guard = 0;
  while (a.loopCount < bars && guard++ < 4000) {
    a.ctx.currentTime += 0.4;
    a.update();
  }
  return a.loopCount;
}
test('5 stations, one DJ per station, talk station is a bed only', () => {
  eq(RADIO_STATIONS.length, 5, '5 stations');
  eq(RADIO_DJS.length, 5, '5 DJs');
  eq(RADIO_STATIONS[4].name, 'TALK BRISA', 'station 5 is TALK BRISA');
  ok(RADIO_STATIONS[4].talk, 'talk station flagged');
  for (let i = 0; i < 5; i++) {
    ok(RADIO_DJS[i].lines.length >= 3, 'DJ ' + i + ' has 3+ lines');
    for (const l of RADIO_DJS[i].lines) ok(l.length > 0 && l.length <= 90, 'line fits the flash: ' + l);
  }
  eq(RADIO_ADS.length, 4, '4 fake ads');
  for (const ad of RADIO_ADS) ok(ad.startsWith('AD: '), 'ad prefixed: ' + ad);
});
test('DJ line rotates per bar and an ad runs every 4th bar', () => {
  const a = liveRadio();
  eq(a.radioLine().indexOf('MARINA'), 0, 'first line is MARINA');
  eq(driveBars(a, 3), 3, '3 bars driven');
  ok(a.line.indexOf('MARINA') === 0, 'still MARINA after 3 bars');
  driveBars(a, 4);
  ok(a.line.indexOf('AD: ') === 0, 'ad line on the 4th bar: ' + a.line);
  driveBars(a, 9);
  ok(a.line.indexOf('MARINA') === 0, 'DJ resumes after the ad: ' + a.line);
});
test('radio off hides the line; station switch reseeds it; talk bed runs', () => {
  const a = liveRadio();
  a.setRadioOn(false);
  eq(a.radioLine(), '', 'line hidden when radio off');
  a.setRadioOn(true);
  a.setStation(4);
  ok(a.radioLine().indexOf('OCE') === 0 || a.radioLine().indexOf('CALLER') === 0, 'talk segment: ' + a.radioLine());
  eq(driveBars(a, 6), 6, 'talk station bars run without throwing');
  a.setStation(5);
  eq(a.station, 0, 'station wraps 5 -> 0');
  a.setStation(-1);
  eq(a.station, 4, 'station wraps -1 -> 4');
  ok(a.radioLine().indexOf('OCE') === 0 || a.radioLine().indexOf('CALLER') === 0, 'reseeded to talk line');
});
test('mission dialogue: 17 missions, intro + outro, known cast', () => {
  eq(MISSION_DIALOGUE.length, 17, 'dialogue for all 17 missions');
  const cast = ['JAY', 'MIKO', 'RO', 'VANE', 'LENA', 'SARGE'];
  for (let i = 0; i < 17; i++) {
    const d = MISSION_DIALOGUE[i];
    ok(d.intro.length >= 1 && d.intro.length <= 2, 'M' + (i + 1) + ' intro 1-2 lines');
    ok(d.outro.length >= 1, 'M' + (i + 1) + ' outro 1+ lines');
    for (const [who, line] of [...d.intro, ...d.outro]) {
      ok(cast.includes(who), 'M' + (i + 1) + ' speaker ' + who + ' in cast');
      ok(line.length > 0 && line.length <= 80, 'M' + (i + 1) + ' line fits: ' + line);
    }
  }
});
test('dialogue lines reach the cutscene on intro and outro', () => {
  const g = fakeGame();
  let introLines = null;
  let outroLines = null;
  g.cutscenes.playMissionIntro = (_n, _b, cb, lines) => { introLines = lines; if (cb) cb(); };
  g.cutscenes.playMissionOutro = (_n, _r, cb, lines) => { outroLines = lines; if (cb) cb(); };
  ok(g.missions.startMission(0), 'M1 starts');
  eq(JSON.stringify(introLines), JSON.stringify(MISSION_DIALOGUE[0].intro), 'intro lines passed');
  g.missions.complete();
  eq(JSON.stringify(outroLines), JSON.stringify(MISSION_DIALOGUE[0].outro), 'outro lines passed');
});

// ---------------------------------------------------------------------------
// 4. Taxi fares.
// ---------------------------------------------------------------------------
console.log('taxi:');
test('offer appears after the first-offer delay, with passenger + beacon', () => {
  const g = fakeGame();
  eq(g.taxi.state, 'idle', 'starts idle');
  g.taxi.update(10);
  eq(g.taxi.state, 'idle', 'no offer at 10s');
  g.taxi.update(11);
  eq(g.taxi.state, 'offer', 'offer at 21s');
  ok(g.taxi.offer && typeof g.taxi.offer.x === 'number', 'offer has a spot');
  ok(g.taxi.offer.name.length > 0, 'offer has a name');
  ok(g.taxi.passenger !== null, 'passenger mesh built');
  ok(g.taxi.beacon !== null, 'beacon built');
  const blip = g.taxi.minimapBlip();
  eq(blip.x, g.taxi.offer.x, 'minimap blip x');
  eq(blip.z, g.taxi.offer.z, 'minimap blip z');
  ok(g.taxi.objectiveText().includes('TAXI'), 'objective shows TAXI');
});
test('pickup needs a car: on foot it fails, in a car it succeeds', () => {
  const g = fakeGame();
  g.taxi.stageOffer({ x: 0, z: 0, name: 'the Plaza' });
  g.player.pos.set(0, 0, 0);
  eq(g.taxi.tryPickup(), false, 'on foot: no pickup');
  const car = g.spawnCar('taxi', 0xf2a007, 0, 0, 0);
  g.player.inCar = car;
  eq(g.taxi.tryPickup(), true, 'in car: pickup');
  eq(g.taxi.state, 'riding', 'riding after pickup');
  ok(g.taxi.fare !== null, 'fare set');
  ok(g.taxi.fare.dest && typeof g.taxi.fare.dest.x === 'number', 'fare has a destination');
  ok(g.taxi.fare.fare >= 80, 'fare at least base fare');
  ok(g.taxi.fare.timer >= 45 && g.taxi.fare.timer <= 90, 'fare timer clamped 45..90');
  ok(g.taxi.passenger === null, 'passenger got in the car');
});
test('pickup only within 12 m', () => {
  const g = fakeGame();
  g.taxi.stageOffer({ x: 0, z: 0, name: 'the Plaza' });
  const car = g.spawnCar('taxi', 0xf2a007, 0, 30, 0);
  g.player.inCar = car;
  g.player.pos.set(0, 0, 30);
  eq(g.taxi.tryPickup(), false, '30 m away: no pickup');
  g.player.pos.set(0, 0, 11);
  eq(g.taxi.tryPickup(), true, '11 m away: pickup');
});
test('fare math: 120 m trip pays $115, timer 45 s', () => {
  const g = fakeGame();
  g.taxi.stageRide({ x: 0, z: 0, name: 'the Plaza' }, { x: 120, z: 0, name: 'the Beachfront' }, 60);
  eq(g.taxi.fare.fare, 115, 'fare = 80 + round(120*0.3/5)*5');
  eq(g.taxi.fare.timer, 60, 'staged timer kept');
  eq(g.taxi.state, 'riding', 'riding');
});
test('delivery pays fare + speed tip and records stats', () => {
  const g = fakeGame();
  const before = g.save.cash;
  g.taxi.stageRide({ x: 0, z: 0 }, { x: 120, z: 0 }, 60);
  const fare = g.taxi.fare.fare; // 115
  const car = g.spawnCar('taxi', 0xf2a007, 120, 0, 0);
  g.player.inCar = car;
  g.player.pos.set(120, 0, 0);
  g.taxi.update(0.05); // delivers (inside 10 m of dest)
  eq(g.taxi.state, 'idle', 'idle after delivery');
  eq(g.save.stats.faresDone, 1, 'faresDone');
  // Tip = seconds left on the timer, capped at 60: ~60 left, so tip 60.
  eq(g.save.cash, before + fare + 60, 'cash = fare + tip');
  eq(g.save.stats.faresEarned, fare + 60, 'faresEarned');
  ok(g.taxi.minimapBlip() === null, 'no blip when idle');
});
test('slow delivery: timer expiry fails the fare', () => {
  const g = fakeGame();
  g.taxi.stageRide({ x: 0, z: 0 }, { x: 120, z: 0 }, 5);
  g.taxi.update(3);
  eq(g.taxi.state, 'riding', 'still riding at 3s');
  g.taxi.update(3);
  eq(g.taxi.state, 'idle', 'failed at 6s');
  eq(g.taxi.fare, null, 'fare cleared');
  eq(g.save.stats.faresDone, 0, 'no fare recorded');
});
test('unclaimed offer expires after 75 s', () => {
  const g = fakeGame();
  g.taxi.stageOffer({ x: 0, z: 0 });
  for (let i = 0; i < 8; i++) g.taxi.update(10);
  eq(g.taxi.state, 'idle', 'offer expired');
  eq(g.taxi.offer, null, 'offer cleared');
  ok(g.notes.some((n) => n.includes('another cab')), 'expiry toast shown');
});
test('no fares during a mission (meter pauses)', () => {
  const g = fakeGame();
  g.missions.startMission(0);
  eq(g.missions.state, 'active', 'mission active');
  g.taxi.update(60);
  eq(g.taxi.state, 'idle', 'no offer during a mission');
  eq(g.taxi.offerTimer, TAXI.firstOfferDelay, 'offer timer frozen');
});
test('randomSpot never returns a 0 m fare (200 trials)', () => {
  const g = fakeGame();
  let min = Infinity;
  for (let i = 0; i < 200; i++) {
    g.player.pos.set((Math.random() - 0.5) * 300, 0, (Math.random() - 0.5) * 300);
    const s = g.taxi.randomSpot(120);
    min = Math.min(min, dist2(g.player.pos.x, g.player.pos.z, s.x, s.z));
  }
  ok(min > 60, 'closest random spot in 200 trials was ' + min.toFixed(1) + ' m (want > 60)');
});

// ---------------------------------------------------------------------------
// 5. Collectible packages.
// ---------------------------------------------------------------------------
console.log('collectibles:');
test('20 packages start active and visible', () => {
  const g = fakeGame();
  eq(g.collectibles.items.length, 20, 'item count');
  ok(g.collectibles.items.every((i) => i.active), 'all active');
  ok(g.collectibles.items.every((i) => i.group.visible), 'all visible');
  eq(g.collectibles.count(), 0, 'count 0');
});
test('walking over a package collects it and saves', () => {
  const g = fakeGame();
  const first = g.collectibles.items[0];
  g.player.pos.set(first.x, 0, first.z);
  g.collectibles.update(0.05, g.player.pos, g);
  eq(g.collectibles.count(), 1, 'count 1');
  eq(g.save.packages.length, 1, 'save has 1');
  eq(g.save.packages[0], first.id, 'right id saved');
  eq(g.save.stats.packagesFound, 1, 'packagesFound 1');
  ok(!first.active && !first.group.visible, 'package hidden after take');
  ok(g.saved, 'writeSave called');
});
test('all 20 pay the $5000 bonus exactly once', () => {
  const g = fakeGame();
  const before = g.save.cash;
  for (const item of [...g.collectibles.items]) {
    g.player.pos.set(item.x, 0, item.z);
    g.collectibles.update(0.05, g.player.pos, g);
  }
  eq(g.collectibles.count(), 20, 'all 20 found');
  eq(g.save.cash, before + COLLECTIBLE_BONUS, 'bonus paid');
  eq(g.save.stats.packagesFound, 20, 'packagesFound 20');
  // A second pass over the same spots pays nothing more.
  for (const item of g.collectibles.items) {
    g.player.pos.set(item.x, 0, item.z);
    g.collectibles.update(0.05, g.player.pos, g);
  }
  eq(g.save.cash, before + COLLECTIBLE_BONUS, 'bonus paid once');
});
test('already-found packages stay hidden on load', () => {
  const g = fakeGame();
  g.save.packages = [0, 7, 19];
  const g2 = fakeGame();
  g2.save.packages = [0, 7, 19];
  // Rebuild the manager against the loaded save.
  g2.collectibles = new CollectibleManager(g2.scene, g2.save);
  ok(!g2.collectibles.items[0].active, 'package 0 hidden');
  ok(!g2.collectibles.items[7].active, 'package 7 hidden');
  ok(!g2.collectibles.items[19].active, 'package 19 hidden');
  ok(g2.collectibles.items[1].active, 'package 1 still active');
});
test('reset() re-points at a new save and restores all parcels', () => {
  const g = fakeGame();
  const first = g.collectibles.items[0];
  g.player.pos.set(first.x, 0, first.z);
  g.collectibles.update(0.05, g.player.pos, g);
  eq(g.collectibles.count(), 1, 'one found');
  const fresh = defaultSave();
  g.collectibles.reset(fresh);
  ok(g.collectibles.items.every((i) => i.active), 'all active again');
  eq(g.collectibles.count(), 0, 'count reads the new save');
});

// ---------------------------------------------------------------------------
// 6. Missions 11 + 12, driven for real in simulated time.
// ---------------------------------------------------------------------------
console.log('missions:');
// Steer a car at a target with the same maths as raceDrive, at full pace
// with corner braking — i.e. how a skilled player drives the route.
// nx,nz is the checkpoint after the target: when the next leg turns
// sharply, brake while approaching so the car can make the turn on the
// road instead of ploughing into the block beyond the corner.
function driveAt(car, tx, tz, dt, colliders, nx, nz) {
  const dx = tx - car.pos.x, dz = tz - car.pos.z;
  const dist = Math.hypot(dx, dz);
  const targetHeading = Math.atan2(dx, dz);
  const turn = angleDiff(car.heading, targetHeading);
  const steer = clamp(-turn * 1.6, -1, 1);
  let throttle = Math.abs(turn) > 0.5 ? 0.3 : 1;
  if (nx !== undefined) {
    const corner = Math.abs(angleDiff(targetHeading, Math.atan2(nx - tx, nz - tz)));
    if (corner > 0.6 && dist < 80) throttle = Math.min(throttle, 0.25);
  }
  car.drive(dt, throttle, steer, colliders);
}
test('Mission 2 (First Test): race starts at GO, 5 rivals, one Furia, single spawn', () => {
  const g = fakeGame();
  ok(g.missions.startMission(1), 'startMission(1)');
  eq(g.missions.state, 'race_mode', 'race_mode after intro + countdown');
  eq(g.missions.stepIndex, 1, 'race step begins');
  eq(g.missions.currentStep.type, 'race_circuit', 'step type race_circuit');
  eq(g.missions.racers.length, 5, 'five rivals');
  eq(g.missions.targetCar.defKey, 'furia', 'mission Furia spawned');
  eq(g.missions.timer, 180, 'race timer 180 s');
  eq(g.missions.raceMode, true, 'raceMode set');
  ok(g.missions.markerPos !== null, 'checkpoint beacon placed');
  eq(g.player.inCar, g.missions.targetCar, 'player sits in the Furia');
  // One spawn only: 1 Furia + 5 rivals, not a doubled grid.
  eq(g.spawnedCars.length, 6, 'six cars on the grid (spawned ' + g.spawnedCars.length + ')');
});
test('Mission 2: player can win the circuit', () => {
  const g = fakeGame();
  g.missions.startMission(1);
  const car = g.missions.targetCar;
  const dt = 1 / 60;
  let t = 0;
  let won = false;
  while (t < 180 && !won) {
    if (g.missions.state !== 'race_mode') { won = g.missions.state === 'done'; break; }
    const cps = g.missions.raceTrack.checkpoints;
    const cp = cps[g.missions.raceIndex];
    if (!cp) break;
    const next = cps[(g.missions.raceIndex + 1) % cps.length];
    // g.world.colliders is the race map's set here: enterRaceMap parks
    // the city colliders (open ground, no buildings — the Marina hotel
    // sits on the circuit's checkpoint 7 in city coords, so driving
    // with the city set would pin the car on a phantom hotel).
    driveAt(car, cp.x, cp.z, dt, g.world.colliders, next.x, next.z);
    g.player.pos.copy(car.pos);
    g.missions.update(dt);
    t += dt;
  }
  ok(won, 'race won in ' + t.toFixed(1) + ' s of sim time (state ' + g.missions.state + ')');
  eq(g.missions.state, 'done', 'mission done');
  eq(g.save.missionIndex, 2, 'missionIndex 2');
  eq(g.save.cash, 250 + 500, 'reward $500 paid');
});
test('Mission 2: an idle player loses to the rivals', () => {
  const g = fakeGame();
  g.missions.startMission(1);
  eq(g.missions.state, 'race_mode', 'race running');
  // Rio never moves. The rivals drive the route themselves.
  const dt = 1 / 60;
  let t = 0;
  while (t < 180 && g.missions.state === 'race_mode') {
    g.missions.update(dt);
    t += dt;
  }
  eq(g.missions.state, 'failed', 'race failed (state ' + g.missions.state + ' after ' + t.toFixed(1) + ' s)');
  ok(g.missions.failReason.includes('beat you') || g.missions.failReason.includes('Out of time'), 'fail reason: ' + g.missions.failReason);
  eq(g.missions.raceMode, false, 'race map exited on failure');
  eq(g.save.missionIndex, 0, 'missionIndex unchanged on failure');
});
test('Mission 2: rivals actually progress around the route', () => {
  const g = fakeGame();
  g.missions.startMission(1);
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 30; i++) g.missions.update(dt); // 30 s
  const progressed = g.missions.racers.some((r) => r.raceIndex > 0 || r.raceLap > 1);
  ok(progressed, 'at least one rival passed a checkpoint in 30 s');
});
test('Mission 11 (Harbor Lights): steal the Caminar, deliver to the airfield', () => {
  const g = fakeGame();
  ok(g.missions.startMission(10), 'startMission(10)');
  eq(g.missions.state, 'active', 'active');
  eq(g.missions.currentStep.type, 'steal', 'steal step');
  const truck = g.missions.targetCar;
  eq(truck.defKey, 'caminar', 'steal target is a Caminar');
  ok(!pointInColliders(g.world, truck.pos.x, truck.pos.z), 'Caminar is not inside a building');
  g.player.inCar = truck;
  g.missions.update(0.05);
  eq(g.missions.stepIndex, 1, 'delivery step');
  eq(g.missions.currentStep.type, 'driveTo', 'driveTo the airfield');
  eq(g.save.stats.carsStolen, 1, 'carsStolen counted');
  eq(g.wanted, 2, 'delivery runs at 2 stars');
  g.player.pos.set(-180, 0, -180);
  g.missions.update(0.05);
  eq(g.missions.state, 'done', 'mission done');
  eq(g.save.missionIndex, 11, 'missionIndex 11');
  eq(g.save.cash, 250 + 2200, 'reward $2200 paid');
  eq(g.wanted, 0, 'wanted cleared on complete');
});
test('Mission 12 (The Last Job): casino vault, five-star escape home', () => {
  const g = fakeGame();
  ok(g.missions.startMission(11), 'startMission(11)');
  // Step 0: get inside the Solmar Casino.
  g.player.pos.set(0, 0, -180);
  g.missions.update(0.05);
  eq(g.missions.stepIndex, 1, 'vault step');
  eq(g.missions.currentStep.type, 'collect', 'collect the vault');
  // Step 1: empty the vault (already standing on it).
  g.missions.update(0.05);
  eq(g.missions.stepIndex, 2, 'escape step');
  eq(g.missions.currentStep.type, 'driveTo', 'drive home');
  eq(g.missions.currentStep.wanted, 5, 'escape is 5 stars');
  eq(g.wanted, 5, 'wanted set to 5');
  // Step 2: reach the safehouse.
  g.player.pos.set(-150, 0, 150);
  g.missions.update(0.05);
  // Not the finale any more (16 missions): state 'done', story continues.
  eq(g.missions.state, 'done', 'job done — state done');
  eq(g.save.missionIndex, 12, 'missionIndex 12');
  eq(g.save.cash, 250 + 5000, 'reward $5000 paid');
  eq(g.wanted, 0, 'wanted cleared on complete');
  ok(g.missions.objectiveText().includes('Mission complete - The Last Job'), 'complete line: ' + g.missions.objectiveText());
});
test('mission 13 + 14 still start (regression)', () => {
  const g = fakeGame();
  ok(g.missions.startMission(12), 'Sunset Run starts');
  eq(g.missions.meta.name, 'Sunset Run', 'name');
  ok(g.missions.startMission(13), 'Lose the Tail starts');
  eq(g.missions.meta.name, 'Lose the Tail', 'name');
  ok(g.missions.tail !== null, 'tail spawned');
});

// ---------------------------------------------------------------------------
// 7. v4 config: bikes, buses, stops, vendors, parked cars, birds.
// ---------------------------------------------------------------------------
console.log('v4 config:');
test('CAR_DEFS: moto + bus with sane tuning', () => {
  ok(CAR_DEFS.moto, 'moto def exists');
  ok(CAR_DEFS.bus, 'bus def exists');
  ok(CAR_DEFS.moto.topSpeed > CAR_DEFS.brisa.topSpeed, 'moto faster than a sedan');
  ok(CAR_DEFS.bus.topSpeed < CAR_DEFS.carguero.topSpeed, 'bus slower than a van');
  ok(CAR_DEFS.moto.handling > 0.8, 'moto handling');
  ok(CAR_DEFS.bus.handling < 0.4, 'bus handling');
  eq(CAR_DEFS.moto.colors.length, 3, 'moto colours');
  eq(CAR_DEFS.bus.colors.length, 3, 'bus colours');
});
test('moto mesh: narrow frame, 2 wheels, 1 taillight', () => {
  const m = makeCarMesh('moto', 0xd21f2b);
  eq(m.userData.length, 2.2, 'bike length');
  eq(m.userData.wheels.length, 2, 'bike wheels');
  eq(m.userData.tailMats.length, 1, 'bike taillights');
});
test('bus mesh: long body, 4 wheels', () => {
  const m = makeCarMesh('bus', 0x2e7d6b);
  eq(m.userData.length, 8, 'bus length');
  eq(m.userData.wheels.length, 4, 'bus wheels');
});
test('bike leans harder than a car', () => {
  const bike = new Car('moto', 0xd21f2b, 0, 0, 0);
  const car = new Car('brisa', 0xc94f43, 0, 0, 0);
  bike.speed = 15; car.speed = 15;
  bike.steer = 0.5; car.steer = 0.5;
  bike.syncMesh(); car.syncMesh();
  ok(Math.abs(bike.mesh.rotation.z) > Math.abs(car.mesh.rotation.z) * 3,
    'bike lean ' + bike.mesh.rotation.z.toFixed(3) + ' vs car ' + car.mesh.rotation.z.toFixed(3));
});
test('BUS_STOPS: 4, all on intersections, unique names', () => {
  eq(BUS_STOPS.length, 4, 'stop count');
  const lines = new Set(roadLines());
  for (const s of BUS_STOPS) {
    ok(lines.has(s.x) && lines.has(s.z), 'stop (' + s.x + ',' + s.z + ') not on an intersection');
  }
  eq(new Set(BUS_STOPS.map((s) => s.name)).size, 4, 'stop names unique');
});
test('PARKED_SPOTS: 8, all on road lines, defs exist', () => {
  eq(PARKED_SPOTS.length, 8, 'parked count');
  const lines = new Set(roadLines());
  for (const s of PARKED_SPOTS) {
    ok(CAR_DEFS[s.defKey], 'parked def ' + s.defKey + ' exists');
    ok(lines.has(s.x) || lines.has(s.z), 'parked spot (' + s.x + ',' + s.z + ') off the roads');
  }
});
test('BIRD_FLOCKS: 2 flocks, 5 birds', () => {
  eq(BIRD_FLOCKS.length, 2, 'flock count');
  eq(BIRD_FLOCKS.reduce((n, f) => n + f.count, 0), 5, 'bird count');
});
test('bus-stop wait spots + vendor stalls + performer ring are clear', () => {
  const g = fakeGame();
  for (const s of BUS_STOPS) {
    ok(reachable(g.world, s.waitX, s.waitZ, 2.4), 'wait spot at ' + s.name + ' unreachable');
  }
  for (const v of VENDORS) {
    ok(!pointInBuildings(g.world, v.x, v.z), 'vendor ' + v.name + ' inside a building');
    ok(reachable(g.world, v.x, v.z + 2.2, 2.4), 'vendor ' + v.name + ' ped spot unreachable');
  }
  ok(!pointInColliders(g.world, PERFORMER_SPOT.x, PERFORMER_SPOT.z), 'performer inside a building');
  ok(reachable(g.world, PERFORMER_SPOT.x, PERFORMER_SPOT.z, 2.4), 'performer spot unreachable');
  for (const [dx, dz] of [[2.5, 0], [0, 2.5], [-2.5, 0], [0, -2.5]]) {
    ok(reachable(g.world, PERFORMER_SPOT.x + dx, PERFORMER_SPOT.z + dz, 2.4), 'watcher ring spot unreachable');
  }
});

// ---------------------------------------------------------------------------
// 8. v4 traffic: bike weave, bus dwell, boarding.
// ---------------------------------------------------------------------------
console.log('v4 traffic:');
test('traffic spawn mixes bikes and buses', () => {
  const g = fakeGame();
  const tm = new TrafficManager(fakeScene(), g.world, mulberry32(42));
  tm.spawn(40, { x: 0, z: 0 }, 150);
  const motos = tm.cars.filter((c) => c.defKey === 'moto').length;
  const buses = tm.cars.filter((c) => c.defKey === 'bus').length;
  ok(motos >= 1, 'at least one moto in 40 spawns (got ' + motos + ')');
  ok(buses >= 1, 'at least one bus in 40 spawns (got ' + buses + ')');
  ok(tm.cars.every((c) => c.ai && typeof c.ai.targetSpeed === 'number'), 'every car has an AI');
});
test('bike weaves: full steer at the weave peak, zero for a car', () => {
  const g = fakeGame();
  const tm = new TrafficManager(fakeScene(), g.world, () => 0.99);
  const bike = new Car('moto', 0xd21f2b, 0, 0, Math.PI / 2);
  bike.kind = 'traffic';
  bike.ai = { axis: 'x', dir: 1, targetSpeed: 14, wait: 0, weave: true, weavePhase: Math.PI / 2 };
  const car = new Car('brisa', 0xc94f43, 0, 0, Math.PI / 2);
  car.kind = 'traffic';
  car.ai = { axis: 'x', dir: 1, targetSpeed: 10, wait: 0 };
  tm.cars.push(bike, car);
  tm.update(1 / 60, null, [bike, car]);
  near(bike.steer, 0.45, 0.02, 'bike steer at weave peak');
  eq(car.steer, 0, 'car steers straight');
  // A weaving bike actually turns over a second of driving.
  const h0 = bike.heading;
  for (let i = 0; i < 60; i++) tm.update(1 / 60, null, [bike, car]);
  ok(Math.abs(bike.heading - h0) > 0.05, 'bike heading changed by weaving');
});
test('bus driving into a stop dwells there', () => {
  const g = fakeGame();
  const tm = new TrafficManager(fakeScene(), g.world, () => 0.99);
  const stop = g.world.busStops[0]; // (0, 60)
  const bus = new Car('bus', 0x2e7d6b, -10, 60, Math.PI / 2);
  bus.kind = 'traffic';
  bus.ai = { axis: 'x', dir: 1, targetSpeed: 6, wait: 0, bus: true, dwell: 0, stop: null, lastStop: null, boardedThisStop: false };
  tm.cars.push(bus);
  let dwelled = false;
  for (let i = 0; i < 600; i++) {
    tm.update(1 / 60, null, [bus]);
    if (tm.dwelling.length > 0) { dwelled = true; break; }
  }
  ok(dwelled, 'bus dwelled at the stop');
  ok(tm.dwelling[0].stop === stop, 'dwelling at the right stop');
});
test('spawnBusAt parks a bus with boarding disabled', () => {
  const g = fakeGame();
  const tm = new TrafficManager(fakeScene(), g.world, () => 0.99);
  const stop = g.world.busStops[1];
  const bus = tm.spawnBusAt(stop, 6);
  eq(bus.defKey, 'bus', 'staged car is a bus');
  eq(bus.ai.dwell, 6, 'dwell staged');
  eq(bus.ai.boardedThisStop, true, 'boarding disabled for the shot');
  tm.update(1 / 60, null, [bus]);
  eq(tm.dwelling.length, 1, 'bus is dwelling');
});
test('bus dwell expires and the bus moves on', () => {
  const g = fakeGame();
  const tm = new TrafficManager(fakeScene(), g.world, () => 0.99);
  const stop = g.world.busStops[0];
  const bus = tm.spawnBusAt(stop, 0.5);
  bus.ai.boardedThisStop = false; // staged buses skip boarding; this one may board
  const sx = bus.pos.x, sz = bus.pos.z;
  for (let i = 0; i < 120; i++) tm.update(1 / 60, null, [bus]);
  ok(bus.ai.dwell <= 0, 'dwell expired');
  ok(dist2(bus.pos.x, bus.pos.z, sx, sz) > 0.5, 'bus drove on after the stop');
});
test('boarding takes only this stop\u2019s waiters', () => {
  const g = fakeGame();
  const stop = g.world.busStops[0];
  const other = g.world.busStops[1];
  eq(g.peds.spawnWaiters(stop, 2).length, 2, 'two waiters at the stop');
  g.peds.spawnWaiters(other, 1);
  eq(g.peds.waiters().length, 3, 'three waiters total');
  eq(g.peds.boardWaiters(stop), 2, 'only this stop boards');
  eq(g.peds.waiters().length, 1, 'the other waiter stays');
});

// ---------------------------------------------------------------------------
// 9. v4 peds: joggers, groups, waiters, vendors, performer, beachgoers.
// ---------------------------------------------------------------------------
console.log('v4 peds:');
test('jogger runs at 2.4x walk speed', () => {
  const g = fakeGame();
  const jogger = new Ped(fakeScene(), 0, 0, { role: 'jogger' });
  const walker = new Ped(fakeScene(), 0, 0, { role: 'walker' });
  jogger.update(1 / 60, g.world, null);
  walker.update(1 / 60, g.world, null);
  near(jogger.speed / jogger.walkSpeed, 2.4, 0.01, 'jogger speed ratio');
  near(walker.speed / walker.walkSpeed, 1, 0.01, 'walker speed ratio');
});
test('walking group holds together for a second', () => {
  const g = fakeGame();
  const group = g.peds.spawnGroup(0, 0, 3);
  eq(group.length, 3, 'group of 3');
  for (let i = 0; i < 60; i++) g.peds.update(1 / 60, null, g.player.pos);
  const leader = group[0];
  for (const f of group.slice(1)) {
    ok(dist2(f.pos.x, f.pos.z, leader.pos.x, leader.pos.z) < 4,
      'follower stays near the leader (' + dist2(f.pos.x, f.pos.z, leader.pos.x, leader.pos.z).toFixed(1) + ' m)');
  }
});
test('waiter and vendor hold their spots', () => {
  const g = fakeGame();
  const stop = g.world.busStops[0];
  const [w] = g.peds.spawnWaiters(stop, 1);
  const vendors = g.peds.spawnVendors(g.world.vendorSpots);
  eq(vendors.length, 3, 'three vendors');
  const wx = w.pos.x, wz = w.pos.z;
  const v0 = vendors[0];
  const vx = v0.pos.x, vz = v0.pos.z;
  for (let i = 0; i < 60; i++) g.peds.update(1 / 60, null, g.player.pos);
  ok(dist2(w.pos.x, w.pos.z, wx, wz) < 0.5, 'waiter stayed put');
  ok(dist2(v0.pos.x, v0.pos.z, vx, vz) < 0.5, 'vendor stayed at the stall');
});
test('performer holds the spot, watchers face them', () => {
  const g = fakeGame();
  const { performer, watchers } = g.peds.spawnPerformer(PERFORMER_SPOT.x, PERFORMER_SPOT.z);
  eq(watchers.length, 4, 'four watchers');
  for (let i = 0; i < 60; i++) g.peds.update(1 / 60, null, g.player.pos);
  ok(dist2(performer.pos.x, performer.pos.z, PERFORMER_SPOT.x, PERFORMER_SPOT.z) < 0.5, 'performer holds the spot');
  for (const w of watchers) {
    const want = Math.atan2(performer.pos.x - w.pos.x, performer.pos.z - w.pos.z);
    ok(Math.abs(angleDiff(w.heading, want)) < 0.6, 'watcher faces the performer');
  }
});
test('watchers wander off when the performer dies', () => {
  const g = fakeGame();
  const { performer, watchers } = g.peds.spawnPerformer(PERFORMER_SPOT.x, PERFORMER_SPOT.z);
  performer.hit(999, PERFORMER_SPOT.x, PERFORMER_SPOT.z);
  ok(performer.dead, 'performer is dead');
  g.peds.update(1 / 60, null, g.player.pos);
  ok(watchers[0].speed > 0, 'watcher wanders off');
});
test('beachgoer pauses and stands still', () => {
  const g = fakeGame();
  const b = new Ped(fakeScene(), 220, 0, { role: 'beachgoer' });
  b.pauseTimer = 2;
  b.update(1 / 60, g.world, null);
  eq(b.speed, 0, 'paused beachgoer stands still');
});
test('some peds wear hats', () => {
  const g = fakeGame();
  g.peds.spawn(40, { x: 0, z: 0 }, 100);
  const hatted = g.peds.peds.filter((p) => p.mesh.children.length > 4);
  ok(hatted.length > 0, 'some peds wear hats (' + hatted.length + '/40)');
});

// ---------------------------------------------------------------------------
// 10. v4 birds.
// ---------------------------------------------------------------------------
console.log('v4 birds:');
test('Birds: 5 birds across 2 flocks, in the air', () => {
  const birds = new Birds(fakeScene());
  eq(birds.count, 5, '5 birds');
  const pos = birds.positions();
  eq(pos.length, 5, '5 positions');
  ok(pos.every((p) => p.y > 20), 'all birds in the air');
  ok(pos.every((p) => {
    const d1 = Math.hypot(p.x - 246, p.z - 100);
    const d2 = Math.hypot(p.x - 274, p.z + 40);
    return Math.min(d1, d2) < 40;
  }), 'all birds near an anchor');
});
test('birds actually fly', () => {
  const birds = new Birds(fakeScene());
  const before = birds.positions();
  for (let i = 0; i < 60; i++) birds.update(1 / 60, i / 60);
  const after = birds.positions();
  let moved = 0;
  for (let i = 0; i < before.length; i++) {
    moved = Math.max(moved, Math.hypot(after[i].x - before[i].x, after[i].z - before[i].z));
  }
  ok(moved > 1, 'birds actually fly (' + moved.toFixed(1) + ' m in 1 s)');
});

// ---------------------------------------------------------------------------
// 11. v5 graphics: per-storey facades, ground detail, light.
// ---------------------------------------------------------------------------
console.log('v5 graphics:');
test('facadeBucket: short 3, mid 5, tall 8 storeys; narrow 4, wide 6 cols', () => {
  eq(facadeBucket(10, 15).floors, 3, 'h<14 -> 3');
  eq(facadeBucket(20, 15).floors, 5, 'h<28 -> 5');
  eq(facadeBucket(40, 15).floors, 8, 'tall -> 8');
  eq(facadeBucket(10, 15).cols, 4, 'w<20 -> 4');
  eq(facadeBucket(10, 25).cols, 6, 'wide -> 6');
});
test('facadeTexture paints a colour map and an emissive map', () => {
  const t = facadeTexture('#e8b4a0', 5, 3, 4);
  ok(t.map && t.map.isTexture, 'colour map is a texture');
  ok(t.emissiveMap && t.emissiveMap.isTexture, 'emissive map is a texture');
});
test('city v5 counts: 90 crosswalks, 4 plazas, 28 kerbs, 16 clouds, 4 halos', () => {
  const added = [];
  const scene = { add(m) { added.push(m); }, remove() {} };
  const world = buildCity(scene);
  eq(world.v5counts.crosswalks, 90, 'crosswalks');
  eq(world.v5counts.plazas, PLAZA_SPOTS.length, 'plazas');
  eq(world.v5counts.kerbs, 28, 'kerbs');
  eq(world.v5counts.clouds, 16, 'clouds');
  eq(world.v5counts.halos, 9, 'neon halos (8 shops + marina board)');
});
test('every tower has a parapet, and at least 3 roof colours are used', () => {
  const added = [];
  const scene = { add(m) { added.push(m); }, remove() {} };
  const world = buildCity(scene);
  eq(world.v5counts.parapets, world.v5counts.towers, 'parapets === towers');
  ok(world.v5counts.towers > 40, 'tower count sane (' + world.v5counts.towers + ')');
  ok(world.v5counts.roofColorsUsed >= 3, 'roof colours used: ' + world.v5counts.roofColorsUsed);
});
test('facade meshes carry an emissive map (lit windows glow)', () => {
  const added = [];
  const scene = { add(m) { added.push(m); }, remove() {} };
  buildCity(scene);
  const facades = added.filter((m) => m.userData && m.userData.v5kind === 'facade');
  ok(facades.length >= 50, 'facade meshes: ' + facades.length);
  ok(facades.every((m) => m.material && m.material.emissiveMap), 'every facade has an emissive map');
});
test('city layout is deterministic across builds (v4 layout preserved)', () => {
  const added1 = [];
  const w1 = buildCity({ add(m) { added1.push(m); }, remove() {} });
  const added2 = [];
  const w2 = buildCity({ add(m) { added2.push(m); }, remove() {} });
  eq(JSON.stringify(w1.v5counts), JSON.stringify(w2.v5counts), 'v5 counts identical');
  const f1 = added1.filter((m) => m.userData && m.userData.v5kind === 'facade').map((m) => m.position.x.toFixed(2) + ',' + m.position.z.toFixed(2));
  const f2 = added2.filter((m) => m.userData && m.userData.v5kind === 'facade').map((m) => m.position.x.toFixed(2) + ',' + m.position.z.toFixed(2));
  eq(JSON.stringify(f1), JSON.stringify(f2), 'facade positions identical');
});
test('cars carry light halos: furia 3 sprites, moto 2', () => {
  const furia = makeCarMesh('furia', 0xc94f43);
  const moto = makeCarMesh('moto', 0xd21f2b);
  eq(furia.children.filter((c) => c.isSprite).length, 3, 'furia sprites (2 head + 1 tail)');
  eq(moto.children.filter((c) => c.isSprite).length, 2, 'moto sprites (1 head + 1 tail)');
});
test('sun is hotter in v5', () => {
  eq(PALETTE.sunIntensity, 2.8, 'sunIntensity');
});

// ---------------------------------------------------------------------------
// 11. v6: PS1-NFS car meshes, traffic on the grid, despawn, lamps off the road.
// ---------------------------------------------------------------------------
console.log('v6 fixes:');
test('carsOverlap: 0 apart, > 0 overlapping, length-aware', () => {
  const a = { pos: { x: 0, z: 0 }, heading: 0, defKey: 'brisa', length: 4.4 };
  const b = { pos: { x: 0, z: 10 }, heading: 0, defKey: 'brisa', length: 4.4 };
  eq(carsOverlap(a, b), 0, 'cars 10 m apart nose-to-tail do not overlap');
  b.pos.z = 3;
  ok(carsOverlap(a, b) > 0, 'cars 3 m apart nose-to-tail overlap (brisa is 4.4 long)');
  const bus = { pos: { x: 0, z: 0 }, heading: 0, defKey: 'bus', length: 7.6 };
  const car = { pos: { x: 0, z: 4 }, heading: 0, defKey: 'brisa', length: 4.4 };
  ok(carsOverlap(bus, car) > 0, 'bus nose clips a car 4 m ahead');
  car.pos.z = 7;
  eq(carsOverlap(bus, car), 0, 'bus clears a car 7 m ahead');
});
test('brisa/vento/furia meshes are distinct silhouettes', () => {
  const len = (m) => { const b = new THREE.Box3().setFromObject(m); return b.max.z - b.min.z; };
  const lb = len(makeCarMesh('brisa', 0xc94f43));
  const lv = len(makeCarMesh('vento', 0x2b6cb0));
  const lf = len(makeCarMesh('furia', 0xd21f2b));
  ok(lv > lb + 0.1, 'vento longer than brisa (' + lv.toFixed(2) + ' vs ' + lb.toFixed(2) + ')');
  ok(lf > lv + 0.1, 'furia longer than vento (' + lf.toFixed(2) + ' vs ' + lv.toFixed(2) + ')');
  ok(makeCarMesh('vento', 0x2b6cb0).children.length > makeCarMesh('brisa', 0xc94f43).children.length, 'vento carries a spoiler brisa lacks');
  const moto = makeCarMesh('moto', 0xd21f2b);
  const bus = makeCarMesh('bus', 0x2e7d6b);
  eq(moto.userData.length, 2.2, 'moto length 2.2');
  eq(bus.userData.length, 8, 'bus length 8');
  eq(moto.userData.wheels.length, 2, 'moto has 2 wheels');
  eq(bus.userData.wheels.length, 4, 'bus has 4 wheels');
});
test('traffic stays on the road grid for 10 s, no wedged cars', () => {
  const g = fakeGame();
  const tm = new TrafficManager(fakeScene(), g.world, mulberry32(7));
  tm.spawn(12, { x: 0, z: 0 }, 150);
  const start = tm.cars.map((c) => ({ x: c.pos.x, z: c.pos.z }));
  for (let i = 0; i < 600; i++) tm.update(1 / 60, { x: 0, z: 0 }, tm.cars, []);
  for (let i = 0; i < tm.cars.length; i++) {
    const c = tm.cars[i];
    const d = Math.min(Math.abs(c.pos.x - Math.round(c.pos.x / 60) * 60), Math.abs(c.pos.z - Math.round(c.pos.z / 60) * 60));
    ok(d < 7, c.defKey + ' off the road by ' + d.toFixed(2) + ' m at (' + c.pos.x.toFixed(1) + ',' + c.pos.z.toFixed(1) + ')');
    const moved = Math.hypot(c.pos.x - start[i].x, c.pos.z - start[i].z);
    ok(moved > 10, c.defKey + ' moved only ' + moved.toFixed(1) + ' m in 10 s (wedged?)');
  }
});
test('despawn removes old far traffic, keeps cars near the player', () => {
  const g = fakeGame();
  const tm = new TrafficManager(fakeScene(), g.world, mulberry32(11));
  tm.spawn(6, { x: 0, z: 0 }, 150);
  const old = [...tm.cars];
  for (const c of old) { c.ai.age = 11; c.pos.set(0, 0, 0); }
  const near = new Car('brisa', 0xc94f43, 195, 195, 0);
  near.kind = 'traffic';
  near.ai = { axis: 'x', dir: 1, targetSpeed: 10, wait: 0, age: 11 };
  tm.cars.push(near);
  tm.update(1 / 60, { x: 200, z: 200 }, tm.cars, []);
  for (const c of old) ok(!tm.cars.includes(c), 'old far car despawned');
  ok(tm.cars.includes(near), 'car near the player stays');
});
test('peds despawn far and never share a spot', () => {
  const g = fakeGame();
  const pm = new PedManager(fakeScene(), g.world);
  const far = new Ped(fakeScene(), 0, 0, { role: 'walker' });
  far.age = 21;
  pm.peds.push(far);
  pm.update(1 / 60, null, { x: 200, z: 200 });
  ok(!pm.peds.includes(far), 'old far walker despawned');
  const a = new Ped(fakeScene(), 0, 0, { role: 'walker' });
  const b = new Ped(fakeScene(), 0, 0, { role: 'walker' });
  pm.peds.push(a, b);
  pm.update(1 / 60, null, { x: 0, z: 0 });
  const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
  ok(d > 0.6, 'walkers pushed apart to ' + d.toFixed(2) + ' m');
});
test('lamp poles stand off the road, 28 of them', () => {
  const g = fakeGame();
  const lines = [-180, -120, -60, 0, 60, 120, 180];
  let found = 0;
  for (const l of lines) {
    for (const v of [-180, 180]) {
      const off = v < 0 ? 8 : -8;
      for (const [x, z] of [[l + 8, v + off], [v + off, l + 8]]) {
        const hit = g.world.colliders.some((c) => Math.abs((c.minX + c.maxX) / 2 - x) < 0.35 && Math.abs((c.minZ + c.maxZ) / 2 - z) < 0.35);
        ok(hit, 'lamp collider at (' + x + ',' + z + ')');
        if (hit) found++;
      }
    }
  }
  eq(found, 28, 'lamp count');
});

// ---------------------------------------------------------------------------
// 12. v7: weapons on the street, enemy gangs, graphics.
// ---------------------------------------------------------------------------
console.log('v7 weapons + gangs + graphics:');
test('weapon pickup grants the pistol and switches to it', () => {
  const g = fakeGame();
  const pm = new PickupManager(fakeScene(), g.world);
  g.player.pos.set(-132, 0, 128);
  pm.update(1 / 60, g.player.pos, g);
  ok(g.save.weapons.pistol && g.save.weapons.pistol.owned, 'pistol owned after walk-over');
  eq(g.save.weapons.pistol.ammo, 12, 'pistol comes with a full mag');
  eq(g.save.currentWeapon, 'pistol', 'pistol becomes the current weapon');
  ok(g.notes.some((n) => n.includes('P9 Pistol')), 'pickup toast names the gun');
  ok(g.saved, 'pickup writes the save');
});
test('weapon pickup leaves a full gun alone, then respawns', () => {
  const g = fakeGame();
  const pm = new PickupManager(fakeScene(), g.world);
  g.player.pos.set(-132, 0, 128);
  pm.update(1 / 60, g.player.pos, g);
  const item = pm.items.find((i) => i.kind === 'weapon' && i.weapon === 'pistol');
  ok(!item.active, 'taken pickup goes inactive');
  pm.update(1 / 60, g.player.pos, g);
  ok(!item.active, 'still inactive before its respawn time');
  pm.update(91, g.player.pos, g);
  ok(item.active, 'back after its 90 s respawn');
});
test('GANGS: 2 gangs, distinct colours, turf rectangles, hideouts inside turf', () => {
  eq(GANGS.length, 2, 'two gangs');
  ok(GANGS[0].color !== GANGS[1].color, 'distinct colours');
  for (const gang of GANGS) {
    ok(gang.x0 < gang.x1 && gang.z0 < gang.z1, gang.name + ' turf is a rectangle');
    ok(gang.hx > gang.x0 && gang.hx < gang.x1 && gang.hz > gang.z0 && gang.hz < gang.z1, gang.name + ' hideout inside its turf');
  }
  ok(GANGS[0].x1 <= GANGS[1].x0 || GANGS[0].z1 <= GANGS[1].z0, 'turfs do not overlap');
});
test('gang spawn: hostile, gang-coloured, half armed, clustered at the hideout', () => {
  const g = fakeGame();
  const members = g.peds.spawnGang(GANGS[0], 3);
  eq(members.length, 3, 'three members');
  for (const m of members) {
    eq(m.role, 'gang', 'gang role');
    ok(m.hostile, 'hostile');
    eq(m.mesh.children[1].material.color.getHex(), GANGS[0].color, 'gang shirt colour');
    eq(m.gang, GANGS[0], 'gang reference');
    eq(m.aggro, 26, 'aggro range 26 m');
    eq(typeof m.armed, 'boolean', 'armed flag');
    ok(Math.hypot(m.pos.x - GANGS[0].hx, m.pos.z - GANGS[0].hz) < 20, 'spawned near the hideout');
  }
});
test('gang member chases the player in aggro range, patrols outside it', () => {
  const g = fakeGame();
  const [m] = g.peds.spawnGang(GANGS[0], 1);
  // On the x=-120 road, clear of buildings, so the chase is not a wall test.
  m.pos.set(-120, 0, -150);
  const px = m.pos.x + 10, pz = m.pos.z;
  const d0 = Math.hypot(m.pos.x - px, m.pos.z - pz);
  for (let i = 0; i < 60; i++) g.peds.update(1 / 60, null, { x: px, z: pz });
  const d1 = Math.hypot(m.pos.x - px, m.pos.z - pz);
  eq(m.speed, 4.2, 'chase speed');
  ok(d1 < d0 - 2, 'closed in by ' + (d0 - d1).toFixed(1) + ' m in 1 s');
  for (let i = 0; i < 120; i++) g.peds.update(1 / 60, null, { x: 200, z: 200 });
  ok(m.speed < 3, 'patrol speed once the player is far (' + m.speed.toFixed(2) + ')');
  ok(Math.hypot(m.pos.x - GANGS[0].hx, m.pos.z - GANGS[0].hz) < 45, 'still near its turf');
});
test('gang member does not flee when shot, a walker does', () => {
  const g = fakeGame();
  const [m] = g.peds.spawnGang(GANGS[1], 1);
  m.hit(10, 0, 0);
  ok(!m.fleeing, 'gang member stands and fights');
  const w = new Ped(fakeScene(), 0, 0, { role: 'walker' });
  w.hit(10, 0, 0);
  ok(w.fleeing, 'walker flees');
});
test('gang member does not flee a wanted danger zone, a walker does', () => {
  const g = fakeGame();
  const [m] = g.peds.spawnGang(GANGS[0], 1);
  const w = new Ped(fakeScene(), m.pos.x, m.pos.z, { role: 'walker' });
  g.peds.peds.push(w);
  const danger = { x: m.pos.x, z: m.pos.z, r: 25 };
  g.peds.update(1 / 60, danger, { x: m.pos.x + 10, z: m.pos.z });
  ok(!m.fleeing, 'gang member holds its turf under wanted heat');
  ok(w.fleeing, 'walker flees the danger zone');
});
test('sky is a three-stop gradient (orange, rose, deep blue)', () => {
  const added = [];
  buildCity({ add(m) { added.push(m); }, remove() {} });
  const sky = added.find((m) => m.material && m.material.isShaderMaterial && m.material.uniforms && m.material.uniforms.mid);
  ok(sky, 'sky shader has a mid uniform');
  ok(sky.material.fragmentShader.includes('mid'), 'fragment shader blends the mid stop');
  ok(sky.material.uniforms.top && sky.material.uniforms.horizon, 'top + horizon uniforms kept');
});
test('clouds sit low and warm, in frame', () => {
  const added = [];
  buildCity({ add(m) { added.push(m); }, remove() {} });
  const clouds = added.filter((m) => m.userData && m.userData.v5kind === 'cloud');
  eq(clouds.length, 16, '16 clouds');
  for (const c of clouds) {
    ok(c.position.y < 320, 'cloud low enough to read (y=' + c.position.y.toFixed(0) + ')');
    ok(c.material.opacity >= 0.3, 'cloud visible (opacity ' + c.material.opacity.toFixed(2) + ')');
    eq(c.material.color.getHex(), 0xffe8cc, 'warm cloud colour');
  }
});
test('outer apron covers the void past the city edge', () => {
  const added = [];
  buildCity({ add(m) { added.push(m); }, remove() {} });
  const apron = added.find((m) => m.geometry && m.geometry.parameters && m.geometry.parameters.width >= 2000);
  ok(apron, 'a 2400 m apron plane exists');
  ok(apron.position.y < 0, 'apron sits below the ground slab');
});
test('gang hideout signs: 2, one per gang turf', () => {
  const added = [];
  buildCity({ add(m) { added.push(m); }, remove() {} });
  const signs = added.filter((m) => m.userData && m.userData.v5kind === 'gangSign');
  eq(signs.length, 2, 'two hideout signs');
  for (const gang of GANGS) {
    ok(signs.some((s) => Math.abs(s.position.x - gang.hx) < 1 && Math.abs(s.position.z - gang.hz) < 1), 'sign at the ' + gang.name + ' hideout');
  }
});

console.log('v7 scope additions: witnessed theft + weapon slots:');
test('theft witnessed: parked never, mission always, traffic only if police near', () => {
  eq(theftWitnessed('parked', Infinity), false, 'parked car, no police: not witnessed');
  eq(theftWitnessed('parked', 5), false, 'parked car, police 5 m away: still not witnessed');
  eq(theftWitnessed('mission', Infinity), true, 'mission car: driver sees it');
  eq(theftWitnessed('traffic', Infinity), false, 'traffic car, no police: not witnessed');
  eq(theftWitnessed('traffic', 39), true, 'traffic car, police 39 m away: witnessed');
  eq(theftWitnessed('traffic', 40), false, 'traffic car, police 40 m away: out of witness range');
  eq(theftWitnessed('traffic', 0), true, 'traffic car, police on top of it: witnessed');
});
test('weapon slots: owned only, keys shown, current highlighted', () => {
  const fresh = { fists: { owned: true, ammo: Infinity } };
  let slots = weaponSlotList(fresh, 'fists');
  eq(slots.length, 1, 'fresh save: only the fists slot');
  eq(slots[0].label, 'FISTS', 'fists label');
  eq(slots[0].hotkey, '0', 'fists switches on 0');
  eq(slots[0].on, true, 'fists highlighted while equipped');
  const owned = { fists: { owned: true, ammo: Infinity }, pistol: { owned: true, ammo: 12 } };
  slots = weaponSlotList(owned, 'pistol');
  eq(slots.length, 2, 'pistol owned: two slots');
  eq(slots[1].label, 'P9', 'pistol short label');
  eq(slots[1].hotkey, '1', 'pistol switches on 1');
  eq(slots[1].on, true, 'pistol highlighted while equipped');
  eq(slots[0].on, false, 'fists dimmed while pistol equipped');
  const full = { fists: { owned: true, ammo: Infinity }, pistol: { owned: true, ammo: 12 }, shotgun: { owned: true, ammo: 6 } };
  slots = weaponSlotList(full, 'fists');
  eq(slots.length, 3, 'unowned smg has no slot');
  eq(slots.map((s) => s.hotkey).join(','), '0,1,3', 'hotkeys stay fixed per weapon');
  eq(slots[2].label, 'BOOM', 'shotgun short label');
});

// ---------------------------------------------------------------------------
// v8 scope additions: touch stick, gear, volume, settings, jump, HUD.
// ---------------------------------------------------------------------------
console.log('v8 scope additions: touch controls, gear, volume, HUD screens:');
test('joystickAxes: centre, directions, clamp, run edge', () => {
  let a = joystickAxes(0, 0, 52);
  eq(a.fwd, 0, 'centre: no forward');
  eq(a.strafe, 0, 'centre: no strafe');
  eq(a.run, false, 'centre: not running');
  a = joystickAxes(0, -52, 52);
  eq(a.fwd, 1, 'stick up: full forward');
  eq(a.strafe, 0, 'stick up: no strafe');
  a = joystickAxes(52, 0, 52);
  eq(a.strafe, 1, 'stick right: full strafe');
  a = joystickAxes(0, 52, 52);
  eq(a.fwd, -1, 'stick down: full reverse');
  a = joystickAxes(200, 0, 52);
  eq(a.strafe, 1, 'beyond the rim clamps to 1');
  eq(a.run, true, 'edge push runs');
  a = joystickAxes(20, -20, 52);
  eq(a.run, false, 'half push walks');
});
test('gearFor: R, N, 1..5 across the speed range', () => {
  eq(gearFor(-2, 40), 'R', 'rolling back is R');
  eq(gearFor(0, 40), 'N', 'standstill is N');
  eq(gearFor(0.4, 40), 'N', 'crawl is still N');
  eq(gearFor(2, 40), '1', 'slow is 1st');
  eq(gearFor(20, 40), '3', 'half speed is 3rd');
  eq(gearFor(39, 40), '5', 'near top is 5th');
  eq(gearFor(60, 40), '5', 'over top stays 5th');
  eq(gearFor(10, 0), '1', 'no top speed still gears');
});
test('clampVolume: 0..1, non-numbers fall back to 0.5', () => {
  eq(clampVolume(0.7), 0.7, 'in range passes through');
  eq(clampVolume(2), 1, 'over clamps to 1');
  eq(clampVolume(-1), 0, 'under clamps to 0');
  eq(clampVolume(NaN), 0.5, 'NaN falls back');
  eq(clampVolume('loud'), 0.5, 'a string falls back');
});
test('save settings: defaults, round-trip, sanitised', () => {
  const d = defaultSave();
  eq(d.settings.volume, 0.5, 'default master 0.5');
  eq(d.settings.radio, 0.8, 'default radio 0.8');
  const raw = defaultSave();
  raw.settings = { volume: 2, radio: -1 };
  const clean = sanitizeSave(raw);
  eq(clean.settings.volume, 1, 'volume over 1 clamps');
  eq(clean.settings.radio, 0, 'radio under 0 clamps');
  const old = defaultSave();
  delete old.settings;
  eq(sanitizeSave(old).settings.volume, 0.5, 'a v3 save without settings gets defaults');
});
test('player jump: rises, lands, mesh follows, no double jump', () => {
  const p = new Player(fakeScene(), 0, 0);
  p.jump();
  ok(p.jumpV > 0, 'jump sets upward velocity');
  p.updateOnFoot(0.1, { x: 0, z: 0 }, false, []);
  ok(p.jumpY > 0, 'Rio leaves the ground');
  ok(p.mesh.position.y === p.jumpY, 'mesh rides the hop');
  p.jump();
  const v = p.jumpV;
  p.updateOnFoot(0.1, { x: 0, z: 0 }, false, []);
  eq(p.jumpV, v - 22 * 0.1, 'no re-jump mid-air: velocity only falls');
  for (let i = 0; i < 20; i++) p.updateOnFoot(0.1, { x: 0, z: 0 }, false, []);
  eq(p.jumpY, 0, 'Rio lands');
  eq(p.jumpV, 0, 'velocity rests at zero');
  eq(p.mesh.position.y, 0, 'mesh back on the ground');
});

function hudState(over) {
  return Object.assign({
    cash: 250, health: 100, armor: 0, wanted: 0, weaponName: 'Fists', ammo: Infinity,
    weaponKey: 'fists', weapons: { fists: { owned: true, ammo: Infinity } },
    speedKmh: 0, carSpeed: 0, carTop: 0, inCar: false, prompt: null,
    radio: 'SOL 98.5', objective: 'Free roam', clockSec: 18 * 3600,
    player: { x: -140, z: 140, heading: 0 }, cars: [], heliPos: null,
    markerPos: null, pickups: [], roadblocks: [], mods: { armor: 0, engine: 0, tires: 0 },
    fare: null, busStops: [], gangs: [],
  }, over || {});
}
// Layers the HUD builds at runtime (prompt, banner, splash, touch) live
// under document.body, not in the getElementById cache — and every test
// builds a fresh HUD, so take the newest one.
function bodyLayer(id) {
  const kids = document.body.children;
  for (let i = kids.length - 1; i >= 0; i--) if (kids[i].id === id) return kids[i];
  return null;
}
// The armour bar is injected beside the health bar, not under the body.
function armorBar() {
  const kids = document.getElementById('health-bar').parentNode.children;
  for (let i = kids.length - 1; i >= 0; i--) if (kids[i].id === 'armor-bar') return kids[i];
  return null;
}
test('HUD screens: start, pause, death open, close, and carry their data', () => {
  const hud = new HUD(buildCity(fakeScene()));
  hud.showStartScreen({ hasSave: false, next: MISSION_META[0], cash: 250, chapter: 1, total: 12, pkgs: 0, fares: 0, faresEarned: 0 }, { onContinue() {}, onNew() {} });
  eq(document.getElementById('menu').style.display, 'flex', 'start screen shows');
  ok(document.getElementById('menu-body').innerHTML.includes('New Game'), 'start screen has a New Game button');
  ok(document.getElementById('menu-body').innerHTML.includes('Homecoming'), 'start screen names the next mission');
  hud.showPause({ volume: 0.5, radio: 0.8 }, { onResume() {}, onRestart() {}, onMenu() {}, onVolume() {} });
  ok(document.getElementById('menu-body').innerHTML.includes('Restart Mission'), 'pause menu has restart');
  ok(document.getElementById('menu-body').innerHTML.includes('data-vol="master"'), 'pause menu has a master slider');
  ok(document.getElementById('menu-body').innerHTML.includes('data-vol="radio"'), 'pause menu has a radio slider');
  hud.showDeath('WASTED', 25, { missions: 2, stolen: 3, time: 600, cash: 225 }, { onRespawn() {} });
  eq(document.getElementById('menu-title').textContent, 'WASTED', 'death screen titles WASTED');
  ok(document.getElementById('menu-body').innerHTML.includes('Hospital bill'), 'death screen shows the bill');
  ok(document.getElementById('menu-body').innerHTML.includes('Missions done 2'), 'death screen shows the stats');
  hud.hideMenu();
  eq(document.getElementById('menu').style.display, 'none', 'menu hides');
});
test('HUD menu buttons fire their actions', () => {
  const hud = new HUD(buildCity(fakeScene()));
  let resumed = 0;
  hud.showPause({ volume: 0.5, radio: 0.8 }, { onResume() { resumed++; }, onRestart() {}, onMenu() {}, onVolume() {} });
  const card = document.getElementById('menu-card');
  const btn = elStub('button');
  btn.dataset.act = 'resume';
  card.fire('click', { target: btn });
  eq(resumed, 1, 'Resume button fires onResume');
});
test('HUD toast queue: two toasts both show, in order', () => {
  const hud = new HUD(buildCity(fakeScene()));
  hud.notify('first');
  hud.notify('second');
  hud.update(0.016, hudState());
  eq(document.getElementById('toast').textContent, 'first', 'first toast shows');
  hud.update(4.1, hudState());
  hud.update(0.016, hudState());
  eq(document.getElementById('toast').textContent, 'second', 'second toast follows');
});
test('HUD prompt and banner: live while in reach, gone after', () => {
  const hud = new HUD(buildCity(fakeScene()));
  hud.update(0.016, hudState({ prompt: 'E — Steal the Vento' }));
  eq(bodyLayer('prompt').textContent, 'E — Steal the Vento', 'prompt text set');
  eq(bodyLayer('prompt').style.opacity, '1', 'prompt visible');
  hud.update(0.016, hudState({ prompt: null }));
  eq(bodyLayer('prompt').style.opacity, '0', 'prompt hides');
  hud.banner('Reach the safehouse');
  eq(bodyLayer('banner').textContent, 'Reach the safehouse', 'banner text set');
  eq(bodyLayer('banner').style.opacity, '1', 'banner visible');
  hud.update(4, hudState());
  eq(bodyLayer('banner').style.opacity, '0', 'banner auto-hides');
});
test('HUD armour bar and low-health state follow the numbers', () => {
  const hud = new HUD(buildCity(fakeScene()));
  hud.update(0.016, hudState({ armor: 50, health: 100 }));
  ok(armorBar().children[0].style.width === '50%', 'armour bar half full at 50');
  hud.update(0.016, hudState({ armor: 0, health: 20 }));
  ok(document.getElementById('health-bar').classList.contains('low'), 'health under 30 runs red');
  hud.update(0.016, hudState({ armor: 0, health: 100 }));
  ok(!document.getElementById('health-bar').classList.contains('low'), 'healed health leaves the red');
});
test('TouchControls: hidden without touch, builds forced, buttons fire', () => {
  const plain = new TouchControls({});
  eq(plain.attach(), false, 'no touch device: no layer');
  let entered = 0, shot = 0, jumped = 0, cycled = 0, paused = 0;
  const tc = new TouchControls({ forceTouch: true,
    onEnter() { entered++; }, onShoot() { shot++; }, onJump() { jumped++; },
    onWeapon() { cycled++; }, onPause() { paused++; } });
  eq(tc.attach(), true, 'forced touch builds the layer');
  ok(bodyLayer('touch-ui') !== null, 'touch layer in the DOM');
  const no = { preventDefault() {} };
  tc.btns.enter.fire('pointerdown', no);
  eq(entered, 1, 'ENTER button fires');
  tc.btns.shoot.fire('pointerdown', no);
  eq(shot, 1, 'SHOOT button fires');
  tc.btns.jump.fire('pointerdown', no);
  eq(jumped, 1, 'JUMP button fires on foot');
  tc.btns.weapon.fire('pointerdown', no);
  eq(cycled, 1, 'WEAPON button fires');
  tc.btns.pause.fire('pointerdown', no);
  eq(paused, 1, 'PAUSE button fires');
  tc.setContext({ inCar: true, weapon: 'pistol' });
  eq(tc.btns.enter.textContent, 'EXIT', 'in a car ENTER reads EXIT');
  eq(tc.btns.jump.textContent, 'BRAKE', 'in a car JUMP reads BRAKE');
  eq(tc.btns.shoot.style.display, 'none', 'no shooting from the driver seat');
});
test('mission splash: complete shows it, fail only in live play', () => {
  const g = fakeGame();
  g.missions.startMission(0);
  ok(g.bannerText && g.bannerText.length > 0, 'mission start banners the objective');
  g.missions.complete();
  eq(g.splash && g.splash.title, 'MISSION COMPLETE', 'complete splashes');
  ok((g.splash.lines || []).some((l) => l.includes('Reward')), 'splash names the reward');
  const g2 = fakeGame();
  g2.missions.startMission(0);
  g2.state = 'wasted';
  g2.splash = null;
  g2.missions.fail('Out of time');
  eq(g2.splash, null, 'no fail splash under the WASTED screen');
  const g3 = fakeGame();
  g3.missions.startMission(0);
  g3.missions.fail('Out of time');
  eq(g3.splash && g3.splash.title, 'MISSION FAILED', 'live fail splashes');
});

// ---------------------------------------------------------------------------
// Summary.
// ---------------------------------------------------------------------------
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  console.log('failures:');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
