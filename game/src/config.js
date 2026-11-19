// BRISA BAY — tuning tables and content data for the whole game.
// Every number the game balances on lives here, so a tune is one edit and
// no system hides a magic number of its own. Later rounds add two story
// chapters (a checkpoint race and the finale), the taxi fare system and
// the 20 collectible packages, then motorbikes and city buses, bus stops,
// street vendors, parked cars Rio can steal, birds and a street
// performer — the city gets busier.

// ---------------------------------------------------------------------------
// The city: a square grid of blocks. Roads run on the grid lines; the beach
// and the sea lie to the east (+X), the hills to the west.
// ---------------------------------------------------------------------------
export const CITY = {
  blocks: 7, // road lines per axis, at -180, -120, -60, 0, 60, 120, 180
  pitch: 60, // distance between neighbouring road centre lines
  roadWidth: 14,
  blockSize: 46,
  half: 210, // city edge; beach runs from here to the water
  beachEnd: 252,
  seaEnd: 620,
};

// Sunset palette: warm sky, low sun, long shadows. The sun warms further
// and the sea deepens so the golden hour reads on every screenshot.
export const PALETTE = {
  skyTop: 0x2a4f7e,
  skyHorizon: 0xff9a4d,
  sun: 0xffd9a0,
  // The sun is a touch hotter and the hemisphere a touch dimmer, so
  // the sunset shadows bite and the lit windows read.
  sunIntensity: 2.8,
  hemiSky: 0x9db8d6,
  hemiGround: 0x5a4a38,
  fog: 0xe8965f,
  asphalt: 0x2b2e33,
  pavement: 0x8f8578,
  sand: 0xd9b380,
  sea: 0x14607f,
};

// Camera and wanted tuning.
export const CAMERA_FOV = 62;
export const WANTED_MAX = 5;
export const ROADBLOCK_MIN_WANTED = 4; // stars before the BCPD sets roadblocks
export const ROADBLOCK_COUNT = 2; // how many blocks go up at once

export const SAVE_KEY = 'brisabay-save-v1';

// Paint jobs the GARAGE shop can roll for a respray.
export const RESPRAY_COLORS = [0xc94f43, 0x4a6fa5, 0xf2c230, 0x5a7d5a, 0xd21f2b];

// ---------------------------------------------------------------------------
// Cars the city drives. `handling` is 0..1 (higher = grippier, sharper).
// ---------------------------------------------------------------------------
export const CAR_DEFS = {
  brisa:    { name: 'Brisa',    label: 'Brisa Sedan',    topSpeed: 26, accel: 13, brake: 30, handling: 0.55, colors: [0xc94f43, 0x4a6fa5, 0xd8d3c3, 0x5a7d5a] },
  vento:    { name: 'Vento',    label: 'Vento Coupe',    topSpeed: 30, accel: 15, brake: 32, handling: 0.7,  colors: [0x2b3a55, 0xb8b0a0, 0x8e2f32] },
  furia:    { name: 'Furia',    label: 'Furia GT',       topSpeed: 38, accel: 19, brake: 36, handling: 0.85, colors: [0xf2c230, 0xd21f2b, 0x20242a] },
  carguero: { name: 'Carguero', label: 'Carguero Van',   topSpeed: 22, accel: 10, brake: 26, handling: 0.4,  colors: [0xe8e2d0, 0x7a8894] },
  caminar:  { name: 'Caminar',  label: 'Caminar Truck',  topSpeed: 24, accel: 11, brake: 28, handling: 0.45, colors: [0x9c6b3c, 0x4a5d3a] },
  taxi:     { name: 'Taxi Sol', label: 'Taxi Sol',       topSpeed: 28, accel: 14, brake: 31, handling: 0.6,  colors: [0xf2a007] },
  // The city gets busier — a nimble bike and a slow city bus.
  moto:     { name: 'Moto',    label: 'Moto 250',       topSpeed: 34, accel: 17, brake: 34, handling: 0.85, colors: [0xd21f2b, 0x2b3a55, 0xf2c230] },
  bus:      { name: 'Bus',     label: 'Sol Bus',        topSpeed: 18, accel: 8,  brake: 22, handling: 0.3,  colors: [0x2e7d6b, 0xd9a441, 0x4a6fa5] },
  police:   { name: 'Interceptor', label: 'BCPD Interceptor', topSpeed: 36, accel: 20, brake: 38, handling: 0.9, colors: [0x1d2733] },
};

// ---------------------------------------------------------------------------
// Garage upgrades. Each has two paid levels; `levels` are the prices.
// The bonuses stack per level and apply to whatever Rio is driving.
// ---------------------------------------------------------------------------
export const UPGRADES = {
  armor: {
    name: 'Armour Plating', levels: [400, 800],
    desc: '+60 car health per level, steel roof plate',
    healthBonus: 60,
  },
  engine: {
    name: 'Engine Tune', levels: [600, 1200],
    desc: '+4 top speed, +3 launch per level, hotter exhaust',
    topSpeedBonus: 4, accelBonus: 3,
  },
  tires: {
    name: 'Sport Tyres', levels: [350, 700],
    desc: '+0.12 grip per level, wider wheels, sharper turns',
    handlingBonus: 0.12,
  },
};

// ---------------------------------------------------------------------------
// World pickups: glowing crosses and shields at fixed spots. `respawn` is
// the seconds before a taken pickup comes back.
// ---------------------------------------------------------------------------
export const PICKUPS = [
  { kind: 'health', x: -120, z: 70,  respawn: 45 },
  { kind: 'armor',  x: 180,  z: -140, respawn: 45 },
  { kind: 'health', x: 228,  z: 40,  respawn: 45 },
  { kind: 'armor',  x: -150, z: 140, respawn: 45 },
  // Free guns on the street: a pistol by the safehouse, a Boomstick at
  // the docks. Walk over one and it is yours — no shop trip needed.
  { kind: 'weapon', weapon: 'pistol', x: -132, z: 128, respawn: 90 },
  { kind: 'weapon', weapon: 'shotgun', x: 180, z: -120, respawn: 120 },
];
export const PICKUP_HEALTH = 40;
export const PICKUP_ARMOR = 50;

// ---------------------------------------------------------------------------
// Weapons. `rate` is seconds between shots, `spread` in radians.
// ---------------------------------------------------------------------------
export const WEAPONS = {
  fists:   { name: 'Fists',     price: 0,    damage: 18, rate: 0.45, range: 2.2, auto: false, ammo: Infinity, spread: 0 },
  pistol:  { name: 'P9 Pistol', price: 250,  damage: 26, rate: 0.28, range: 70,  auto: false, ammo: 12,       spread: 0.012 },
  smg:     { name: 'Vespa SMG', price: 900,  damage: 15, rate: 0.09, range: 55,  auto: true,  ammo: 32,       spread: 0.05 },
  shotgun: { name: 'Boomstick', price: 1400, damage: 13, rate: 0.85, range: 26,  auto: false, ammo: 6,        spread: 0.09, pellets: 6 },
};

// Enemy gangs: turf rectangles, hideout centres, colours. Members spawn
// in their turf, attack Rio on sight there, and send more men when hit.
export const GANGS = [
  { name: 'VEX BOYS', color: 0xd21f2b, x0: -210, z0: -210, x1: -60, z1: -60, hx: -150, hz: -150 },
  { name: 'CORAL KINGS', color: 0x2e7d6b, x0: 60, z0: 60, x1: 210, z1: 210, hx: 150, hz: 150 },
];

// ---------------------------------------------------------------------------
// Shops on the map corners. `kind` picks the stock list in main.js.
// ---------------------------------------------------------------------------
export const SHOPS = [
  { kind: 'guns',   name: 'IRONWORKS',  pos: [-150, -60],  blurb: 'Guns, ammo, armour' },
  { kind: 'garage', name: 'GARAGE 24',  pos: [150, -150],  blurb: 'Upgrades - Respray - Repair' },
  { kind: 'food',   name: 'TACO SOL',   pos: [-60, 150],   blurb: 'Hot food restores health' },
];

// ---------------------------------------------------------------------------
// Radio: tiny step sequencers. `root` is a MIDI note, `scale` semitone steps.
// A fourth station, SOL MAR 101, so R cycles through four moods.
// ---------------------------------------------------------------------------
export const RADIO_STATIONS = [
  { name: 'SOL 98.5',    desc: 'Latin groove', bpm: 96,  root: 57, scale: [0, 2, 3, 7, 10], bass: [0, 0, 3, 5] },
  { name: 'NEON DRIVE',  desc: 'Synthwave',   bpm: 112, root: 45, scale: [0, 2, 3, 7, 8],  bass: [0, 0, 8, 7] },
  { name: 'PALM FM',     desc: 'Lo-fi beach', bpm: 76,  root: 52, scale: [0, 3, 5, 7, 10], bass: [0, 5, 3, 7] },
  { name: 'SOL MAR 101', desc: 'Island reggae', bpm: 88, root: 50, scale: [0, 2, 5, 7, 10], bass: [0, 0, 5, 3] },
];

// ---------------------------------------------------------------------------
// Story. Full step scripts live in missions.js; this table is the chapter
// select the start screen and the HUD read from. Later rounds add two
// chapters: the Grand Prix race and the finale at the ferry.
// ---------------------------------------------------------------------------
export const MISSION_META = [
  { name: 'Homecoming',    reward: 300,  brief: 'Rio Marin is back in Brisa Bay. Get wheels and reach the safehouse.' },
  { name: 'Hot Wheels',    reward: 600,  brief: 'A yellow Furia GT waits at the marina. Steal it. Deliver it to the garage.' },
  { name: 'The Pickup',    reward: 900,  brief: 'A package at the docks. Grab it and bring it back - the BCPD will notice.' },
  { name: 'Payback',       reward: 1200, brief: 'Vex and his crew jumped you once. Ram his Vento until it burns.' },
  { name: 'Silent Harbor', reward: 1500, brief: 'On foot. Slip into the warehouse, take the case, deal with the guards.' },
  { name: 'The Getaway',   reward: 1800, brief: 'Three stars and a bridge to cross. Ninety seconds. Do not stop.' },
  { name: 'Harbor Lights', reward: 2200, brief: 'Drive the Caminar truck through two roadblocks to the airfield.' },
  { name: 'The Last Job',  reward: 5000, brief: 'The Solmar Casino vault. Five stars on the way out. Get home, Rio.' },
  { name: 'Sunset Run',    reward: 2600, brief: 'A parcel at the docks, an airfield deadline. Seventy-five seconds, two stars.' },
  { name: 'Lose the Tail', reward: 3200, brief: 'Vex is on your tail. Sixty seconds - do not let him touch you.' },
  { name: 'Midnight Grand Prix', reward: 3500, brief: 'Six checkpoints, two rivals, one start line. Beat Vex\u2019s crew around the city - 150 seconds.' },
  { name: 'The Last Ferry',      reward: 5000, brief: 'Steal the fastest car in town, make the ferry at the docks, then a five-star escape to the airfield. The last job.' },
];

export const STORY_INTRO = [
  'Brisa Bay. Sun, salt, and everyone owing someone.',
  'Rio Marin drove getaway for the Solmar crew for six years.',
  'Then Vex sold him out, and Rio did three years upstate.',
  'Now he is back - and the city still owes him.',
];

// ---------------------------------------------------------------------------
// Later additions.
// ---------------------------------------------------------------------------

// The Grand Prix route: a clockwise loop of the city on the outer ring
// roads. Every checkpoint sits on an intersection, so the rivals and the
// player both follow real roads. The loop is about 900 m; a tuned Furia
// covers it in roughly a minute, the rivals in a little over one.
export const RACE_CHECKPOINTS = [
  { x: -180, z: 60 },
  { x: -180, z: -120 },
  { x: 60, z: -120 },
  { x: 60, z: -180 },
  { x: 180, z: -180 },
  { x: 180, z: 60 },
];

// Taxi fares: the repeatable side activity. A fare offer appears while
// free-roaming; drive up in a car and press E to pick the passenger up,
// then deliver them before the timer runs out. Pay is a base fare plus a
// per-metre rate, with a speed tip on top.
export const TAXI = {
  // Seconds after free-roam starts before the first offer appears.
  firstOfferDelay: 20,
  // Seconds between offers once one ends (picked up, delivered, lost
  // or expired).
  cooldown: 15,
  // How long an offer stays on the map before the fare finds another cab.
  offerExpiry: 75,
  // The passenger must be picked up within this distance, in a car.
  pickupRadius: 12,
  // Delivery counts inside this distance of the destination.
  destRadius: 10,
  baseFare: 80,
  // Extra dollars per metre of trip length.
  perMeter: 0.3,
  // Delivery timer: metres / 16, clamped to this range.
  minTime: 45,
  maxTime: 90,
  // Tip for a fast delivery: seconds left on the timer, capped.
  maxTip: 60,
};

// Collectible packages: 20 hidden parcels across the city. Walking or
// driving through one collects it; the count lives in the save, and all
// 20 pay a one-off bonus. Every spot has at least one coordinate on a
// road line, or sits outside the block grid (beach, city edge), so none
// can hide inside a building collider.
export const COLLECTIBLE_BONUS = 5000;
export const COLLECTIBLES = [
  { x: 206, z: 140, name: 'Marina boardwalk' },
  { x: 192, z: 30, name: 'Beachfront cafe' },
  { x: 180, z: -140, name: 'Dockside crane' },
  { x: 120, z: -170, name: 'South market' },
  { x: 60, z: -206, name: 'Lighthouse path' },
  { x: -30, z: -206, name: 'North edge lay-by' },
  { x: -150, z: -170, name: 'Airfield approach' },
  { x: -206, z: -90, name: 'Coral Row alley' },
  { x: -206, z: 40, name: 'West promenade' },
  { x: -180, z: 170, name: 'Coral Row garage' },
  { x: -60, z: 200, name: 'Palm Row bench' },
  { x: 60, z: 170, name: 'Beach lifeguard hut' },
  { x: 120, z: 60, name: 'Downtown arcade' },
  { x: -120, z: 0, name: 'Casino west door' },
  { x: 0, z: -30, name: 'Plaza fountain' },
  { x: 0, z: 30, name: 'Plaza flower stall' },
  { x: 120, z: -90, name: 'North market stall' },
  { x: -120, z: -90, name: 'Northwest corner shop' },
  { x: -60, z: -150, name: 'Lookout car park' },
  { x: 150, z: 120, name: 'Beachfront apartments' },
];

// ---------------------------------------------------------------------------
// The city gets busier.
// ---------------------------------------------------------------------------

// Bus stops: each sits on an intersection (both coordinates on road
// lines) so a bus driving its route passes straight through it. A
// waiting ped stands 9 m off the road line, on the sidewalk.
export const BUS_STOPS = [
  { x: 0, z: 60, name: 'Plaza North' },
  { x: -60, z: 0, name: 'West Plaza' },
  { x: 120, z: -60, name: 'North Market' },
  { x: 60, z: 120, name: 'Beachfront South' },
];

// Street vendors: fixed stalls on the sidewalk (9 m off a road line).
// The ped behind the stall never leaves it — unless something scares them.
export const VENDORS = [
  { x: 9, z: 30, name: 'FLOWERS', color: 0xd98ab0 },
  { x: -51, z: -90, name: 'TACOS', color: 0xf2a007 },
  { x: 129, z: 90, name: 'FRUIT', color: 0x5a7d5a },
];

// Parked cars Rio can steal: fixed spots on road lines, varied rides.
export const PARKED_SPOTS = [
  { defKey: 'brisa', color: 0x5a7d5a, x: -60, z: 30, heading: Math.PI / 2 },
  { defKey: 'vento', color: 0x8e2f32, x: 60, z: -30, heading: -Math.PI / 2 },
  { defKey: 'moto', color: 0xd21f2b, x: 0, z: 90, heading: 0 },
  { defKey: 'taxi', color: 0xf2a007, x: -120, z: -30, heading: Math.PI },
  { defKey: 'carguero', color: 0x7a8894, x: 120, z: 30, heading: 0 },
  { defKey: 'furia', color: 0x20242a, x: 30, z: 180, heading: Math.PI / 2 },
  { defKey: 'brisa', color: 0xc94f43, x: -30, z: -120, heading: -Math.PI / 2 },
  { defKey: 'moto', color: 0x2b3a55, x: 180, z: 90, heading: Math.PI },
];

// Birds: flocks circling the lighthouse and the pier. Each flock is an
// anchor point, a count and an orbit radius band.
export const BIRD_FLOCKS = [
  { x: 246, z: 100, count: 5, radius: 24, height: 34 },
  { x: 274, z: -40, count: 4, radius: 18, height: 28 },
];

// The street performer holds court at the Plaza, ringed by watchers.
export const PERFORMER_SPOT = { x: 12, z: 10 };
