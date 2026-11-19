// BRISA BAY — touch controls: a virtual joystick (left thumb) and action
// buttons (right thumb) for phones and tablets. Pointer events only, so
// mouse play is untouched; the whole layer stays hidden on devices without
// a touchscreen. The joystick drives the same axes the keyboard feeds, and
// pushing it to the edge runs. Buttons map 1:1 to keys: ENTER acts, SHOOT
// fires, JUMP hops (BRAKE in a car), WEAPON cycles guns, PAUSE opens the
// menu. All DOM and CSS are built here at runtime — index.html stays clean.
import { clamp } from './utils.js';

// Pure stick math, so the logic tests can drive it without a DOM: dx/dy
// are the knob offset in px from the stick centre, radius the stick size.
export function joystickAxes(dx, dy, radius) {
  const len = Math.hypot(dx, dy);
  const cl = len > radius ? radius / len : 1;
  const x = (dx * cl) / radius;
  const y = (dy * cl) / radius;
  return { fwd: clamp(-y, -1, 1), strafe: clamp(x, -1, 1), run: Math.hypot(x, y) > 0.85 };
}

export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || (typeof navigator !== 'undefined' && (navigator.maxTouchPoints || 0) > 0);
}

const TOUCH_CSS = [
  '#touch-ui{position:fixed;inset:0;z-index:6;pointer-events:none;display:none}',
  '#touch-ui.on{display:block}',
  '#stick-zone{position:absolute;left:18px;bottom:150px;width:132px;height:132px;border-radius:50%;pointer-events:auto;touch-action:none;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.28)}',
  '#stick-knob{position:absolute;left:50%;top:50%;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;background:rgba(255,255,255,0.32);border:1px solid rgba(255,255,255,0.55)}',
  '.tbtn{position:absolute;pointer-events:auto;touch-action:none;border-radius:50%;border:1px solid rgba(255,255,255,0.5);background:rgba(10,16,24,0.5);color:#fff;font:700 13px Arial,sans-serif;text-align:center}',
  '.tbtn:active{background:rgba(255,211,77,0.55)}',
  '#tb-enter{right:18px;bottom:150px;width:76px;height:76px;font-size:15px}',
  '#tb-shoot{right:108px;bottom:96px;width:64px;height:64px}',
  '#tb-jump{right:24px;bottom:246px;width:64px;height:64px}',
  '#tb-weapon{right:104px;bottom:190px;width:56px;height:56px;font-size:11px}',
  '#tb-pause{left:14px;top:12px;width:44px;height:44px;border-radius:8px;font-size:19px}',
].join('\n');

const STICK_R = 52; // px of knob travel from the stick centre

export class TouchControls {
  constructor(hooks) {
    this.hooks = hooks || {};
    this.axes = { fwd: 0, strafe: 0, run: false };
    this.brake = false;
    this.root = null;
    this.knob = null;
    this.btns = {};
    this.stickId = null;
    this.stickCx = 0;
    this.stickCy = 0;
    this.ctxSig = '';
  }

  // Builds the layer once. Returns false on a non-touch device (the game
  // plays on as before); tests can force it with { forceTouch: true }.
  attach() {
    if (!isTouchDevice() && !this.hooks.forceTouch) return false;
    if (this.root) return true;
    const st = document.createElement('style');
    st.textContent = TOUCH_CSS;
    document.head.appendChild(st);
    const root = document.createElement('div');
    root.id = 'touch-ui';
    root.className = 'on';
    const zone = document.createElement('div');
    zone.id = 'stick-zone';
    const knob = document.createElement('div');
    knob.id = 'stick-knob';
    zone.appendChild(knob);
    root.appendChild(zone);
    for (const [id, label] of [['enter', 'ENTER'], ['shoot', 'SHOOT'], ['jump', 'JUMP'], ['weapon', 'WEAPON'], ['pause', 'II']]) {
      const b = document.createElement('button');
      b.id = 'tb-' + id;
      b.className = 'tbtn';
      b.textContent = label;
      root.appendChild(b);
      this.btns[id] = b;
    }
    document.body.appendChild(root);
    this.root = root;
    this.knob = knob;
    this.bindStick(zone);
    this.bindButtons();
    return true;
  }

  bindStick(zone) {
    const move = (e) => {
      if (e.pointerId !== this.stickId) return;
      const a = joystickAxes(e.clientX - this.stickCx, e.clientY - this.stickCy, STICK_R);
      this.axes = a;
      const kx = clamp(e.clientX - this.stickCx, -STICK_R, STICK_R);
      const ky = clamp(e.clientY - this.stickCy, -STICK_R, STICK_R);
      this.knob.style.transform = 'translate(' + kx + 'px,' + ky + 'px)';
    };
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.stickId = e.pointerId;
      const r = zone.getBoundingClientRect();
      this.stickCx = r.left + r.width / 2;
      this.stickCy = r.top + r.height / 2;
      zone.setPointerCapture(e.pointerId);
      move(e);
    });
    zone.addEventListener('pointermove', move);
    const end = (e) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.axes = { fwd: 0, strafe: 0, run: false };
      this.knob.style.transform = '';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  bindButtons() {
    const h = this.hooks;
    const tap = (el, fn) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); if (fn) fn(); });
    };
    tap(this.btns.enter, () => { if (h.onEnter) h.onEnter(); });
    tap(this.btns.shoot, () => { if (h.onShoot) h.onShoot(); });
    tap(this.btns.weapon, () => { if (h.onWeapon) h.onWeapon(); });
    tap(this.btns.pause, () => { if (h.onPause) h.onPause(); });
    // JUMP on foot, BRAKE in a car: one thumb, two jobs, no extra button.
    this.btns.jump.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.inCar) { this.brake = true; if (h.onBrake) h.onBrake(true); }
      else if (h.onJump) h.onJump();
    });
    const release = () => {
      if (this.brake) { this.brake = false; if (h.onBrake) h.onBrake(false); }
    };
    this.btns.jump.addEventListener('pointerup', release);
    this.btns.jump.addEventListener('pointercancel', release);
  }

  // Called every HUD frame: labels and visibility follow the game, but
  // the DOM is only touched when something actually changed.
  setContext(ctx) {
    if (!this.root) return;
    this.inCar = !!ctx.inCar;
    const sig = [ctx.inCar ? 'car' : 'foot', ctx.weapon || 'fists'].join('|');
    if (sig === this.ctxSig) return;
    this.ctxSig = sig;
    this.btns.enter.textContent = ctx.inCar ? 'EXIT' : 'ENTER';
    this.btns.jump.textContent = ctx.inCar ? 'BRAKE' : 'JUMP';
    this.btns.shoot.textContent = ctx.weapon === 'fists' ? 'PUNCH' : 'SHOOT';
    this.btns.shoot.style.display = ctx.inCar ? 'none' : '';
    this.btns.jump.style.display = '';
  }
}
