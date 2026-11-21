// BRISA BAY — side activities: rampage, stunt jumps, vigilante, payphone.
// Repeatable cash jobs outside the story missions (Vice City gap #3).
// No new per-frame systems: one update() that is a handful of dist2
// checks plus timer math, markers reused across jobs, kills counted by
// polling dead flags. Rampage targets are role 'gang' (VEX BOYS), never
// 'guard', so their kills route to onGangHit and can never inflate a
// story mission's eliminate count.
import * as THREE from 'three';
import { dist2 } from './utils.js';
import { GANGS } from './config.js';
import { Ped } from './pedestrians.js';
import { resolveCircleCollisions } from './city.js';
import { signTexture } from './textures.js';

const RAMPAGE = { x: -180, z: -180, count: 6, seconds: 60, perKill: 100, bonus: 300, cool: 60 };
const JUMPS = [
  { x: -60, z: 0, heading: Math.PI / 2 },
  { x: 180, z: -60, heading: Math.PI },
  { x: -120, z: 120, heading: -Math.PI / 2 },
];
const JUMP_TIERS = [[30, 500], [24, 300], [18, 150]];
const VIG = { x: 180, z: -150, seconds: 90, reward: 600, cool: 120 };
const PHONE = { x: -138, z: 150 };
const PHONE_JOB = [
  { x: 180, z: 120, text: 'Pick up the parcel at the Marina' },
  { x: 180, z: -150, text: 'Deliver it to the Docks' },
];
const PHONE_REWARD = 350;
const GOLD = 0xffd34d;

function ringMesh(rIn, rOut, color, opacity = 0.8) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(rIn, rOut, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide }),
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}

function signPost(scene, x, z, text, bg) {
  const post = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 3, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.9 }),
  );
  post.position.set(x, 1.5, z);
  scene.add(post);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 1.75),
    new THREE.MeshBasicMaterial({ map: signTexture(text, bg, '#fff') }),
  );
  sign.position.set(x, 3.4, z);
  sign.rotation.y = Math.PI / 4;
  scene.add(sign);
}

export class SideManager {
  constructor(game) {
    this.game = game;
    this.job = null; // { kind, ... } — only one side job runs at a time
    this.vigTarget = null; // vigilante getaway car, in allCars() via main.js
    this.cool = { rampage: 0, vig: 0, phone: 0 };
    this.ringTimer = 0;
    this.jumps = JUMPS.map((j) => ({ ...j, cool: 0 }));
    const s = game.scene;
    // Shared job marker: gold ring + tall beacon, repositioned per job.
    this.marker = ringMesh(3, 4.2, GOLD);
    this.marker.position.set(0, 0.15, 0);
    this.marker.visible = false;
    s.add(this.marker);
    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, 40, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.beacon.position.set(0, 20, 0);
    this.beacon.visible = false;
    s.add(this.beacon);
    // Rampage post: ring + sign at the Airfield, VEX BOYS turf.
    const rp = ringMesh(3, 4.2, 0xd21f2b);
    rp.position.set(RAMPAGE.x, 0.15, RAMPAGE.z);
    s.add(rp);
    signPost(s, RAMPAGE.x + 5, RAMPAGE.z, 'RAMPAGE', '#8b0000');
    // Vigilante tip board at the Docks.
    const vp = ringMesh(3, 4.2, 0x4d9fff);
    vp.position.set(VIG.x, 0.15, VIG.z);
    s.add(vp);
    signPost(s, VIG.x - 5, VIG.z, 'BCPD TIP', '#1d2733');
    // Payphone booth by the Safehouse.
    const booth = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 2.6, 1),
      new THREE.MeshStandardMaterial({ color: 0x274b63, roughness: 0.7, metalness: 0.2 }),
    );
    booth.position.set(PHONE.x, 1.3, PHONE.z);
    s.add(booth);
    const psign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 0.6),
      new THREE.MeshBasicMaterial({ map: signTexture('PAYPHONE', '#274b63', '#ffd98a') }),
    );
    psign.position.set(PHONE.x, 2.9, PHONE.z);
    psign.rotation.y = Math.PI / 2;
    s.add(psign);
    const pr = ringMesh(1.6, 2.2, GOLD);
    pr.position.set(PHONE.x, 0.15, PHONE.z);
    s.add(pr);
    // Stunt jump ramps: a gold ring plus a tilted launch lip on the road.
    for (const j of this.jumps) {
      const r = ringMesh(3, 4.2, GOLD, 0.55);
      r.position.set(j.x, 0.15, j.z);
      s.add(r);
      const group = new THREE.Group();
      group.position.set(j.x, 0, j.z);
      group.rotation.y = j.heading;
      const lip = new THREE.Mesh(
        new THREE.BoxGeometry(5, 0.8, 4),
        new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 }),
      );
      lip.rotation.x = -0.35; // +Z end up: the launch lip
      lip.position.y = 0.7;
      group.add(lip);
      s.add(group);
    }
  }

  // --- money ---------------------------------------------------------------
  pay(amount, done) {
    const g = this.game;
    g.save.cash += amount;
    g.save.stats.sideEarned = (g.save.stats.sideEarned || 0) + amount;
    if (done) g.save.stats.sideDone = (g.save.stats.sideDone || 0) + 1;
  }

  showMarker(x, z) {
    this.marker.position.set(x, 0.15, z);
    this.marker.visible = true;
    this.beacon.position.set(x, 20, z);
    this.beacon.visible = true;
  }

  hideMarker() {
    this.marker.visible = false;
    this.beacon.visible = false;
  }

  // --- interaction ---------------------------------------------------------
  near(x, z, r) {
    const p = this.game.player.pos;
    return dist2(p.x, p.z, x, z) < r;
  }

  prompt() {
    if (this.job || this.game.player.inCar) return null;
    if (this.cool.rampage <= 0 && this.near(RAMPAGE.x, RAMPAGE.z, 6)) return 'Start the Rampage ($900 max)';
    if (this.cool.vig <= 0 && this.near(VIG.x, VIG.z, 6)) return 'Take the vigilante tip ($600)';
    if (this.cool.phone <= 0 && this.near(PHONE.x, PHONE.z, 4)) return 'Answer the payphone';
    return null;
  }

  tryInteract() {
    if (this.job || this.game.player.inCar) return false;
    if (this.cool.rampage <= 0 && this.near(RAMPAGE.x, RAMPAGE.z, 6)) { this.startRampage(); return true; }
    if (this.cool.vig <= 0 && this.near(VIG.x, VIG.z, 6)) { this.startVigilante(); return true; }
    if (this.cool.phone <= 0 && this.near(PHONE.x, PHONE.z, 4)) { this.startPhone(); return true; }
    return false;
  }

  // --- rampage ---------------------------------------------------------------
  startRampage() {
    const g = this.game;
    const gang = GANGS[0]; // VEX BOYS hold the Airfield
    const targets = [];
    for (let i = 0; i < RAMPAGE.count; i++) {
      const a = (i / RAMPAGE.count) * Math.PI * 2;
      const x = RAMPAGE.x + Math.sin(a) * 14, z = RAMPAGE.z + Math.cos(a) * 14;
      const p = new Ped(g.scene, x, z, { hostile: true, role: 'gang', health: 80, shirt: gang.color, hat: false });
      resolveCircleCollisions(g.world.colliders, p.pos, 0.6);
      p.gang = gang;
      p.turf = gang;
      p.aggro = 60;
      p.armed = true;
      p.targetPos = g.player.pos; // chase Rio, wherever he runs
      g.peds.peds.push(p);
      targets.push(p);
    }
    this.job = { kind: 'rampage', targets, kills: 0, timer: RAMPAGE.seconds };
    this.showMarker(RAMPAGE.x, RAMPAGE.z);
    g.notify('RAMPAGE — drop all 6 VEX BOYS! 60 seconds, $100 a head.');
    g.audio.blip(880, 0.15, 0.25);
  }

  updateRampage(dt) {
    const g = this.game;
    const j = this.job;
    j.timer -= dt;
    for (const t of j.targets) {
      if (t.dead && !t.counted) {
        t.counted = true;
        j.kills++;
        this.pay(RAMPAGE.perKill, false);
        g.audio.blip(1320, 0.1, 0.2);
      }
    }
    if (j.kills >= j.targets.length) {
      this.pay(RAMPAGE.bonus, true);
      g.notify('Rampage cleared! +$' + RAMPAGE.bonus + ' bonus.');
      this.endJob(RAMPAGE.cool, 'rampage');
      return;
    }
    if (j.timer <= 0) {
      this.removePeds(j.targets);
      g.notify('Rampage over — ' + j.kills + '/' + j.targets.length + ' down.');
      this.endJob(RAMPAGE.cool, 'rampage');
    }
  }

  removePeds(list) {
    const g = this.game;
    for (const p of list) {
      if (!p.dead) g.scene.remove(p.mesh);
    }
    g.peds.peds = g.peds.peds.filter((p) => !list.includes(p));
  }

  // --- stunt jumps -----------------------------------------------------------
  updateJumps(dt) {
    const g = this.game;
    const car = g.player.inCar;
    if (!car) return;
    for (const j of this.jumps) {
      if (j.cool > 0) { j.cool -= dt; continue; }
      const speed = Math.abs(car.speed);
      if (speed < JUMP_TIERS[2][0]) continue;
      if (dist2(car.pos.x, car.pos.z, j.x, j.z) >= 6) continue;
      let award = 0;
      for (const [min, cash] of JUMP_TIERS) if (speed >= min) { award = cash; break; }
      if (!award) continue;
      if (typeof car.hop === 'function') car.hop(); // boats have no hop
      this.pay(award, true);
      g.particles.burst({ x: car.pos.x, y: 1, z: car.pos.z }, 20, new THREE.Color(0xffd34d), 6, 0.6);
      g.audio.blip(1500, 0.15, 0.3);
      g.notify('STUNT JUMP! ' + Math.round(speed * 3.6) + ' km/h over the ramp — +$' + award);
      j.cool = 20;
    }
  }

  // --- vigilante -------------------------------------------------------------
  startVigilante() {
    const g = this.game;
    const car = g.spawnCar('vento', 0x8e2f32, VIG.x, VIG.z - 40, Math.PI);
    car.kind = 'vigilante';
    car.ai = { axis: 'x', dir: 1, targetSpeed: 16, wait: 0 };
    this.vigTarget = car;
    this.job = { kind: 'vigilante', timer: VIG.seconds };
    g.notify('VIGILANTE — a VEX getaway car is running the Docks. Wreck it! $600.');
    g.audio.blip(880, 0.15, 0.25);
  }

  updateVigilante(dt) {
    const g = this.game;
    const j = this.job;
    const car = this.vigTarget;
    j.timer -= dt;
    if (g.player.inCar === car) {
      // Rio jacked the getaway car — the job is blown, it becomes traffic.
      car.kind = 'traffic';
      car.ai = { axis: 'x', dir: 1, targetSpeed: 10, wait: 0 };
      g.traffic.cars.push(car);
      this.vigTarget = null;
      g.notify('You jacked the getaway car — the job is blown.');
      this.endJob(VIG.cool, 'vig');
      return;
    }
    if (!car || car.dead) {
      this.pay(VIG.reward, true);
      if (car) g.scene.remove(car.mesh);
      this.vigTarget = null;
      g.notify('Getaway car wrecked! +$' + VIG.reward);
      this.endJob(VIG.cool, 'vig');
      return;
    }
    g.trafficLikeDrive(car, dt, 16);
    this.showMarker(car.pos.x, car.pos.z);
    const d = dist2(car.pos.x, car.pos.z, g.player.pos.x, g.player.pos.z);
    if (j.timer <= 0 || d > 200) {
      g.scene.remove(car.mesh);
      this.vigTarget = null;
      g.notify(j.timer <= 0 ? 'The getaway car got away.' : 'You lost the getaway car.');
      this.endJob(VIG.cool, 'vig');
    }
  }

  // --- payphone --------------------------------------------------------------
  startPhone() {
    const g = this.game;
    this.job = { kind: 'phone', step: 0 };
    this.showMarker(PHONE_JOB[0].x, PHONE_JOB[0].z);
    g.notify('Payphone job: ' + PHONE_JOB[0].text);
    g.audio.blip(1200, 0.12, 0.2);
  }

  updatePhone() {
    const g = this.game;
    const j = this.job;
    const step = PHONE_JOB[j.step];
    const p = g.player.pos;
    if (dist2(p.x, p.z, step.x, step.z) < 8) {
      j.step++;
      if (j.step >= PHONE_JOB.length) {
        this.pay(PHONE_REWARD, true);
        g.notify('Delivered. +$' + PHONE_REWARD + ' — the voice says thanks.');
        this.endJob(90, 'phone');
        return;
      }
      const next = PHONE_JOB[j.step];
      this.showMarker(next.x, next.z);
      g.notify('Payphone job: ' + next.text);
      g.audio.blip(1200, 0.12, 0.2);
    }
  }

  endJob(cool, key) {
    this.cool[key] = cool;
    this.job = null;
    this.hideMarker();
  }

  // --- HUD -------------------------------------------------------------------
  hudLine() {
    const j = this.job;
    if (!j) return '';
    if (j.kind === 'rampage') return 'RAMPAGE ' + j.kills + '/' + j.targets.length + ' · ' + Math.ceil(j.timer) + 's';
    if (j.kind === 'vigilante') return 'VIGILANTE · ' + Math.ceil(j.timer) + 's';
    const step = PHONE_JOB[j.step];
    return 'PHONE · ' + (step ? step.text : '');
  }

  // --- frame -----------------------------------------------------------------
  update(dt) {
    for (const k of Object.keys(this.cool)) if (this.cool[k] > 0) this.cool[k] -= dt;
    if (this.marker.visible) {
      this.beacon.rotation.y += dt * 0.8;
      this.beacon.material.opacity = 0.22 + Math.sin(performance.now() / 300) * 0.08;
      const s = 1 + Math.sin(performance.now() / 300) * 0.08;
      this.marker.scale.set(s, s, 1);
    }
    this.updateJumps(dt);
    const j = this.job;
    if (!j) {
      // The payphone rings when Rio is near the Safehouse and the line is free.
      if (this.cool.phone <= 0 && this.near(PHONE.x, PHONE.z, 80)) {
        this.ringTimer -= dt;
        if (this.ringTimer <= 0) {
          this.ringTimer = 30;
          this.game.notify('The payphone by the Safehouse is ringing…');
          this.game.audio.blip(1568, 0.2, 0.2);
        }
      }
      return;
    }
    if (j.kind === 'rampage') this.updateRampage(dt);
    else if (j.kind === 'vigilante') this.updateVigilante(dt);
    else if (j.kind === 'phone') this.updatePhone(dt);
  }
}
