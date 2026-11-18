// BRISA BAY — HUD: DOM readouts (cash, health, stars, weapon, speed, radio,
// objective, toasts, menus) and the 2D minimap canvas with live blips for
// the player, traffic, police, the helicopter and the mission marker.
import { CITY, WANTED_MAX } from './config.js';
import { fmtMoney, fmtTime } from './utils.js';

const HUD_IDS = ['cash', 'health-fill', 'health-num', 'armor', 'stars', 'weapon', 'ammo', 'speed', 'radio', 'objective', 'toast', 'clock', 'menu', 'menu-title', 'menu-body', 'menu-hint', 'shop', 'shop-title', 'shop-items', 'damage'];

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
    //   markerPos, shops }
    this.el.cash.textContent = fmtMoney(state.cash);
    this.el['health-fill'].style.width = Math.max(0, state.health) + '%';
    this.el['health-num'].textContent = Math.max(0, Math.round(state.health));
    this.el.armor.textContent = state.armor > 0 ? 'ARMOR ' + Math.round(state.armor) : '';
    const stars = '★'.repeat(state.wanted) + '☆'.repeat(WANTED_MAX - state.wanted);
    this.el.stars.textContent = stars;
    // At three stars and up the heat pulses red — the player feels it.
    const hot = state.wanted >= 3;
    this.el.stars.style.color = hot ? '#ff5a4d' : (state.wanted > 0 ? '#ffd34d' : 'rgba(255,255,255,0.35)');
    this.el.stars.style.opacity = hot ? String(0.65 + 0.35 * Math.sin(performance.now() / 160)) : '1';
    this.el.weapon.textContent = state.weaponName;
    this.el.ammo.textContent = state.ammo === Infinity ? '∞' : String(state.ammo);
    this.el.speed.textContent = Math.round(state.speedKmh) + ' km/h';
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
