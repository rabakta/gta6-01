// BRISA BAY v3 — save / load. Progress lives in localStorage only; nothing
// is sent anywhere. A save holds cash, the story chapter, owned weapons and
// ammo, owned cars, garage upgrades, the collectible packages found so far
// and the player's best stats. Loads are sanitised: a save from an older
// build, or one a player edited by hand, can never hand the game a weapon
// it does not own, an upgrade level past the cap, a package id that does
// not exist, or a chapter past the end of the story.
import { SAVE_KEY, MISSION_META, WEAPONS, COLLECTIBLES } from './config.js';

export const SAVE_VERSION = 3; // v3: the save gains the packages list and fare stats

export function defaultSave() {
  return {
    cash: 250,
    missionIndex: 0,
    weapons: { fists: { owned: true, ammo: Infinity } },
    currentWeapon: 'fists',
    armor: 0,
    // Garage upgrades: each 0..2 (see UPGRADES in config.js).
    upgrades: { armor: 0, engine: 0, tires: 0 },
    ownedCars: [],
    // Collectible packages found, by index into COLLECTIBLES (0..19).
    packages: [],
    stats: {
      missionsDone: 0,
      missionsFailed: 0,
      carsStolen: 0,
      pedsHit: 0,
      copsDodged: 0,
      playSeconds: 0,
      // v3: taxi fares and packages.
      faresDone: 0,
      faresEarned: 0,
      packagesFound: 0,
    },
  };
}

// Clamp a loaded blob back into shape. Returns a full, valid save.
export function sanitizeSave(raw) {
  const clean = defaultSave();
  if (typeof raw !== 'object' || raw === null) return clean;
  if (Number.isFinite(raw.cash)) clean.cash = Math.max(0, Math.floor(raw.cash));
  if (Number.isFinite(raw.missionIndex)) {
    clean.missionIndex = Math.max(0, Math.min(MISSION_META.length, Math.floor(raw.missionIndex)));
  }
  if (Number.isFinite(raw.armor)) clean.armor = Math.max(0, Math.min(100, raw.armor));
  if (typeof raw.upgrades === 'object' && raw.upgrades !== null) {
    for (const key of ['armor', 'engine', 'tires']) {
      if (Number.isFinite(raw.upgrades[key])) {
        clean.upgrades[key] = Math.max(0, Math.min(2, Math.floor(raw.upgrades[key])));
      }
    }
  }
  if (typeof raw.weapons === 'object' && raw.weapons !== null) {
    for (const [key, w] of Object.entries(raw.weapons)) {
      if (!WEAPONS[key] || typeof w !== 'object' || w === null) continue;
      const ammo = WEAPONS[key].ammo === Infinity ? Infinity : Math.max(0, Math.floor(w.ammo ?? 0));
      clean.weapons[key] = { owned: true, ammo };
    }
  }
  if (typeof raw.currentWeapon === 'string' && clean.weapons[raw.currentWeapon]) {
    clean.currentWeapon = raw.currentWeapon;
  }
  if (Array.isArray(raw.ownedCars)) clean.ownedCars = raw.ownedCars.filter((c) => typeof c === 'string');
  // v3: packages — keep only valid ids, deduplicated, in order. A v2 save
  // has no field at all, which sanitises to an empty list: a returning
  // player simply finds the packages fresh.
  if (Array.isArray(raw.packages)) {
    const seen = new Set();
    clean.packages = raw.packages.filter((id) => {
      if (!Number.isInteger(id) || id < 0 || id >= COLLECTIBLES.length || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }
  if (typeof raw.stats === 'object' && raw.stats !== null) {
    for (const key of Object.keys(clean.stats)) {
      if (Number.isFinite(raw.stats[key])) clean.stats[key] = Math.max(0, Math.floor(raw.stats[key]));
    }
  }
  // The packages stat is derived from the list, never trusted from the
  // blob — a hand-edited save cannot claim 20 found with 3 in the list.
  clean.stats.packagesFound = clean.packages.length;
  return clean;
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return sanitizeSave(JSON.parse(raw));
  } catch (e) {
    return null; // corrupt JSON or blocked storage: start fresh
  }
}

export function writeSave(data) {
  try {
    data._v = SAVE_VERSION;
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (e) {
    // Storage full or blocked: the game just plays on without saving.
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (e) {
    // Ignore: nothing to clear, or storage is unavailable.
  }
}
