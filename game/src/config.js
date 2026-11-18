// BRISA BAY — tuning tables and content data for the whole game.
// Every number the game balances on lives here, so a tune is one edit and
// no system hides a magic number of its own.

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

// Sunset palette: warm sky, low sun, long shadows.
export const PALETTE = {
  skyTop: 0x2e5f8a,
  skyHorizon: 0xffb36b,
  sun: 0xffd9a0,
  sunIntensity: 2.4,
  hemiSky: 0x9db8d6,
  hemiGround: 0x5a4a38,
  fog: 0xe8a06a,
  asphalt: 0x2b2e33,
  pavement: 0x8f8578,
  sand: 0xd9b380,
  sea: 0x1e6f8e,
};

// Camera + world clock tuning, so feel changes land in one place.
export const CAMERA_FOV = 62;
export const CLOCK_RATE = 12; // game seconds per real second (a game minute every 5 s)
export const WANTED_MAX = 5;
export const HELI_MIN_WANTED = 3; // stars before the BCPD helicopter lifts off
export const WANTED_DECAY_SECONDS = 14; // out of sight this long loses a star

// How crowded the streets stay around the player.
export const POPULATION = { traffic: 10, peds: 16 };

export const SAVE_KEY = 'brisabay-save-v1';

// Paint jobs the SPRAY & GO shop can roll for a respray.
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
  police:   { name: 'Interceptor', label: 'BCPD Interceptor', topSpeed: 36, accel: 20, brake: 38, handling: 0.9, colors: [0x1d2733] },
};

// ---------------------------------------------------------------------------
// Weapons. `rate` is seconds between shots, `spread` in radians.
// ---------------------------------------------------------------------------
export const WEAPONS = {
  fists:   { name: 'Fists',     price: 0,    damage: 18, rate: 0.45, range: 2.2, auto: false, ammo: Infinity, spread: 0 },
  pistol:  { name: 'P9 Pistol', price: 250,  damage: 26, rate: 0.28, range: 70,  auto: false, ammo: 12,       spread: 0.012 },
  smg:     { name: 'Vespa SMG', price: 900,  damage: 15, rate: 0.09, range: 55,  auto: true,  ammo: 32,       spread: 0.05 },
  shotgun: { name: 'Boomstick', price: 1400, damage: 13, rate: 0.85, range: 26,  auto: false, ammo: 6,        spread: 0.09, pellets: 6 },
};

// ---------------------------------------------------------------------------
// Shops on the map corners. `kind` picks the stock list in main.js.
// ---------------------------------------------------------------------------
export const SHOPS = [
  { kind: 'guns',  name: 'IRONWORKS',  pos: [-150, -60],  blurb: 'Guns, ammo, armour' },
  { kind: 'paint', name: 'SPRAY & GO', pos: [150, -150],  blurb: 'Respray $150 - Repair $200' },
  { kind: 'food',  name: 'TACO SOL',   pos: [-60, 150],   blurb: 'Hot food restores health' },
];

// ---------------------------------------------------------------------------
// Radio: tiny step sequencers. `root` is a MIDI note, `scale` semitone steps.
// ---------------------------------------------------------------------------
export const RADIO_STATIONS = [
  { name: 'SOL 98.5',   desc: 'Latin groove', bpm: 96,  root: 57, scale: [0, 2, 3, 7, 10], bass: [0, 0, 3, 5] },
  { name: 'NEON DRIVE', desc: 'Synthwave',   bpm: 112, root: 45, scale: [0, 2, 3, 7, 8],  bass: [0, 0, 8, 7] },
  { name: 'PALM FM',    desc: 'Lo-fi beach', bpm: 76,  root: 52, scale: [0, 3, 5, 7, 10], bass: [0, 5, 3, 7] },
];

// ---------------------------------------------------------------------------
// Story. Full step scripts live in missions.js; this table is the chapter
// select the start screen and the HUD read from.
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
];

export const STORY_INTRO = [
  'Brisa Bay. Sun, salt, and everyone owing someone.',
  'Rio Marin drove getaway for the Solmar crew for six years.',
  'Then Vex sold him out, and Rio did three years upstate.',
  'Now he is back - and the city still owes him.',
];
