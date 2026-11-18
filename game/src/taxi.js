// BRISA BAY v3 — taxi fares. The repeatable side activity: while Rio is
// free-roaming, a passenger offer appears at a random intersection. Drive
// up in a car and press E to pick them up, then deliver them to their
// destination before the timer runs out for cash plus a tip for speed.
// Fares keep coming as long as Rio is free-roaming; a mission pauses the
// meter. The fare state shows in the HUD objective line and as an amber
// blip on the minimap.
import * as THREE from 'three';
import { TAXI } from './config.js';
import { roadLines } from './city.js';
import { dist2, clamp } from './utils.js';

// A human name for a road spot, so the objective reads like a place
// instead of a coordinate. The city is small enough that quadrant +
// nearest landmark is all the naming it needs.
function spotName(x, z) {
  if (x >= 150 && z >= 120) return 'the Marina';
  if (x >= 150 && z <= -120) return 'the Docks';
  if (x <= -150 && z >= 120) return 'Coral Row';
  if (x <= -150 && z <= -120) return 'the Airfield';
  if (x >= 150) return 'the Beachfront';
  if (x <= -150) return 'the West End';
  if (z <= -150) return 'the North Road';
  if (z >= 150) return 'Palm Row';
  if (Math.abs(x) <= 30 && Math.abs(z) <= 30) return 'the Plaza';
  return 'Downtown';
}

export class TaxiManager {
  // `game` is the main game object (player, world, missions, audio, hud,
  // save, notify, writeSave). The scene comes from game.scene.
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.state = 'idle'; // idle | offer | riding
    // First offer 20s into free-roam; the timer only runs while free-roam.
    this.offerTimer = TAXI.firstOfferDelay;
    this.offer = null; // { x, z, name } — the waiting passenger
    this.offerAge = 0;
    this.fare = null; // { pickup, dest, fare, timer, total }
    this.beacon = null;
    this.marker = null;
    this.passenger = null;
    this.passengerMarker = null; // bobbing diamond over the passenger's head
  }

  // --- visuals --------------------------------------------------------------
  // An amber beacon + ground ring, the same language as the mission
  // marker but in taxi gold, so the player reads it as a fare at a glance.
  showBeacon(x, z) {
    this.clearBeacon();
    const geo = new THREE.CylinderGeometry(1.6, 1.6, 26, 12, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color: 0xf2a007, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
    this.beacon = new THREE.Mesh(geo, mat);
    this.beacon.position.set(x, 13, z);
    this.scene.add(this.beacon);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 3.2, 24),
      new THREE.MeshBasicMaterial({ color: 0xf2a007, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.15, z);
    this.scene.add(ring);
    this.marker = ring;
  }

  clearBeacon() {
    if (this.beacon) { this.scene.remove(this.beacon); this.beacon = null; }
    if (this.marker) { this.scene.remove(this.marker); this.marker = null; }
  }

  // The waiting passenger: a small figure in a yellow shirt, standing
  // where the fare is. They get in the car on pickup, so the mesh is
  // removed then — no ped AI, just a marker with a head.
  buildPassenger(x, z) {
    const g = new THREE.Group();
    const shirt = new THREE.MeshLambertMaterial({ color: 0xf2c230 });
    const pants = new THREE.MeshLambertMaterial({ color: 0x2b3a55 });
    const skin = new THREE.MeshLambertMaterial({ color: 0xc98d64 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.8, 0.3), shirt);
    body.position.y = 1.0;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.36), skin);
    head.position.y = 1.62;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.65, 0.24), pants);
    legL.position.set(-0.14, 0.32, 0);
    const legR = legL.clone();
    legR.position.x = 0.14;
    g.add(body, head, legL, legR);
    // Vice City-style fare marker: a small amber diamond bobbing over the
    // passenger's head, so the pickup reads from down the street.
    const marker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.35),
      new THREE.MeshBasicMaterial({ color: 0xf2a007 }),
    );
    marker.position.y = 2.6;
    g.add(marker);
    this.passengerMarker = marker;
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.passenger = g;
  }

  clearPassenger() {
    if (this.passenger) { this.scene.remove(this.passenger); this.passenger = null; }
    this.passengerMarker = null;
  }

  clearFareVisuals() {
    this.clearBeacon();
    this.clearPassenger();
  }

  // --- offers -----------------------------------------------------------------
  // Pick a random intersection at least `minDist` from the player. Twelve
  // tries, then the farthest intersection tried — the city is small and
  // every intersection is a fair fare spot, but a 0 m fare is not a fare.
  randomSpot(minDist) {
    const lines = roadLines();
    const p = this.game.player.pos;
    let spot = { x: lines[0], z: lines[0] };
    let best = spot;
    let bestD = -1;
    for (let i = 0; i < 12; i++) {
      const x = lines[Math.floor(Math.random() * lines.length)];
      const z = lines[Math.floor(Math.random() * lines.length)];
      spot = { x, z, name: spotName(x, z) };
      const d = dist2(p.x, p.z, x, z);
      if (d > bestD) { bestD = d; best = spot; }
      if (d >= minDist) return spot;
    }
    return best;
  }

  makeOffer() {
    const spot = this.randomSpot(60);
    this.offer = spot;
    this.offerAge = 0;
    this.state = 'offer';
    this.buildPassenger(spot.x, spot.z);
    this.showBeacon(spot.x, spot.z);
    this.game.notify('Taxi fare: passenger waiting at ' + spot.name + ' — drive up and press E');
  }

  // Staging helper for screenshots and tests: put an offer on the map at
  // a chosen spot, skipping the random draw.
  stageOffer(spot) {
    this.clearFareVisuals();
    this.offer = { x: spot.x, z: spot.z, name: spot.name || spotName(spot.x, spot.z) };
    this.offerAge = 0;
    this.state = 'offer';
    this.buildPassenger(this.offer.x, this.offer.z);
    this.showBeacon(this.offer.x, this.offer.z);
    return true;
  }

  // --- pickup / delivery ------------------------------------------------------
  // Called from onInteract (E). Only fires when a fare is offered, Rio is
  // in a car, and the car is on top of the passenger. Returns true when
  // the pickup happened, so the caller can skip the normal E behaviour
  // (which would otherwise exit the car).
  tryPickup() {
    if (this.state !== 'offer' || !this.offer) return false;
    const g = this.game;
    if (!g.player.inCar) return false;
    if (dist2(g.player.pos.x, g.player.pos.z, this.offer.x, this.offer.z) >= TAXI.pickupRadius) return false;
    const dest = this.randomSpot(120);
    const d = dist2(this.offer.x, this.offer.z, dest.x, dest.z);
    const fare = TAXI.baseFare + Math.round((d * TAXI.perMeter) / 5) * 5;
    const total = clamp(Math.round(d / 16), TAXI.minTime, TAXI.maxTime);
    this.fare = { pickup: this.offer, dest, fare, timer: total, total };
    this.state = 'riding';
    this.offer = null;
    this.clearPassenger(); // they get in the car
    this.showBeacon(dest.x, dest.z);
    g.audio.blip(990, 0.1, 0.15);
    g.notify('Fare aboard — ' + dest.name + ', ' + total + 's. $' + fare + ' + tip.');
    return true;
  }

  completeFare() {
    const g = this.game;
    const f = this.fare;
    const tip = Math.min(TAXI.maxTip, Math.ceil(f.timer));
    const total = f.fare + tip;
    g.save.cash += total;
    g.save.stats.faresDone++;
    g.save.stats.faresEarned += total;
    g.writeSave();
    g.audio.jingle();
    g.notify('Fare delivered! +$' + total.toLocaleString('en-US') + ' (incl. $' + tip + ' tip).');
    this.clearFareVisuals();
    this.fare = null;
    this.state = 'idle';
    this.offerTimer = TAXI.cooldown;
  }

  failFare() {
    const g = this.game;
    g.audio.fail();
    g.notify('Fare lost — too slow. The passenger walked away.');
    this.clearFareVisuals();
    this.fare = null;
    this.state = 'idle';
    this.offerTimer = TAXI.cooldown;
  }

  // Staging helper: jump straight to a fare in progress, for screenshots
  // and tests. `pickup` and `dest` are {x, z, name?}; `seconds` is the
  // delivery timer.
  stageRide(pickup, dest, seconds) {
    this.clearFareVisuals();
    const p = { x: pickup.x, z: pickup.z, name: pickup.name || spotName(pickup.x, pickup.z) };
    const d = { x: dest.x, z: dest.z, name: dest.name || spotName(dest.x, dest.z) };
    const dist = dist2(p.x, p.z, d.x, d.z);
    this.fare = {
      pickup: p,
      dest: d,
      fare: TAXI.baseFare + Math.round((dist * TAXI.perMeter) / 5) * 5,
      timer: seconds,
      total: seconds,
    };
    this.state = 'riding';
    this.showBeacon(d.x, d.z);
    return true;
  }

  // --- HUD ----------------------------------------------------------------------
  objectiveText() {
    if (this.state === 'offer' && this.offer) {
      return 'TAXI: pick up the fare at ' + this.offer.name + ' — drive up in your cab';
    }
    if (this.state === 'riding' && this.fare) {
      return 'TAXI: ' + this.fare.dest.name + ' — ' + Math.max(0, Math.ceil(this.fare.timer)) + 's ($' + this.fare.fare + ' + tip)';
    }
    return null;
  }

  // Amber blip for the minimap: the passenger while offered, the
  // destination while riding.
  minimapBlip() {
    if (this.state === 'offer' && this.offer) return { x: this.offer.x, z: this.offer.z };
    if (this.state === 'riding' && this.fare) return { x: this.fare.dest.x, z: this.fare.dest.z };
    return null;
  }

  // --- per-frame ------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    // Fares only run in free-roam play. A mission pauses the meter: the
    // offer timer freezes, an active fare waits for the mission to end.
    if (g.state !== 'playing' || g.missions.state === 'active') return;
    if (this.beacon) {
      this.beacon.rotation.y += dt * 0.8;
      this.beacon.material.opacity = 0.22 + Math.sin(performance.now() / 300) * 0.08;
    }
    // The fare marker bobs and spins over the waiting passenger.
    if (this.passenger && this.passengerMarker) {
      this.passengerMarker.position.y = 2.6 + Math.sin(performance.now() / 300) * 0.15;
      this.passengerMarker.rotation.y += dt * 2;
    }
    if (this.state === 'idle') {
      this.offerTimer -= dt;
      if (this.offerTimer <= 0) this.makeOffer();
    } else if (this.state === 'offer') {
      this.offerAge += dt;
      if (this.offerAge > TAXI.offerExpiry) {
        this.clearFareVisuals();
        this.offer = null;
        this.state = 'idle';
        this.offerTimer = TAXI.cooldown;
        g.notify('The fare found another cab.');
      }
    } else if (this.state === 'riding') {
      const f = this.fare;
      f.timer -= dt;
      if (f.timer <= 0) { this.failFare(); return; }
      const p = g.player;
      if (p.inCar && dist2(p.pos.x, p.pos.z, f.dest.x, f.dest.z) < TAXI.destRadius) {
        this.completeFare();
      }
    }
  }
}
