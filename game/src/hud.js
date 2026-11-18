// BRISA BAY v4 — HUD: DOM readouts (cash, health, stars, weapon, speed,
// radio, objective, toasts, menus) and the 2D minimap canvas with live
// blips for the player, traffic, police, the helicopter, the mission
// marker, world pickups, police roadblocks and taxi fares. v3 adds the
// amber fare blip (a $ in a gold circle). v4 adds cyan bus-stop squares.
// v2 also shows the garage upgrade levels under the vitals, so a tuned
// ride is always visible.
import { CITY, WANTED_MAX } from './config.js';
import { fmtMoney, fmtTime } from './utils.js';

const HUD_IDS = ['cash', 'health-fill', 'health-num', 'armor', 'mods', 'stars', 'weapon', 'ammo', 'speed', 'radio', 'objective', 'toast', 'clock', 'menu', 'menu-title', 'menu-body', 'menu-hint', 'shop', 'shop-title', 'shop-items', 'damage'];

export class HUD {
  constructor(world) {
    this.world = world;
    this.el = {};
    for (const id of HUD_IDS) this.el[id] = document.getElementById(id);
    this.map = document.getElementById('minimap');
    this.mapCtx = this.map.getContext('2d');
    this.toastTimer = 0;
    this.damageFlash = 0;
  }

  showMenu(kind, title, body, hint) {
    this.el.menu.style.display = 'flex';
    this.el['menu-title'].textContent = title;
    this.el['menu-body'].innerHTML = body;
    this.el['menu-hint'].textContent = hint || '';
    this.el.menu.dataset.kind = kind;
  }
  hideMenu() { this.el.menu.style.display = 'none'; }

  showShop(title, itemsHtml) {
    this.el.shop.style.display = 'block';
    this.el['shop-title'].textContent = title;
    this.el['shop-items'].innerHTML = itemsHtml;
  }
  hideShop() { this.el.shop.style.display = 'none'; }

  notify(text) {
    this.el.toast.textContent = text;
    this.el.toast.style.opacity = '1';
    this.toastTimer = 4;
  }

  flashDamage() {
    this.damageFlash = 0.55;
    this.el.damage.style.opacity = '0.55';
  }

  update(dt, state) {
    // state: { cash, health, armor, wanted, weaponName, ammo, speedKmh,
    //   radio, objective, clockSec, player, cars, police, heliPos,
    //   markerPos, shops, pickups, roadblocks, mods, fare, busStops }
    this.el.cash.textContent = fmtMoney(state.cash);
    this.el['health-fill'].style.width = Math.max(0, state.health) + '%';
    this.el['health-num'].textContent = Math.max(0, Math.round(state.health));
    this.el.armor.textContent = state.armor > 0 ? 'ARMOR ' + Math.round(state.armor) : '';
    // Garage mods: short tags, only when something is fitted.
    const mods = state.mods || { armor: 0, engine: 0, tires: 0 };
    const tags = [];
    if (mods.armor > 0) tags.push('ARMOUR ' + mods.armor);
    if (mods.engine > 0) tags.push('ENGINE ' + mods.engine);
    if (mods.tires > 0) tags.push('TYRES ' + mods.tires);
    this.el.mods.textContent = tags.length > 0 ? 'MODS: ' + tags.join(' · ') : '';
    const stars = '★'.repeat(state.wanted) + '☆'.repeat(WANTED_MAX - state.wanted);
    this.el.stars.textContent = stars;
    // At three stars and up the heat pulses red — the player feels it.
    const hot = state.wanted >= 3;
    this.el.stars.style.color = hot ? '#ff5a4d' : (state.wanted > 0 ? '#ffd34d' : 'rgba(255,255,255,0.35)');
    this.el.stars.style.opacity = hot ? String(0.65 + 0.35 * Math.sin(performance.now() / 160)) : '1';
    this.el.weapon.textContent = state.weaponName;
    this.el.ammo.textContent = state.ammo === Infinity ? '∞' : String(state.ammo);
    this.el.speed.textContent = Math.round(state.speedKmh) + ' km/h' +
      (state.carHealth != null ? '  ·  CAR ' + Math.max(0, Math.round(state.carHealth)) : '');
    this.el.radio.textContent = '♪ ' + state.radio;
    this.el.objective.textContent = state.objective;
    this.el.clock.textContent = fmtTime(state.clockSec);
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.style.opacity = '0';
    }
    if (this.damageFlash > 0) {
      this.damageFlash -= dt;
      this.el.damage.style.opacity = String(Math.max(0, this.damageFlash));
    }
    this.drawMinimap(state);
  }

  drawMinimap(state) {
    const ctx = this.mapCtx;
    const S = this.map.width; // 220
    const half = CITY.half + 30;
    const toMap = (x, z) => [((x + half) / (half * 2)) * S, ((z + half) / (half * 2)) * S];
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(12, 18, 26, 0.82)';
    ctx.fillRect(0, 0, S, S);
    // Sea on the east edge, beach strip beside it.
    const [seaX] = toMap(CITY.beachEnd, 0);
    ctx.fillStyle = '#1e6f8e';
    ctx.fillRect(seaX, 0, S - seaX, S);
    const [beachX] = toMap(CITY.half, 0);
    ctx.fillStyle = '#d9b380';
    ctx.fillRect(beachX, 0, seaX - beachX, S);
    // North marker.
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 11px Arial, sans-serif';
    ctx.fillText('N', 6, 14);
    // Roads.
    ctx.strokeStyle = 'rgba(220, 220, 210, 0.75)';
    ctx.lineWidth = 2;
    for (const l of this.world.roads) {
      const [x] = toMap(l, 0);
      const [, z] = toMap(0, l);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, z); ctx.lineTo(S, z); ctx.stroke();
    }
    // Shops (green squares) and the safehouse (gold dot).
    ctx.fillStyle = '#7ee2a8';
    for (const s of this.world.shops) {
      const [x, z] = toMap(s.x, s.z);
      ctx.fillRect(x - 3, z - 3, 6, 6);
    }
    const sh = this.world.places.safehouse;
    const [hx, hz] = toMap(sh.x, sh.z);
    ctx.fillStyle = '#ffd34d';
    ctx.beginPath(); ctx.arc(hx, hz, 5, 0, Math.PI * 2); ctx.fill();
    // v4: bus stops — cyan squares, so a rider can find the next stop.
    ctx.fillStyle = '#4fd8ff';
    for (const s of this.world.busStops || []) {
      const [x, z] = toMap(s.x, s.z);
      ctx.fillRect(x - 3, z - 3, 6, 6);
    }
    // v2: world pickups — green crosses for health, blue diamonds for armour.
    for (const p of state.pickups || []) {
      const [x, z] = toMap(p.x, p.z);
      ctx.fillStyle = p.kind === 'health' ? '#2fd47a' : '#4da3ff';
      if (p.kind === 'health') {
        ctx.fillRect(x - 1, z - 4, 2, 8);
        ctx.fillRect(x - 4, z - 1, 8, 2);
      } else {
        ctx.beginPath();
        ctx.moveTo(x, z - 4); ctx.lineTo(x + 4, z); ctx.lineTo(x, z + 4); ctx.lineTo(x - 4, z);
        ctx.closePath(); ctx.fill();
      }
    }
    // v2: police roadblocks — red bars across the road.
    ctx.fillStyle = '#ff5a4d';
    for (const b of state.roadblocks || []) {
      const [x, z] = toMap(b.x, b.z);
      ctx.save();
      ctx.translate(x, z);
      ctx.rotate(b.heading);
      ctx.fillRect(-6, -1.5, 12, 3);
      ctx.restore();
    }
    // Objective marker (pulsing gold ring).
    if (state.markerPos) {
      const [mx, mz] = toMap(state.markerPos.x, state.markerPos.z);
      const r = 5 + Math.sin(performance.now() / 200) * 2;
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(mx, mz, r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffd34d';
      ctx.beginPath(); ctx.arc(mx, mz, 2.5, 0, Math.PI * 2); ctx.fill();
    }
    // Traffic cars (grey dots), police (blue squares).
    for (const c of state.cars) {
      if (c.dead) continue;
      const [x, z] = toMap(c.pos.x, c.pos.z);
      ctx.fillStyle = c.kind === 'police' ? '#4da3ff' : 'rgba(200,200,200,0.8)';
      ctx.fillRect(x - 2, z - 2, 4, 4);
    }
    // v3: taxi fare — an amber circle with a $ in it, at the passenger
    // while offered, at the destination while riding. Drawn after the
    // traffic so a car dot never hides it. Collectible packages are
    // deliberately NOT on the map: finding them is the game.
    if (state.fare) {
      const [fx, fz] = toMap(state.fare.x, state.fare.z);
      const pulse = 5 + Math.sin(performance.now() / 200) * 1.5;
      ctx.fillStyle = '#f2a007';
      ctx.beginPath(); ctx.arc(fx, fz, pulse, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1d2733';
      ctx.font = 'bold 9px Arial, sans-serif';
      ctx.fillText('$', fx - 2.5, fz + 3);
    }
    // Police helicopter: a blue ring with a dot, so it reads at a glance.
    if (state.heliPos) {
      const [x, z] = toMap(state.heliPos.x, state.heliPos.z);
      ctx.strokeStyle = '#4da3ff';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, z, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#4da3ff';
      ctx.beginPath(); ctx.arc(x, z, 2, 0, Math.PI * 2); ctx.fill();
    }
    // Player arrow (rotates with heading).
    const [px, pz] = toMap(state.player.x, state.player.z);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(Math.atan2(Math.sin(state.player.heading), -Math.cos(state.player.heading)));
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
