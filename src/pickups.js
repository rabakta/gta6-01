// BRISA BAY — world pickups. Glowing health crosses, armour diamonds and
// free guns at fixed spots. Walk or drive over one to take it; it comes
// back after its respawn time. Full health leaves a cross alone; a full
// gun leaves a weapon alone. (Packages are separate: one-offs, no respawn.)
import * as THREE from 'three';
import { PICKUPS, PICKUP_HEALTH, PICKUP_ARMOR, WEAPONS } from './config.js';
import { glowTexture } from './textures.js';
import { dist2 } from './utils.js';

export class PickupManager {
  constructor(scene, world) {
    this.scene = scene;
    this.items = [];
    const glowTex = glowTexture();
    for (const def of PICKUPS) {
      const group = new THREE.Group();
      const color = def.kind === 'health' ? 0x2fd47a : def.kind === 'weapon' ? 0xff8c42 : 0x4da3ff;
      let mesh;
      if (def.kind === 'health') {
        // Green cross: two bars.
        const mat = new THREE.MeshBasicMaterial({ color });
        const h1 = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 0.4), mat);
        const h2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.4, 0.4), mat);
        mesh = new THREE.Group();
        mesh.add(h1, h2);
      } else if (def.kind === 'weapon') {
        // A gun on the ground: dark body + barrel, reads as a weapon.
        const mat = new THREE.MeshBasicMaterial({ color: 0x2a2d33 });
        const b1 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 0.3), mat);
        const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.22), mat);
        b2.position.set(0.85, 0.05, 0);
        mesh = new THREE.Group();
        mesh.add(b1, b2);
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
        if (item.kind === 'weapon') {
          const w = WEAPONS[item.weapon];
          const owned = game.save.weapons[item.weapon];
          if (owned && owned.ammo >= w.ammo) continue; // full gun: leave it
          game.save.weapons[item.weapon] = { owned: true, ammo: w.ammo };
          game.save.currentWeapon = item.weapon;
          game.notify('Picked up the ' + w.name + ' — CLICK to shoot, 1/2/3 to switch.');
        } else if (item.kind === 'health') {
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
