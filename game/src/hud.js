// BRISA BAY — HUD: DOM readouts (cash, health, stars, weapon, speed, radio,
// objective, toasts, menus) and the 2D minimap with live blips for the
// player, traffic, police, helicopter, mission marker, pickups, roadblocks,
// taxi fares and gang turf. Garage upgrade levels show under the vitals.
// v8: the screens (start, pause, WASTED/BUSTED, mission splash), the
// objective banner, the interaction prompt, the armour bar, money and radio
// flashes and the low-health pulse — all built here, so index.html stays
// untouched and the dossier never sees a byte of it.
import { CITY, WANTED_MAX, STORY_INTRO, MISSION_META, WEAPONS } from './config.js';
import { fmtMoney, fmtTime } from './utils.js';

// Driving gear from signed speed (m/s) and the car's top speed: R rolling
// back, N at a standstill, then 1..5 up the speed range.
export function gearFor(speed, top) {
  if (speed < -0.5) return 'R';
  if (Math.abs(speed) < 0.5) return 'N';
  if (!top || top <= 0) return '1';
  return String(Math.min(5, 1 + Math.floor((Math.abs(speed) / top) * 5)));
}

// v8 chrome: menu buttons, volume rows, prompt, banner, splash, armour bar
// and the radio flash. Injected as one <style> at boot; index.html keeps
// only the base layout it already had.
const HUD_CSS = [
  '.bb-btn{display:inline-block;margin:8px 6px 0;padding:11px 22px;background:#1d2733;color:#fff;border:1px solid #4a6fa5;border-radius:8px;cursor:pointer;font:700 15px Arial,sans-serif}',
  '.bb-btn:hover{background:#2b3a55}',
  '.bb-btn.gold{background:#8a6420;border-color:#ffd34d}',
  '.bb-vol{display:flex;align-items:center;gap:10px;justify-content:center;margin:8px 0;font-size:14px}',
  '.bb-vol input{width:180px}',
  '.bb-ctrl{color:#bcd6ea;font-size:13px;line-height:1.7;text-align:left;display:inline-block}',
  '#prompt{top:116px;left:50%;transform:translateX(-50%);font-size:15px;background:rgba(10,16,24,0.78);padding:7px 16px;border-radius:8px;opacity:0;transition:opacity .25s;white-space:nowrap;color:#ffd98a}',
  '#banner{top:150px;left:50%;transform:translateX(-50%);font-size:19px;font-weight:800;color:#ffd34d;background:rgba(10,16,24,0.8);padding:10px 20px;border:1px solid rgba(255,211,77,0.6);border-radius:8px;opacity:0;transition:opacity .3s;white-space:nowrap}',
  '#splash{position:fixed;inset:0;z-index:11;display:none;align-items:center;justify-content:center;pointer-events:none;text-align:center;color:#fff}',
  '#splash .big{font-size:72px;font-weight:900;letter-spacing:8px;text-shadow:0 4px 0 rgba(0,0,0,0.6),0 10px 30px rgba(0,0,0,0.8)}',
  '#splash .sub{font-size:18px;margin-top:8px;text-shadow:0 1px 4px rgba(0,0,0,0.9)}',
  '#splash .stat{font-size:15px;margin-top:4px;color:#ffe9c9;text-shadow:0 1px 4px rgba(0,0,0,0.9)}',
  '#armor-bar{width:220px;height:9px;background:rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.4);border-radius:4px;overflow:hidden;margin-top:3px}',
  '#armor-fill{height:100%;width:0%;background:linear-gradient(90deg,#2f7fc9,#7ec2f2)}',
  '#radio-flash{top:200px;left:50%;transform:translateX(-50%);font-size:26px;font-weight:900;color:#ffd98a;opacity:0;transition:opacity .3s;text-shadow:0 2px 8px rgba(0,0,0,0.9)}',
  '#health-bar.low #health-fill{background:linear-gradient(90deg,#c92f2f,#ff6b5e)}',
  '#health-bar.hit{box-shadow:0 0 0 2px rgba(255,60,40,0.9)}',
  '#cash.gain{color:#b8ffd0}',
  '#ammo.low{color:#ff5a4d;font-weight:900}',
].join('\n');

const HUD_IDS = ['cash', 'health-fill', 'health-num', 'armor', 'mods', 'stars', 'weapon', 'ammo', 'weapons', 'speed', 'radio', 'objective', 'toast', 'clock', 'menu', 'menu-title', 'menu-body', 'menu-hint', 'shop', 'shop-title', 'shop-items', 'damage'];

// Weapon slots: owned weapons with switch keys, current highlighted.
export function weaponSlotList(weapons, current) {
  const defs = [['fists', 'FISTS', '0'], ['pistol', 'P9', '1'], ['smg', 'SMG', '2'], ['shotgun', 'BOOM', '3']];
  return defs.filter(([k]) => k === 'fists' || (weapons && weapons[k]))
    .map(([k, label, key]) => ({ key: k, label, hotkey: key, on: k === current }));
}

export class HUD {
  constructor(world) {
    this.world = world;
    this.el = {};
    for (const id of HUD_IDS) this.el[id] = document.getElementById(id);
    this.map = document.getElementById('minimap');
    this.mapCtx = this.map.getContext('2d');
    this.toastTimer = 0;
    this.damageFlash = 0;
    this.weaponSig = '';
    this.touch = null;
    this.lastCash = null;
    this.lastRadio = '';
    this.radioTimer = 0;
    this.bannerTimer = 0;
    this.splashTimer = 0;
    this.toastQueue = [];
    this.lastHealth = null;
    this.cashTimer = 0;
    this.hitTimer = 0;
    this.menuActions = {};
    this.injectUi();
  }

  // Builds the v8 chrome once: the style block, the prompt / banner /
  // splash / radio-flash layers, the armour bar under the health bar, and
  // the menu's click + slider delegation (buttons carry data-act, sliders
  // carry data-vol, so no per-button wiring is ever needed).
  injectUi() {
    const st = document.createElement('style');
    st.textContent = HUD_CSS;
    document.head.appendChild(st);
    const mk = (id, cls) => {
      const el = document.createElement('div');
      el.id = id;
      if (cls) el.className = cls;
      document.body.appendChild(el);
      return el;
    };
    this.promptEl = mk('prompt', 'panel');
    this.bannerEl = mk('banner', 'panel');
    this.radioEl = mk('radio-flash', 'panel');
    this.splashEl = mk('splash');
    const hb = document.getElementById('health-bar');
    this.healthBar = hb;
    const bar = document.createElement('div');
    bar.id = 'armor-bar';
    this.armorFill = document.createElement('div');
    this.armorFill.id = 'armor-fill';
    bar.appendChild(this.armorFill);
    hb.parentNode.insertBefore(bar, hb.nextSibling);
    const card = document.getElementById('menu-card');
    card.addEventListener('click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b) return;
      if (b.dataset.act === 'controls') {
        const c = card.querySelector('#pause-controls');
        if (c) c.style.display = c.style.display === 'none' ? 'block' : 'none';
        return;
      }
      const fn = this.menuActions[b.dataset.act];
      if (fn) fn();
    });
    card.addEventListener('input', (e) => {
      const t = e.target;
      if (t && t.dataset && t.dataset.vol && this.menuActions.onVolume) {
        this.menuActions.onVolume(t.dataset.vol, +t.value);
      }
    });
  }

  bindTouch(touch) { this.touch = touch; }

  showMenu(kind, title, body, hint, actions) {
    this.el.menu.style.display = 'flex';
    this.el['menu-title'].textContent = title;
    this.el['menu-body'].innerHTML = body;
    this.el['menu-hint'].textContent = hint || '';
    this.el.menu.dataset.kind = kind;
    this.menuActions = actions || {};
  }
  hideMenu() { this.el.menu.style.display = 'none'; }

  // Start screen: story, controls, next mission, save line, and real
  // buttons — tap to start works on a phone, Enter/N/C still work on keys.
  showStartScreen(d, cb) {
    const next = d.next
      ? '<p class="next">Next mission: <b>' + d.next.name + '</b> — ' + d.next.brief + '</p>'
      : '<p class="next">Story complete. Free roam, Rio.</p>';
    const save = d.hasSave
      ? 'Save found: ' + fmtMoney(d.cash) + ' - chapter ' + d.chapter + ' of ' + d.total + '.'
      : 'No save yet.';
    const ledger = (d.pkgs > 0 || d.fares > 0)
      ? '<p class="save-line">Packages ' + d.pkgs + '/20 · Taxi fares ' + d.fares + ' · Fare cash ' + fmtMoney(d.faresEarned) + '</p>' : '';
    const btns = (d.hasSave ? '<button class="bb-btn gold" data-act="continue">Continue</button>' : '') +
      '<button class="bb-btn" data-act="new">New Game</button>';
    this.el['menu-title'].style.color = '';
    this.showMenu('start', 'BRISA BAY',
      '<p class="story">' + STORY_INTRO.join('<br>') + '</p>' +
      '<p class="controls">WASD drive / walk · SHIFT run · E enter car / shop · F punch · CLICK shoot · 0-3 weapons<br>' +
      'H horn · Q radio on/off · R radio · M next mission · P pause · SPACE jump · Mouse drag: camera<br>' +
      'Touch: left stick to move · ENTER / SHOOT / JUMP / WEAPON buttons</p>' +
      next + '<p class="save-line">' + save + '</p>' + ledger +
      '<div class="bb-btnrow">' + btns + '</div>',
      'ENTER — Continue · N — New game · or tap a button',
      { continue: cb.onContinue, new: cb.onNew });
  }

  // Pause menu: resume, restart the mission, a controls sheet, volume
  // sliders, and back to the start screen. The game stays frozen behind it.
  showPause(vol, cb) {
    this.showMenu('pause', 'PAUSED',
      '<p>Take a breath, Rio. The city waits.</p>' +
      '<div class="bb-btnrow">' +
      '<button class="bb-btn gold" data-act="resume">Resume</button>' +
      '<button class="bb-btn" data-act="restart">Restart Mission</button>' +
      '<button class="bb-btn" data-act="controls">Controls</button>' +
      '<button class="bb-btn" data-act="menu">Main Menu</button></div>' +
      '<div id="pause-controls" style="display:none;margin-top:10px"><span class="bb-ctrl">' +
      'WASD move · SHIFT run · SPACE jump / handbrake · E enter car · F punch<br>' +
      'CLICK shoot · 0-3 weapons · R radio · Q radio on/off · M next mission · P resume<br>' +
      'Touch: left stick + ENTER / SHOOT / JUMP / WEAPON buttons</span></div>' +
      '<div class="bb-vol">Master <input type="range" min="0" max="1" step="0.05" value="' + vol.volume + '" data-vol="master"></div>' +
      '<div class="bb-vol">Radio <input type="range" min="0" max="1" step="0.05" value="' + vol.radio + '" data-vol="radio"></div>',
      'P / ESC — resume',
      { resume: cb.onResume, restart: cb.onRestart, menu: cb.onMenu, onVolume: cb.onVolume });
  }

  // WASTED / BUSTED in the big red style, with the run's stats so the
  // death costs something the player can read at a glance.
  showDeath(kind, lost, stats, cb) {
    const bill = kind === 'WASTED' ? 'Hospital bill: ' : 'Bail: ';
    this.el['menu-title'].style.color = '#ff5a4d';
    this.showMenu('dead', kind,
      '<p>' + (kind === 'WASTED' ? 'Rio went down in Brisa Bay.' : 'The BCPD hauled Rio in.') + '</p>' +
      '<p>' + bill + fmtMoney(lost) + '.</p>' +
      '<p class="save-line">Missions done ' + stats.missions + ' · Cars stolen ' + stats.stolen +
      ' · Play time ' + fmtTime(stats.time) + ' · Cash ' + fmtMoney(stats.cash) + '</p>' +
      '<div class="bb-btnrow"><button class="bb-btn gold" data-act="respawn">Get back up</button></div>',
      'Press ENTER to ' + (kind === 'WASTED' ? 'get back up' : 'walk free'),
      { respawn: cb.onRespawn });
  }

  showShop(title, itemsHtml) {
    this.el.shop.style.display = 'block';
    this.el['shop-title'].textContent = title;
    this.el['shop-items'].innerHTML = itemsHtml;
  }
  hideShop() { this.el.shop.style.display = 'none'; }

  // Toasts queue instead of overwriting: a pickup and a mission line can
  // both land in the same second and the player still reads both.
  notify(text) {
    this.toastQueue.push(text);
  }

  // Mission result in the WASTED/BUSTED style: a big non-blocking splash
  // with the reward and the run's stats, gone on its own in a few seconds.
  showMissionSplash(s) {
    const gold = s.kind === 'complete';
    this.splashEl.innerHTML =
      '<div><div class="big" style="color:' + (gold ? '#ffd34d' : '#ff5a4d') + '">' + s.title + '</div>' +
      '<div class="sub">' + s.name + '</div>' +
      s.lines.map((l) => '<div class="stat">' + l + '</div>').join('') + '</div>';
    this.splashEl.style.display = 'flex';
    this.splashTimer = 4.5;
  }
  hideSplash() {
    this.splashEl.style.display = 'none';
    this.splashTimer = 0;
  }

  // Objective banner: the mission name and its current objective, big and
  // gold under the objective line for a few seconds after every new step.
  banner(text) {
    this.bannerEl.textContent = text;
    this.bannerEl.style.opacity = '1';
    this.bannerTimer = 3.5;
  }

  // The persistent interaction prompt ("E — Steal the Vento"): one line
  // under the toasts, live while the player stands in reach, gone after.
  setPrompt(text) {
    if (text) {
      this.promptEl.textContent = text;
      this.promptEl.style.opacity = '1';
    } else {
      this.promptEl.style.opacity = '0';
    }
  }

  flashDamage() {
    this.damageFlash = 0.55;
    this.el.damage.style.opacity = '0.55';
  }

  renderWeaponSlots(state) {
    const slots = weaponSlotList(state.weapons, state.weaponKey || 'fists');
    const sig = JSON.stringify(slots);
    if (sig === this.weaponSig) return;
    this.weaponSig = sig;
    this.el.weapons.innerHTML = slots.map((s) =>
      `<span style="display:inline-block;padding:2px 7px;margin:2px 4px 0 0;border:1px solid ${s.on ? '#ffd34d' : 'rgba(255,255,255,0.3)'};border-radius:3px;background:${s.on ? 'rgba(255,211,77,0.28)' : 'rgba(0,0,0,0.35)'};color:${s.on ? '#fff' : 'rgba(255,255,255,0.65)'};font-size:11px;font-weight:700">${s.hotkey} ${s.label}</span>`).join('');
  }

  update(dt, state) {
    // state: { cash, health, armor, wanted, weaponName, ammo, speedKmh,
    //   carSpeed, carTop, inCar, prompt, radio, objective, clockSec,
    //   player, cars, police, heliPos, markerPos, shops, pickups,
    //   roadblocks, mods, fare, busStops }
    if (this.lastCash !== null && state.cash > this.lastCash) {
      this.el.cash.classList.add('gain');
      this.cashTimer = 1;
    }
    this.lastCash = state.cash;
    if (this.cashTimer > 0) {
      this.cashTimer -= dt;
      if (this.cashTimer <= 0) this.el.cash.classList.remove('gain');
    }
    this.el.cash.textContent = fmtMoney(state.cash);
    // Health drop flashes the bar's rim; under 30 it runs red and the
    // damage vignette keeps pulsing until Rio heals or dies.
    if (this.lastHealth !== null && state.health < this.lastHealth) {
      this.healthBar.classList.add('hit');
      this.hitTimer = 0.35;
    }
    this.lastHealth = state.health;
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.healthBar.classList.remove('hit');
    }
    this.healthBar.classList.toggle('low', state.health < 30);
    this.el['health-fill'].style.width = Math.max(0, state.health) + '%';
    this.el['health-num'].textContent = Math.max(0, Math.round(state.health));
    this.el.armor.textContent = state.armor > 0 ? 'ARMOR ' + Math.round(state.armor) : '';
    this.armorFill.style.width = Math.max(0, Math.min(100, state.armor)) + '%';
    // Garage mods: short tags, only when something is fitted.
    const mods = state.mods || { armor: 0, engine: 0, tires: 0 };
    const tags = [];
    if (mods.armor > 0) tags.push('ARMOUR ' + mods.armor);
    if (mods.engine > 0) tags.push('ENGINE ' + mods.engine);
    if (mods.tires > 0) tags.push('TYRES ' + mods.tires);
    this.el.mods.textContent = tags.length > 0 ? 'MODS: ' + tags.join(' · ') : '';
    const stars = '★'.repeat(state.wanted) + '☆'.repeat(WANTED_MAX - state.wanted);
    this.el.stars.textContent = stars;
    // Any heat pulses; at three stars and up it pulses red.
    const hot = state.wanted >= 3;
    this.el.stars.style.color = hot ? '#ff5a4d' : (state.wanted > 0 ? '#ffd34d' : 'rgba(255,255,255,0.35)');
    this.el.stars.style.opacity = state.wanted > 0 ? String(0.7 + 0.3 * Math.sin(performance.now() / 160)) : '1';
    this.el.weapon.textContent = state.weaponName;
    this.el.ammo.textContent = state.ammo === Infinity ? '∞' : String(state.ammo);
    const wdef = WEAPONS[state.weaponKey || 'fists'];
    this.el.ammo.classList.toggle('low', state.ammo !== Infinity && wdef && wdef.ammo !== Infinity && state.ammo <= Math.max(1, Math.floor(wdef.ammo / 4)));
    this.renderWeaponSlots(state);
    this.el.speed.textContent = Math.round(state.speedKmh) + ' km/h' +
      (state.inCar ? ' · ' + gearFor(state.carSpeed || 0, state.carTop || 0) : '') +
      (state.carHealth != null ? '  ·  CAR ' + Math.max(0, Math.round(state.carHealth)) : '');
    // A station switch flashes its name big, centre screen — the toast
    // alone was too easy to miss while driving.
    if (state.radio !== this.lastRadio) {
      if (this.lastRadio !== '') {
        this.radioEl.textContent = '♪ ' + state.radio;
        this.radioEl.style.opacity = '1';
        this.radioTimer = 2;
      }
      this.lastRadio = state.radio;
    }
    if (this.radioTimer > 0) {
      this.radioTimer -= dt;
      if (this.radioTimer <= 0) this.radioEl.style.opacity = '0';
    }
    this.el.radio.textContent = '♪ ' + state.radio;
    this.el.objective.textContent = state.objective;
    this.el.clock.textContent = fmtTime(state.clockSec);
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.style.opacity = '0';
    } else if (this.toastQueue.length > 0) {
      this.el.toast.textContent = this.toastQueue.shift();
      this.el.toast.style.opacity = '1';
      this.toastTimer = 4;
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.style.opacity = '0';
    }
    if (this.splashTimer > 0) {
      this.splashTimer -= dt;
      if (this.splashTimer <= 0) this.hideSplash();
    }
    if (this.damageFlash > 0) {
      this.damageFlash -= dt;
      this.el.damage.style.opacity = String(Math.max(0, this.damageFlash));
    } else if (state.health < 30) {
      this.el.damage.style.opacity = String(0.16 + 0.09 * Math.sin(performance.now() / 300));
    }
    this.setPrompt(state.prompt || null);
    if (this.touch) this.touch.setContext({ inCar: !!state.inCar, weapon: state.weaponKey || 'fists' });
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
    // Bus stops — cyan squares, so a rider can find the next stop.
    ctx.fillStyle = '#4fd8ff';
    for (const s of this.world.busStops || []) {
      const [x, z] = toMap(s.x, s.z);
      ctx.fillRect(x - 3, z - 3, 6, 6);
    }
    // Gang turf — faint colour wash + hideout dot, so Rio knows where not to stroll.
    for (const g of state.gangs || []) {
      const [x0, z0] = toMap(g.x0, g.z0);
      const [x1, z1] = toMap(g.x1, g.z1);
      const col = '#' + g.color.toString(16).padStart(6, '0');
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.14;
      ctx.fillRect(x0, z0, x1 - x0, z1 - z0);
      ctx.globalAlpha = 1;
      const [hx, hz] = toMap(g.hx, g.hz);
      ctx.beginPath(); ctx.arc(hx, hz, 4, 0, Math.PI * 2); ctx.fill();
    }
    // World pickups — green health, blue armour, orange guns.
    for (const p of state.pickups || []) {
      const [x, z] = toMap(p.x, p.z);
      ctx.fillStyle = p.kind === 'health' ? '#2fd47a' : p.kind === 'weapon' ? '#ff8c42' : '#4da3ff';
      if (p.kind === 'health') {
        ctx.fillRect(x - 1, z - 4, 2, 8);
        ctx.fillRect(x - 4, z - 1, 8, 2);
      } else if (p.kind === 'weapon') {
        ctx.fillRect(x - 3, z - 3, 6, 6);
      } else {
        ctx.beginPath();
        ctx.moveTo(x, z - 4); ctx.lineTo(x + 4, z); ctx.lineTo(x, z + 4); ctx.lineTo(x - 4, z);
        ctx.closePath(); ctx.fill();
      }
    }
    // Police roadblocks — red bars across the road.
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
      // Waypoint arrow: a gold line from the player arrow toward the
      // marker, so the objective reads as a direction, not just a dot.
      const [px0, pz0] = toMap(state.player.x, state.player.z);
      const dx = mx - px0, dz = mz - pz0;
      const len = Math.hypot(dx, dz);
      if (len > 14) {
        const ux = dx / len, uz = dz / len;
        const ax = px0 + ux * 12, az = pz0 + uz * 12;
        const bx = px0 + ux * (len - 8), bz = pz0 + uz * (len - 8);
        ctx.strokeStyle = 'rgba(255,211,77,0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(bx, bz); ctx.stroke();
        ctx.fillStyle = '#ffd34d';
        ctx.beginPath();
        ctx.moveTo(bx + ux * 6, bz + uz * 6);
        ctx.lineTo(bx - uz * 4, bz + ux * 4);
        ctx.lineTo(bx + uz * 4, bz - ux * 4);
        ctx.closePath(); ctx.fill();
      }
    }
    // Traffic cars (grey dots), police (blue squares).
    for (const c of state.cars) {
      if (c.dead) continue;
      const [x, z] = toMap(c.pos.x, c.pos.z);
      ctx.fillStyle = c.kind === 'police' ? '#4da3ff' : 'rgba(200,200,200,0.8)';
      ctx.fillRect(x - 2, z - 2, 4, 4);
    }
    // Taxi fare — an amber circle with a $ in it, at the passenger
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
