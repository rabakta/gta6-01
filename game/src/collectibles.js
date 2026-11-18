// BRISA BAY v3 — collectible packages. Twenty hidden parcels across the
// city: the beach, the docks, the lighthouse path, the pier end, the
// alleys. Walk or drive through one to collect it; the count lives in the
// save, so a package stays found across sessions, and all twenty pay a
// one-off $5,000 bonus. Every spot sits on a road line or on the open
// beach, so none can hide inside a building. The packages are deliberately
// NOT on the minimap — finding them is the game.
import * as THREE from 'three';
import { COLLECTIBLES, COLLECTIBLE_BONUS } from './config.js';
import { glowTexture } from './textures.js';
import { dist2 } from './utils.js';

export class CollectibleManager {
  // `save` is the live save object (its `packages` array is the source of
  // truth); `scene` is where the meshes live. `world` is unused — kept
  // for symmetry with PickupManager.
  constructor(scene, save) {
    this.scene = scene;
    this.save = save;
    this.items = [];
    const glowTex = glowTexture();
    for (let i = 0; i < COLLECTIBLES.length; i++) {
      const def = COLLECTIBLES[i];
      const taken = save.packages.includes(i);
      const group = new THREE.Group();
      // A gold parcel: a small box with a darker band, glowing amber so
      // it reads at dusk from a car window.
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.9, 0.9),
        new THREE.MeshBasicMaterial({ color: 0xf2c230 }),
      );
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(0.95, 0.25, 0.95),
        new THREE.MeshBasicMaterial({ color: 0x8a5a1a }),
      );
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: 0xf2c230, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.scale.setScalar(4);
      group.add(box, band, glow);
      group.position.set(def.x, 1.2, def.z);
      group.visible = !taken;
      scene.add(group);
      this.items.push({ id: i, ...def, group, box, glow, active: !taken, phase: Math.random() * 6 });
    }
  }

  count() { return this.save.packages.length; }

  // New game: point at the fresh save and put every parcel back on the
  // map. Without this the manager would keep writing to the old save
  // object after main.js swaps in a new one.
  reset(save) {
    this.save = save;
    for (const item of this.items) {
      item.active = true;
      item.group.visible = true;
    }
  }

  update(dt, playerPos, game) {
    const t = performance.now() / 1000;
    for (const item of this.items) {
      if (!item.active) continue;
      // Bob and spin so the parcel reads as a live object, not scenery;
      // the halo breathes with the bob. The whole group spins, so the
      // band turns with the box instead of clipping through it.
      item.group.position.y = 1.2 + Math.sin(t * 2 + item.phase) * 0.25;
      item.group.rotation.y += dt * 1.2;
      item.glow.material.opacity = 0.4 + Math.sin(t * 2 + item.phase) * 0.15;
      if (dist2(playerPos.x, playerPos.z, item.x, item.z) < 2.4) {
        item.active = false;
        item.group.visible = false;
        this.save.packages.push(item.id);
        const n = this.save.packages.length;
        this.save.stats.packagesFound = n;
        if (n >= COLLECTIBLES.length) {
          this.save.cash += COLLECTIBLE_BONUS;
          game.audio.jingle();
          game.notify('All ' + COLLECTIBLES.length + ' packages! +$' + COLLECTIBLE_BONUS.toLocaleString('en-US') + ' bonus.');
        } else {
          game.audio.pickup();
          game.notify('Package ' + n + '/' + COLLECTIBLES.length + ' — ' + item.name + '.');
        }
        game.writeSave();
      }
    }
  }
}
