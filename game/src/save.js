// BRISA BAY — save / load. Progress lives in localStorage only; nothing
// is sent anywhere. A save holds cash, the story chapter, owned weapons and
// ammo, owned cars and the player's best stats.
import { SAVE_KEY } from './config.js';

export function defaultSave() {
  return {
    cash: 250,
    missionIndex: 0,
    weapons: { fists: { owned: true, ammo: Infinity } },
    currentWeapon: 'fists',
    armor: 0,
    ownedCars: [],
    stats: { missionsDone: 0, carsStolen: 0, pedsHit: 0, copsDodged: 0, playSeconds: 0 },
  };
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    return { ...defaultSave(), ...data, stats: { ...defaultSave().stats, ...(data.stats || {}) } };
  } catch (e) { return null; }
}

export function writeSave(data) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) { /* storage full/blocked: play on */ }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
}
