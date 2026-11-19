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
  // Weapon wheel
  '#weapon-wheel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:320px;height:320px;pointer-events:none;z-index:20;opacity:0;transition:opacity .15s}',
  '#weapon-wheel.active{opacity:1;pointer-events:auto}',
  '#weapon-wheel .wheel-bg{position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle at center,rgba(10,16,24,0.95) 60%,rgba(0,0,0,0.98) 100%);border:2px solid #4a6fa5;box-shadow:0 0 30px rgba(0,0,0,0.8),inset 0 0 20px rgba(74,111,165,0.3)}',
  '#weapon-wheel .wheel-slot{position:absolute;width:80px;height:80px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:transform .1s}',
  '#weapon-wheel .wheel-slot:hover{transform:scale(1.15)}',
  '#weapon-wheel .wheel-slot .icon{font-size:28px;margin-bottom:4px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.8))}',
  '#weapon-wheel .wheel-slot .label{font-size:11px;font-weight:700;text-transform:uppercase;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.9)}',
  '#weapon-wheel .wheel-slot .ammo{font-size:10px;color:#bcd6ea}',
  '#weapon-wheel .wheel-slot .hotkey{position:absolute;top:4px;right:4px;font-size:10px;color:#ffd34d;font-weight:700;background:rgba(0,0,0,0.6);padding:1px 4px;border-radius:3px}',
  '#weapon-wheel .wheel-slot.selected{filter:brightness(1.4)}',
  '#weapon-wheel .wheel-slot.selected::before{content:"";position:absolute;inset:-4px;border-radius:50%;border:2px solid #ffd34d;box-shadow:0 0 10px #ffd34d}',
  '#weapon-wheel .wheel-center{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:80px;height:80px;border-radius:50%;background:rgba(10,16,24,0.9);border:2px solid #4a6fa5;display:flex;align-items:center;justify-content:center;pointer-events:none}',
  '#weapon-wheel .wheel-center .current-weapon{font-size:12px;font-weight:700;color:#ffd34d;text-transform:uppercase;text-shadow:0 1px 3px rgba(0,0,0,0.9)}',
  // Phone pause menu
  '#phone-menu{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(0.9);width:360px;height:640px;background:linear-gradient(180deg,#0d121a 0%,#1a2530 100%);border:2px solid #4a6fa5;border-radius:32px;box-shadow:0 0 40px rgba(0,0,0,0.9),0 20px 60px rgba(0,0,0,0.7);z-index:30;opacity:0;visibility:hidden;transition:opacity .2s,transform .2s,visibility .2s;overflow:hidden;font-family:Arial,sans-serif}',
  '#phone-menu.active{opacity:1;visibility:visible;transform:translate(-50%,-50%) scale(1)}',
  '#phone-menu .phone-header{height:60px;background:rgba(0,0,0,0.5);border-bottom:1px solid rgba(74,111,165,0.3);display:flex;align-items:center;justify-content:space-between;padding:0 20px;color:#fff}',
  '#phone-menu .phone-time{font-size:24px;font-weight:700;letter-spacing:2px}',
  '#phone-menu .phone-battery{font-size:14px;color:#bcd6ea}',
  '#phone-menu .phone-apps{padding:20px;display:grid;grid-template-columns:repeat(3,1fr);gap:16px;height:calc(100% - 60px);overflow-y:auto}',
  '#phone-menu .phone-app{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px 10px;background:rgba(255,255,255,0.05);border:1px solid rgba(74,111,165,0.2);border-radius:16px;cursor:pointer;transition:all .15s;color:#fff;text-decoration:none}',
  '#phone-menu .phone-app:hover{background:rgba(74,111,165,0.3);border-color:#ffd34d;transform:translateY(-4px);box-shadow:0 8px 20px rgba(74,111,165,0.3)}',
  '#phone-menu .phone-app .icon{font-size:36px;margin-bottom:8px}',
  '#phone-menu .phone-app .name{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px}',
  '#phone-menu .phone-app .desc{font-size:10px;color:#8aa8c8;margin-top:4px;text-align:center}',
  '#phone-menu .phone-footer{height:50px;background:rgba(0,0,0,0.5);border-top:1px solid rgba(74,111,165,0.3);display:flex;align-items:center;justify-content:center;gap:40px;padding:0 20px;color:#6a8ab8;font-size:12px}',
  '#phone-menu .phone-detail{display:none;position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(10,16,24,0.98);z-index:10;padding:20px;overflow-y:auto;color:#fff}',
  '#phone-menu .phone-detail.active{display:block}',
  // Phone pause menu
  '#phone-menu .phone-detail .back-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;background:rgba(74,111,165,0.2);border:1px solid #4a6fa5;border-radius:8px;color:#ffd34d;font-weight:700;cursor:pointer;margin-bottom:20px;transition:background .15s}',
  '#phone-menu .phone-detail .back-btn:hover{background:rgba(74,111,165,0.4)}',
  // Context Prompts: dynamic hint panel (bottom-center)
  '#context-prompts{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:4px;z-index:8;pointer-events:none}',
  '#context-prompts .cp-row{display:flex;align-items:center;gap:10px;background:rgba(10,16,24,0.85);border:1px solid rgba(74,111,165,0.4);border-radius:6px;padding:6px 12px;color:#fff;font:13px Arial,sans-serif;white-space:nowrap;opacity:0;transform:translateY(10px);transition:opacity .2s,transform .2s}',
  '#context-prompts .cp-row.visible{opacity:1;transform:translateY(0)}',
  '#context-prompts .cp-key{display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:28px;background:rgba(255,211,77,0.2);border:1px solid #ffd34d;border-radius:4px;color:#ffd34d;font-weight:700;font-size:11px;padding:0 8px}',
  '#context-prompts .cp-key.mouse{background:rgba(126,226,168,0.2);border-color:#7ee2a8;color:#7ee2a8}',
  '#context-prompts .cp-text{color:#e8eef6;font-size:12px}',
  '#context-prompts .cp-row.primary .cp-key{background:#ffd34d;border-color:#ffd34d;color:#0c121a}',
  '#context-prompts .cp-row.primary .cp-text{color:#ffd34d;font-weight:700}',
  // Mission Box (left panel) - persistent mission/race info
  '#mission-box{position:fixed;top:120px;left:16px;width:300px;background:linear-gradient(180deg,rgba(10,16,24,0.95) 0%,rgba(15,22,34,0.98) 100%);border:2px solid #4a6fa5;border-radius:12px;box-shadow:0 0 30px rgba(0,0,0,0.8),inset 0 1px 0 rgba(255,255,255,0.1);z-index:10;color:#fff;font-family:Arial,sans-serif;transition:transform .3s,opacity .3s,width .3s;overflow:hidden}',
  '#mission-box.collapsed{width:48px}',
  '#mission-box.collapsed .mb-content{display:none}',
  '#mission-box.collapsed .mb-toggle::after{content:"▶"}',
  '#mission-box .mb-header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(0,0,0,0.4);border-bottom:1px solid rgba(74,111,165,0.3)}',
  '#mission-box .mb-title{font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:#ffd34d}',
  '#mission-box .mb-toggle{background:none;border:none;color:#bcd6ea;font-size:16px;cursor:pointer;padding:2px 8px;border-radius:4px;transition:background .15s}',
  '#mission-box .mb-toggle:hover{background:rgba(255,211,77,0.2)}',
  '#mission-box .mb-content{padding:12px 14px}',
  '#mission-box .mb-row{display:flex;justify-content:space-between;margin:8px 0;font-size:12px}',
  '#mission-box .mb-label{color:#8aa8c8}',
  '#mission-box .mb-value{color:#fff;font-weight:700;font-family:monospace}',
  '#mission-box .mb-divider{height:1px;background:rgba(74,111,165,0.3);margin:10px 0}',
  '#mission-box .mb-progress{height:6px;background:rgba(0,0,0,0.5);border-radius:3px;overflow:hidden;margin:8px 0}',
  '#mission-box .mb-progress-fill{height:100%;background:linear-gradient(90deg,#2f7fc9,#7ec2f2);transition:width .3s}',
  '#mission-box .mb-buttons{display:flex;gap:6px;margin-top:12px}',
  '#mission-box .mb-btn{flex:1;padding:8px 12px;background:#1d2733;color:#fff;border:1px solid #4a6fa5;border-radius:6px;font:700 11px Arial,sans-serif;cursor:pointer;transition:all .15s}',
  '#mission-box .mb-btn:hover{background:#2b3a55}',
  '#mission-box .mb-btn.gold{background:#8a6420;border-color:#ffd34d}',
  '#mission-box .mb-btn.danger{background:#8a2d2d;border-color:#ff5a4d}',
  '#mission-box.race-mode .mb-title{color:#00ff88}',
  '#mission-box .mb-lap{display:flex;justify-content:space-between;font-size:12px;margin:4px 0}',
  '#mission-box .mb-checkpoint{display:flex;justify-content:space-between;font-size:12px;margin:4px 0}',
  '#mission-box .mb-position{display:flex;justify-content:space-between;font-size:12px;margin:4px 0}',
  '#mission-box .mb-delta{font-size:11px;text-align:center;margin-top:6px;padding:4px;border-radius:4px;background:rgba(0,0,0,0.3)}',
  '#mission-box .mb-delta.behind{color:#ff5a4d}',
  '#mission-box .mb-delta.ahead{color:#00ff88}',
  '#mission-box .mb-delta.even{color:#ffd34d}',
].join('\n');

const HUD_IDS = ['cash', 'health-fill', 'health-num', 'armor', 'mods', 'stars', 'weapon', 'ammo', 'weapons', 'speed', 'radio', 'objective', 'toast', 'clock', 'menu', 'menu-title', 'menu-body', 'menu-hint', 'shop', 'shop-title', 'shop-items', 'damage'];

// Weapon slots: owned weapons with switch keys, current highlighted.
export function weaponSlotList(weapons, current) {
  const defs = [['fists', 'FISTS', '0'], ['pistol', 'P9', '1'], ['smg', 'SMG', '2'], ['shotgun', 'BOOM', '3']];
  return defs.filter(([k]) => k === 'fists' || (weapons && weapons[k]))
    .map(([k, label, key]) => ({ key: k, label, hotkey: key, on: k === current }));
}

export class HUD {
  constructor(world, game) {
    this.world = world;
    this.game = game;
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
    // Weapon wheel
    this.weaponWheelEl = this.buildWeaponWheel();
    // Phone pause menu
    this.phoneMenuEl = this.buildPhoneMenu();
    // Mission Box (left panel)
    this.missionBoxEl = this.buildMissionBox();
    // Context Prompts panel
    this.contextPromptsEl = mk('context-prompts');
    this.contextPromptRows = new Map();
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

  // Context Prompts: dynamic hint panel based on player state and nearby interactables
  // Replaces the single-line prompt with a stack of contextual hints
  updateContextPrompts(state) {
    if (!this.contextPromptsEl) return;
    // Hide during cutscenes
    if (state.cutsceneActive) {
      // Hide all existing rows
      for (const [key, el] of this.contextPromptRows) {
        el.classList.remove('visible');
        setTimeout(() => {
          if (this.contextPromptRows.has(key)) {
            el.remove();
            this.contextPromptRows.delete(key);
          }
        }, 250);
      }
      return;
    }
    const inCar = !!state.inCar;
    const nearShop = state.nearShop;
    const nearCar = state.nearCar;
    const nearPickup = state.nearPickup;
    const nearMission = state.nearMission;
    const weaponKey = state.weaponKey || 'fists';
    const hasGun = weaponKey !== 'fists';
    const wanted = state.wanted || 0;

    // Build prompt rows based on context
    const rows = [];

    // Primary interaction (closest interactable)
    if (nearMission) {
      rows.push({ key: 'E', text: 'Start ' + nearMission.name, primary: true, mouse: false });
    } else if (nearShop) {
      rows.push({ key: 'E', text: 'Enter ' + nearShop.name, primary: true, mouse: false });
    } else if (nearPickup) {
      rows.push({ key: 'E', text: 'Pick up ' + nearPickup.kind, primary: true, mouse: false });
    } else if (nearCar && !inCar) {
      rows.push({ key: 'E', text: nearCar.isPlayerCar ? 'Enter ' + nearCar.def.label : 'Steal ' + nearCar.def.label, primary: true, mouse: false });
    } else if (inCar) {
      rows.push({ key: 'E', text: 'Exit vehicle', primary: true, mouse: false });
    }

    // Secondary actions (always available based on state)
    if (inCar) {
      rows.push({ key: 'SHIFT', text: 'Handbrake', primary: false, mouse: false });
      rows.push({ key: 'H', text: 'Horn', primary: false, mouse: false });
      rows.push({ key: 'R', text: 'Radio', primary: false, mouse: false });
    } else {
      rows.push({ key: 'SHIFT', text: 'Run', primary: false, mouse: false });
      rows.push({ key: 'SPACE', text: 'Jump', primary: false, mouse: false });
      rows.push({ key: 'F', text: 'Punch', primary: false, mouse: false });
      if (hasGun) {
        rows.push({ key: 'CLICK', text: 'Shoot', primary: false, mouse: true });
      }
    }

    // Universal actions
    rows.push({ key: 'TAB', text: 'Weapon Wheel', primary: false, mouse: false });
    rows.push({ key: 'P', text: 'Pause / Phone', primary: false, mouse: false });
    rows.push({ key: 'Q', text: 'Radio On/Off', primary: false, mouse: false });
    if (wanted > 0) {
      rows.push({ key: 'ESC', text: 'Hide (Lose Cops)', primary: false, mouse: false });
    }

    // Update DOM
    const existingKeys = new Set(this.contextPromptRows.keys());
    const newKeys = new Set();

    rows.forEach((row, i) => {
      const rowKey = row.key + ':' + row.text;
      newKeys.add(rowKey);
      let el = this.contextPromptRows.get(rowKey);
      if (!el) {
        el = document.createElement('div');
        el.className = 'cp-row' + (row.primary ? ' primary' : '');
        el.style.transitionDelay = (i * 30) + 'ms';
        el.innerHTML = '<span class="cp-key' + (row.mouse ? ' mouse' : '') + '">' + row.key + '</span><span class="cp-text">' + row.text + '</span>';
        this.contextPromptsEl.appendChild(el);
        this.contextPromptRows.set(rowKey, el);
      }
      // Force visible
      requestAnimationFrame(() => el.classList.add('visible'));
    });

    // Hide/remove old rows
    for (const [key, el] of this.contextPromptRows) {
      if (!newKeys.has(key)) {
        el.classList.remove('visible');
        setTimeout(() => {
          if (this.contextPromptRows.has(key) && !newKeys.has(key)) {
            el.remove();
            this.contextPromptRows.delete(key);
          }
        }, 250);
      }
    }
  }

  // Legacy single-line prompt (kept for compatibility)
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
    this.updateContextPrompts(state);
    this.setPrompt(state.prompt || null);
    if (this.touch) this.touch.setContext({ inCar: !!state.inCar, weapon: state.weaponKey || 'fists' });
    this.drawMinimap(state);
    this.updateMissionBox(state);
  }

  drawMinimap(state) {
    const ctx = this.mapCtx;
    const S = this.map.width; // 220
    const half = CITY.half + 30;
    const scale = S / (half * 2);
    const range = half; // world units shown on map

    // Clear with dark background
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#0c121a';
    ctx.fillRect(0, 0, S, S);

    // Player position in world
    const px = state.player.x;
    const pz = state.player.z;
    const pHeading = state.player.heading;

    // Transform: world -> map (rotated so player forward = up)
    // Map center = player position
    const centerX = S / 2;
    const centerZ = S / 2;

    function worldToMap(wx, wz) {
      const dx = wx - px;
      const dz = wz - pz;
      // Rotate by -heading so player forward points up (-Z on canvas)
      const cos = Math.cos(-pHeading);
      const sin = Math.sin(-pHeading);
      const rx = dx * cos - dz * sin;
      const rz = dx * sin + dz * cos;
      return [centerX + rx * scale, centerZ + rz * scale];
    }

    // Draw roads (static, so we can precompute but let's keep simple)
    ctx.strokeStyle = 'rgba(120, 120, 110, 0.5)';
    ctx.lineWidth = 2 * scale;
    for (const l of this.world.roads) {
      // Vertical roads
      const [x1, z1] = worldToMap(l, -range);
      const [x2, z2] = worldToMap(l, range);
      if (Math.abs(x1 - centerX) < S / 2 + 20) {
        ctx.beginPath(); ctx.moveTo(x1, z1); ctx.lineTo(x2, z2); ctx.stroke();
      }
      // Horizontal roads
      const [x3, z3] = worldToMap(-range, l);
      const [x4, z4] = worldToMap(range, l);
      if (Math.abs(z3 - centerZ) < S / 2 + 20) {
        ctx.beginPath(); ctx.moveTo(x3, z3); ctx.lineTo(x4, z4); ctx.stroke();
      }
    }

    // Sea (east edge)
    const [seaX1] = worldToMap(CITY.beachEnd, -range);
    const [seaX2] = worldToMap(CITY.beachEnd, range);
    if (seaX1 < S) {
      ctx.fillStyle = '#1e6f8e';
      ctx.fillRect(Math.max(0, seaX1), 0, S - Math.max(0, seaX1), S);
    }
    // Beach
    const [beachX1] = worldToMap(CITY.half, -range);
    const [beachX2] = worldToMap(CITY.half, range);
    if (beachX1 < S && seaX1 > 0) {
      ctx.fillStyle = '#d9b380';
      ctx.fillRect(Math.max(0, beachX1), 0, Math.max(0, seaX1 - beachX1), S);
    }

    // Shops (green squares)
    ctx.fillStyle = '#7ee2a8';
    for (const s of this.world.shops) {
      const [x, z] = worldToMap(s.x, s.z);
      if (this.inMapView(x, z, S)) {
        const size = 5 * scale;
        ctx.fillRect(x - size / 2, z - size / 2, size, size);
      }
    }

    // Safehouse (gold house icon)
    const sh = this.world.places.safehouse;
    const [hx, hz] = worldToMap(sh.x, sh.z);
    if (this.inMapView(hx, hz, S)) {
      ctx.fillStyle = '#ffd34d';
      ctx.beginPath();
      ctx.moveTo(hx, hz - 6);
      ctx.lineTo(hx + 5, hz + 2);
      ctx.lineTo(hx + 5, hz + 6);
      ctx.lineTo(hx - 5, hz + 6);
      ctx.lineTo(hx - 5, hz + 2);
      ctx.closePath();
      ctx.fill();
    }

    // Bus stops (cyan squares)
    ctx.fillStyle = '#4fd8ff';
    for (const s of this.world.busStops || []) {
      const [x, z] = worldToMap(s.x, s.z);
      if (this.inMapView(x, z, S)) {
        const size = 5 * scale;
        ctx.fillRect(x - size / 2, z - size / 2, size, size);
      }
    }

    // Gang turf (faint wash) + hideout dots
    for (const g of state.gangs || []) {
      const [x0, z0] = worldToMap(g.x0, g.z0);
      const [x1, z1] = worldToMap(g.x1, g.z1);
      const col = '#' + g.color.toString(16).padStart(6, '0');
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.1;
      const minX = Math.min(x0, x1);
      const maxX = Math.max(x0, x1);
      const minZ = Math.min(z0, z1);
      const maxZ = Math.max(z0, z1);
      if (maxX > 0 && minX < S && maxZ > 0 && minZ < S) {
        ctx.fillRect(minX, minZ, maxX - minX, maxZ - minZ);
      }
      ctx.globalAlpha = 1;
      const [hx, hz] = worldToMap(g.hx, g.hz);
      if (this.inMapView(hx, hz, S)) {
        ctx.beginPath();
        ctx.arc(hx, hz, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // World pickups
    for (const p of state.pickups || []) {
      const [x, z] = worldToMap(p.x, p.z);
      if (this.inMapView(x, z, S)) {
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
    }

    // Police roadblocks (red bars)
    ctx.fillStyle = '#ff5a4d';
    for (const b of state.roadblocks || []) {
      const [x, z] = worldToMap(b.x, b.z);
      if (this.inMapView(x, z, S)) {
        ctx.save();
        ctx.translate(x, z);
        ctx.rotate(b.heading - pHeading);
        ctx.fillRect(-6 * scale, -1.5 * scale, 12 * scale, 3 * scale);
        ctx.restore();
      }
    }

    // Objective marker (pulsing gold ring)
    if (state.markerPos) {
      const [mx, mz] = worldToMap(state.markerPos.x, state.markerPos.z);
      if (this.inMapView(mx, mz, S, 20)) {
        const r = 6 + Math.sin(performance.now() / 200) * 2;
        ctx.strokeStyle = '#ffd34d';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(mx, mz, r, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#ffd34d';
        ctx.beginPath(); ctx.arc(mx, mz, 3, 0, Math.PI * 2); ctx.fill();
        // Waypoint arrow from player to marker
        const dx = mx - centerX, dz = mz - centerZ;
        const len = Math.hypot(dx, dz);
        if (len > 14) {
          const ux = dx / len, uz = dz / len;
          const ax = centerX + ux * 14, az = centerZ + uz * 14;
          const bx = centerX + ux * (len - 10), bz = centerZ + uz * (len - 10);
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
    }

    // Traffic cars (grey dots), police (blue squares), helicopters (blue rings)
    for (const c of state.cars) {
      if (c.dead) continue;
      const [x, z] = worldToMap(c.pos.x, c.pos.z);
      if (this.inMapView(x, z, S)) {
        ctx.fillStyle = c.kind === 'police' ? '#4da3ff' : 'rgba(200,200,200,0.8)';
        const size = c.kind === 'police' ? 4 : 3;
        ctx.fillRect(x - size / 2, z - size / 2, size, size);
      }
    }

    // Police helicopter
    if (state.heliPos) {
      const [x, z] = worldToMap(state.heliPos.x, state.heliPos.z);
      if (this.inMapView(x, z, S)) {
        ctx.strokeStyle = '#4da3ff';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, z, 8, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#4da3ff';
        ctx.beginPath(); ctx.arc(x, z, 3, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Taxi fare (amber pulsing circle with $)
    if (state.fare) {
      const [fx, fz] = worldToMap(state.fare.x, state.fare.z);
      if (this.inMapView(fx, fz, S)) {
        const pulse = 6 + Math.sin(performance.now() / 200) * 2;
        ctx.fillStyle = '#f2a007';
        ctx.beginPath(); ctx.arc(fx, fz, pulse, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#0c121a';
        ctx.font = 'bold 10px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('$', fx, fz + 1);
      }
    }

    // Player arrow (always at center, pointing up)
    ctx.save();
    ctx.translate(centerX, centerZ);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 6);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    // White outline
    ctx.strokeStyle = '#0c121a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // North indicator (top-right, rotates opposite to player)
    const northAngle = -pHeading;
    ctx.save();
    ctx.translate(S - 18, 18);
    ctx.rotate(northAngle);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 11px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, 0);
    ctx.restore();

    // Map border
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, S - 2, S - 2);
  }

  inMapView(x, z, S, margin = 10) {
    return x >= -margin && x <= S + margin && z >= -margin && z <= S + margin;
  }

  // Mission Box (left panel) - persistent mission/race info
  buildMissionBox() {
    const el = document.createElement('div');
    el.id = 'mission-box';
    el.innerHTML = `
      <div class="mb-header">
        <span class="mb-title">MISSION</span>
        <button class="mb-toggle" title="Collapse/Expand">▼</button>
      </div>
      <div class="mb-content">
        <div class="mb-row"><span class="mb-label">MISSION</span><span class="mb-value" id="mb-mission">—</span></div>
        <div class="mb-row"><span class="mb-label">OBJECTIVE</span><span class="mb-value" id="mb-objective">Free roam</span></div>
        <div id="mb-race-data" style="display:none">
          <div class="mb-divider"></div>
          <div class="mb-lap"><span class="mb-label">LAP</span><span class="mb-value" id="mb-lap">1/1</span></div>
          <div class="mb-checkpoint"><span class="mb-label">CHECKPOINT</span><span class="mb-value" id="mb-cp">1/1</span></div>
          <div class="mb-position"><span class="mb-label">POSITION</span><span class="mb-value" id="mb-pos">1/1</span></div>
          <div class="mb-progress"><div class="mb-progress-fill" id="mb-progress" style="width:0%"></div></div>
          <div class="mb-delta" id="mb-delta"></div>
        </div>
        <div class="mb-divider"></div>
        <div class="mb-buttons">
          <button class="mb-btn gold" id="mb-gps">GPS</button>
          <button class="mb-btn" id="mb-restart">RESTART</button>
          <button class="mb-btn danger" id="mb-quit">QUIT</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);

    // Toggle collapse
    const toggle = el.querySelector('.mb-toggle');
    toggle.addEventListener('click', () => {
      el.classList.toggle('collapsed');
    });

    // Button handlers
    el.querySelector('#mb-gps').addEventListener('click', () => {
      if (this.game && this.game.missions && this.game.missions.currentStep) {
        const step = this.game.missions.currentStep;
        if (step && step.x !== undefined) {
          this.game.notify('Waypoint set to objective');
        }
      }
    });
    el.querySelector('#mb-restart').addEventListener('click', () => {
      if (this.game) {
        this.game.restartMission();
      }
    });
    el.querySelector('#mb-quit').addEventListener('click', () => {
      if (this.game && this.game.missions) {
        this.game.missions.fail('Mission abandoned');
      }
    });

    return el;
  }

  updateMissionBox(state) {
    if (!this.missionBoxEl) return;
    const mm = this.game?.missions;
    if (!mm) return;

    const meta = mm.meta;
    const step = mm.currentStep;
    const isRace = mm.state === 'race_mode' || (step && (step.type === 'race_circuit' || step.type === 'race_sprint' || step.type === 'race_drift' || step.type === 'race'));

    // Mission name
    this.missionBoxEl.querySelector('#mb-mission').textContent = meta ? meta.name : '—';

    // Objective text (shortened)
    let objText = state.objective || 'Free roam';
    if (objText.length > 30) objText = objText.substring(0, 27) + '...';
    this.missionBoxEl.querySelector('#mb-objective').textContent = objText;

    // Race data section
    const raceSection = this.missionBoxEl.querySelector('#mb-race-data');
    if (isRace && mm.raceTrack) {
      raceSection.style.display = 'block';
      this.missionBoxEl.classList.add('race-mode');
      this.missionBoxEl.querySelector('.mb-title').textContent = 'RACE';

      const track = mm.raceTrack;
      // Lap
      this.missionBoxEl.querySelector('#mb-lap').textContent = (mm.raceLap || 1) + '/' + track.laps;
      // Checkpoint
      this.missionBoxEl.querySelector('#mb-cp').textContent = (mm.raceIndex + 1) + '/' + track.checkpoints.length;
      // Position
      let pos = 1;
      for (const r of mm.racers || []) {
        if (r.raceLap > track.laps || (r.raceLap === track.laps && r.raceIndex >= track.checkpoints.length)) {
          pos++;
        }
      }
      this.missionBoxEl.querySelector('#mb-pos').textContent = pos + '/' + ((track.aiRacers || 4) + 1);
      // Progress (overall race progress)
      const totalCP = track.laps * track.checkpoints.length;
      const currentCP = (mm.raceLap - 1) * track.checkpoints.length + mm.raceIndex;
      const progress = totalCP > 0 ? (currentCP / totalCP) * 100 : 0;
      this.missionBoxEl.querySelector('#mb-progress').style.width = progress + '%';
      // Delta
      const deltaEl = this.missionBoxEl.querySelector('#mb-delta');
      if (mm.racers && mm.racers.length > 0) {
        const leader = mm.racers.reduce((best, r) => {
          const rProg = r.raceLap * track.checkpoints.length + r.raceIndex;
          const bProg = best.raceLap * track.checkpoints.length + best.raceIndex;
          return rProg > bProg ? r : best;
        });
        const playerProg = (mm.raceLap - 1) * track.checkpoints.length + mm.raceIndex;
        const leaderProg = (leader.raceLap - 1) * track.checkpoints.length + leader.raceIndex;
        const diff = leaderProg - playerProg;
        deltaEl.textContent = diff > 0 ? '+' + diff + ' CP behind' : diff < 0 ? Math.abs(diff) + ' CP ahead' : 'SIDE BY SIDE';
        deltaEl.className = 'mb-delta ' + (diff > 0 ? 'behind' : diff < 0 ? 'ahead' : 'even');
      }
    } else {
      raceSection.style.display = 'none';
      this.missionBoxEl.classList.remove('race-mode');
      this.missionBoxEl.querySelector('.mb-title').textContent = 'MISSION';
    }
  }

  // Weapon wheel: radial selector (hold Tab/weapon button)
  buildWeaponWheel() {
    const el = document.createElement('div');
    el.id = 'weapon-wheel';
    el.innerHTML = `
      <div class="wheel-bg"></div>
      <div class="wheel-center"><span class="current-weapon">FISTS</span></div>
    `;
    document.body.appendChild(el);
    return el;
  }

  showWeaponWheel(save) {
    if (!this.weaponWheelEl) return;
    const slots = weaponSlotList(save.weapons, save.currentWeapon || 'fists');
    const WEAPON_ICONS = { fists: '✊', pistol: '🔫', smg: '🔫', shotgun: '🔫' };
    const centerAngle = -Math.PI / 2;
    const slotCount = slots.length;
    let html = '<div class="wheel-bg"></div><div class="wheel-center"><span class="current-weapon">' + (save.currentWeapon || 'fists').toUpperCase() + '</span></div>';
    for (let i = 0; i < slotCount; i++) {
      const s = slots[i];
      const angle = centerAngle + (i / slotCount) * Math.PI * 2;
      const radius = 100;
      const x = Math.cos(angle) * radius + 160 - 40;
      const y = Math.sin(angle) * radius + 160 - 40;
      html += `<div class="wheel-slot${s.on ? ' selected' : ''}" data-weapon="${s.key}" style="left:${x}px;top:${y}px"><span class="icon">${WEAPON_ICONS[s.key] || '❓'}</span><span class="label">${s.label}</span><span class="hotkey">${s.hotkey}</span></div>`;
    }
    this.weaponWheelEl.innerHTML = html;
    this.weaponWheelEl.classList.add('active');
    // Click handlers
    this.weaponWheelEl.querySelectorAll('.wheel-slot').forEach(slot => {
      slot.addEventListener('click', () => {
        const w = slot.dataset.weapon;
        if (save.weapons[w]) {
          save.currentWeapon = w;
          this.game.notify(WEAPONS[w].name + ' equipped.');
        }
        this.hideWeaponWheel();
      });
    });
  }

  hideWeaponWheel() {
    if (this.weaponWheelEl) this.weaponWheelEl.classList.remove('active');
  }

  // Phone pause menu: iPhone-style app grid
  buildPhoneMenu() {
    const el = document.createElement('div');
    el.id = 'phone-menu';
    el.innerHTML = `
      <div class="phone-header">
        <span class="phone-time">${this.formatPhoneTime()}</span>
        <span class="phone-battery">🔋 100%</span>
      </div>
      <div class="phone-apps">
        <button class="phone-app" data-app="map"><span class="icon">🗺️</span><span class="name">MAP</span><span class="desc">City map & GPS</span></button>
        <button class="phone-app" data-app="missions"><span class="icon">📋</span><span class="name">MISSIONS</span><span class="desc">Active & completed</span></button>
        <button class="phone-app" data-app="garage"><span class="icon">🚗</span><span class="name">GARAGE</span><span class="desc">Vehicles & upgrades</span></button>
        <button class="phone-app" data-app="radio"><span class="icon">📻</span><span class="name">RADIO</span><span class="desc">Stations & volume</span></button>
        <button class="phone-app" data-app="stats"><span class="icon">📊</span><span class="name">STATS</span><span class="desc">Progress & achievements</span></button>
        <button class="phone-app" data-app="settings"><span class="icon">⚙️</span><span class="name">SETTINGS</span><span class="desc">Game options</span></button>
        <button class="phone-app" data-app="contacts"><span class="icon">📞</span><span class="name">CONTACTS</span><span class="desc">Phone numbers</span></button>
        <button class="phone-app" data-app="camera"><span class="icon">📸</span><span class="name">CAMERA</span><span class="desc">Photo mode</span></button>
        <button class="phone-app" data-app="browser"><span class="icon">🌐</span><span class="name">BROWSER</span><span class="desc">In-game web</span></button>
      </div>
      <div class="phone-footer">
        <span>Brisa Bay</span>
        <span>${this.formatPhoneTime()}</span>
      </div>
      <div class="phone-detail" id="phone-detail"></div>
    `;
    document.body.appendChild(el);
    // App click handlers
    el.querySelectorAll('.phone-app').forEach(btn => {
      btn.addEventListener('click', () => this.openPhoneApp(btn.dataset.app));
    });
    return el;
  }

  formatPhoneTime() {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  openPhoneApp(app) {
    const detail = this.phoneMenuEl.querySelector('#phone-detail');
    const apps = {
      map: { title: 'MAP', content: '<p>City map with GPS tracking. Tap to set waypoint.</p>' },
      missions: { title: 'MISSIONS', content: '<p>Mission list and progress.</p>' },
      garage: { title: 'GARAGE', content: '<p>Your vehicles and upgrades.</p>' },
      radio: { title: 'RADIO', content: '<p>Station selector and volume.</p>' },
      stats: { title: 'STATS', content: '<p>Progress, collectibles, fares.</p>' },
      settings: { title: 'SETTINGS', content: '<p>Audio, graphics, controls.</p>' },
      contacts: { title: 'CONTACTS', content: '<p>Saved phone numbers.</p>' },
      camera: { title: 'CAMERA', content: '<p>Photo mode with filters.</p>' },
      browser: { title: 'BROWSER', content: '<p>In-game web browser.</p>' }
    };
    const a = apps[app] || { title: app.toUpperCase(), content: '<p>Coming soon.</p>' };
    detail.innerHTML = `<button class="back-btn">← Back</button><h2>${a.title}</h2>${a.content}`;
    detail.classList.add('active');
    detail.querySelector('.back-btn').addEventListener('click', () => this.closePhoneDetail());
  }

  closePhoneDetail() {
    const detail = this.phoneMenuEl.querySelector('#phone-detail');
    detail.classList.remove('active');
  }

  showPhoneMenu(save) {
    if (this.phoneMenuEl) {
      this.phoneMenuEl.querySelector('.phone-time').textContent = this.formatPhoneTime();
      this.phoneMenuEl.classList.add('active');
    }
  }

  hidePhoneMenu() {
    if (this.phoneMenuEl) {
      this.phoneMenuEl.classList.remove('active');
      this.closePhoneDetail();
    }
  }

  // Race HUD: shows during race_mode (top center)
  showRaceHUD(track, missionManager) {
    this.raceHUD = document.createElement('div');
    this.raceHUD.id = 'race-hud';
    this.raceHUD.style.cssText = `
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
      width: 400px; background: rgba(10,16,24,0.92); border: 2px solid #4a6fa5;
      border-radius: 12px; padding: 16px; color: #fff; font-family: Arial, sans-serif;
      z-index: 15; box-shadow: 0 0 30px rgba(0,0,0,0.8);
    `;
    this.raceHUD.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;border-bottom:1px solid rgba(74,111,165,0.3);padding-bottom:8px">
        <div>
          <div style="font-size:18px;font-weight:900;color:#ffd34d">${track.name}</div>
          <div style="font-size:11px;color:#8aa8c8">${track.type.toUpperCase()} • ${track.laps} LAP${track.laps > 1 ? 'S' : ''}</div>
        </div>
        <div style="text-align:right">
          <div id="race-timer" style="font-size:22px;font-weight:900;color:#ffd34d;font-family:monospace">--:--</div>
          <div id="race-position" style="font-size:12px;color:#bcd6ea">POS: 1/${(track.aiRacers || 4) + 1}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:11px">
        <div><span style="color:#8aa8c8">LAP</span><br><span id="race-lap" style="font-weight:900;color:#fff">1/${track.laps}</span></div>
        <div><span style="color:#8aa8c8">CHECKPOINT</span><br><span id="race-cp" style="font-weight:900;color:#fff">1/${track.checkpoints.length}</span></div>
        <div><span style="color:#8aa8c8">BEST</span><br><span id="race-best" style="font-weight:900;color:#fff">--:--</span></div>
      </div>
      <div id="race-delta" style="margin-top:8px;font-size:12px;color:#bcd6ea;text-align:center"></div>
    `;
    document.body.appendChild(this.raceHUD);
    this.raceTrack = track;
    this.raceManager = missionManager;
    this.raceBestLap = null;
    this.raceLapStart = performance.now();
  }

  updateRaceHUD(missionManager) {
    if (!this.raceHUD || !this.raceTrack) return;
    const track = this.raceTrack;
    const mm = missionManager;

    // Timer
    const timerEl = this.raceHUD.querySelector('#race-timer');
    const secs = Math.max(0, mm.timer);
    const mins = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    timerEl.textContent = mins.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
    timerEl.style.color = secs < 15 ? '#ff5a4d' : '#ffd34d';

    // Lap
    this.raceHUD.querySelector('#race-lap').textContent = (mm.raceLap || 1) + '/' + track.laps;

    // Checkpoint
    this.raceHUD.querySelector('#race-cp').textContent = (mm.raceIndex + 1) + '/' + track.checkpoints.length;

    // Position
    let pos = 1;
    for (const r of mm.racers || []) {
      if (r.raceLap > track.laps || (r.raceLap === track.laps && r.raceIndex >= track.checkpoints.length)) {
        pos++;
      }
    }
    this.raceHUD.querySelector('#race-position').textContent = 'POS: ' + pos + '/' + ((track.aiRacers || 4) + 1);

    // Best lap
    const now = performance.now();
    if (mm.raceIndex === 0 && mm.raceLap > 1) {
      const lapTime = (now - this.raceLapStart) / 1000;
      if (!this.raceBestLap || lapTime < this.raceBestLap) this.raceBestLap = lapTime;
      this.raceLapStart = now;
    }
    if (this.raceBestLap) {
      const bm = Math.floor(this.raceBestLap / 60);
      const bs = Math.floor(this.raceBestLap % 60);
      this.raceHUD.querySelector('#race-best').textContent = bm.toString().padStart(2, '0') + ':' + bs.toString().padStart(2, '0');
    }

    // Delta to leader (simplified)
    const deltaEl = this.raceHUD.querySelector('#race-delta');
    if (mm.racers && mm.racers.length > 0) {
      const leader = mm.racers.reduce((best, r) => {
        const rProg = r.raceLap * track.checkpoints.length + r.raceIndex;
        const bProg = best.raceLap * track.checkpoints.length + best.raceIndex;
        return rProg > bProg ? r : best;
      });
      const playerProg = (mm.raceLap - 1) * track.checkpoints.length + mm.raceIndex;
      const leaderProg = (leader.raceLap - 1) * track.checkpoints.length + leader.raceIndex;
      const diff = leaderProg - playerProg;
      if (diff > 0) {
        deltaEl.textContent = '+' + diff + ' CP behind leader';
        deltaEl.style.color = '#ff5a4d';
      } else if (diff < 0) {
        deltaEl.textContent = Math.abs(diff) + ' CP ahead';
        deltaEl.style.color = '#00ff88';
      } else {
        deltaEl.textContent = 'SIDE BY SIDE';
        deltaEl.style.color = '#ffd34d';
      }
    }
  }

  hideRaceHUD() {
    if (this.raceHUD) {
      this.raceHUD.remove();
      this.raceHUD = null;
      this.raceTrack = null;
      this.raceManager = null;
    }
  }
}