// BRISA BAY — world pickups. Glowing health crosses and armour diamonds sit
// at fixed spots around the city (hospital, docks, beach, safehouse). Walk
// or drive over one to take it; it comes back after its respawn time. A
// full-health Rio leaves a health cross alone, so the pickup stays on the
// map for when he needs it. (The collectible packages are a separate system
// in collectibles.js: one-offs that never respawn.)
import * as THREE from 'three';
import { PICKUPS, PICKUP_HEALTH, PICKUP_ARMOR } from './config.js';
import { glowTexture } from './textures.js';
import { dist2 } from './utils.js';

export class PickupManager {
  constructor(scene, world) {
    this.scene = scene;
    this.items = [];
    const glowTex = glowTexture();
    for (const def of PICKUPS) {
      const group = new THREE.Group();
      const color = def.kind === 'health' ? 0x2fd47a : 0x4da3ff;
      let mesh;
      if (def.kind === 'health') {
        // Green cross: two bars.
        const mat = new THREE.MeshBasicMaterial({ color });
        const h1 = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 0.4), mat);
        const h2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.4, 0.4), mat);
        mesh = new THREE.Group();
        mesh.add(h1, h2);
      } else {
        // Blue diamond: an octahedron, reads as a shield at a glance.
        mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.85), new THREE.MeshBasicMaterial({ color }));
      }
      group.add(mesh);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color, transparent: true, opacity: 0.6,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.scale.setScalar(5);
      group.add(glow);
      group.position.set(def.x, 1.4, def.z);
      scene.add(group);
      this.items.push({ ...def, group, mesh, glow, active: true, timer: 0, phase: Math.random() * 6 });
    }
  }

  // Active pickups for the minimap (green crosses, blue diamonds).
  activePickups() {
    return this.items.filter((i) => i.active).map((i) => ({ x: i.x, z: i.z, kind: i.kind }));
  }

  update(dt, playerPos, game) {
    const t = performance.now() / 1000;
    for (const item of this.items) {
      if (!item.active) {
        item.timer -= dt;
        if (item.timer <= 0) {
          item.active = true;
          item.group.visible = true;
        }
        continue;
      }
      // Bob and spin so the pickup reads as a live object, not scenery;
      // the halo breathes with the bob. Same 2.4 m take radius as the
      // v3 collectible packages, so both "walk over it" pickups feel alike.
      item.group.position.y = 1.4 + Math.sin(t * 2 + item.phase) * 0.3;
      item.mesh.rotation.y += dt * 1.5;
      item.glow.material.opacity = 0.45 + Math.sin(t * 2 + item.phase) * 0.15;
      if (dist2(playerPos.x, playerPos.z, item.x, item.z) < 2.4) {
        if (item.kind === 'health') {
          if (game.player.health >= 100) continue; // full health: leave it
          game.player.heal(PICKUP_HEALTH);
          game.notify('First aid +' + PICKUP_HEALTH + ' health.');
        } else {
          if (game.player.armor >= 100) continue; // full armour: leave it
          game.player.armor = Math.min(100, game.player.armor + PICKUP_ARMOR);
          game.save.armor = game.player.armor;
          game.notify('Armour plate +' + PICKUP_ARMOR + '.');
        }
        game.audio.pickup();
        game.writeSave();
        item.active = false;
        item.timer = item.respawn;
        item.group.visible = false;
      }
    }
  }
}
