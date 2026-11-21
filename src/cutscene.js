// BRISA BAY — Cutscene System
// Simple camera lerp + typewriter text boxes + skip button
// No dialogue trees, no facial animation - just what's feasible now
import * as THREE from 'three';
import { lerp, clamp } from './utils.js';

export class CutsceneManager {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.queue = [];
    this.current = null;
    this.skipBtn = null;
    this.textBox = null;
    this.typewriterIndex = 0;
    this.typewriterTimer = 0;
    this.typewriterSpeed = 25; // ms per character
    this.cameraLerp = null;
    this.cameraLerpStart = null;
    this.cameraLerpEnd = null;
    this.cameraLerpDuration = 0;
    this.cameraLerpElapsed = 0;
    this.raceCountdown = null;
    this.countdownEl = null;
    this.pendingRaceGo = null;
    this.countdownDone = false;
  }

  // Queue a cutscene sequence
  play(steps, onComplete) {
    this.queue = steps.map((s, i) => ({
      ...s,
      index: i,
      done: false,
    }));
    this.onComplete = onComplete;
    this.active = true;
    this.next();
  }

  // Advance to next cutscene step
  next() {
    this.current = this.queue.find(s => !s.done);
    if (!this.current) {
      this.end();
      return;
    }
    this.current.done = true;
    this.executeStep(this.current);
  }

  executeStep(step) {
    const g = this.game;
    const p = g.player;

    switch (step.type) {
      case 'camera':
        // Camera lerp from current to target position/lookat
        this.startCameraLerp({
          fromPos: step.fromPos || new THREE.Vector3().copy(g.camera.position),
          fromTarget: step.fromTarget || new THREE.Vector3().copy(g.controls?.target || new THREE.Vector3()),
          toPos: step.toPos || new THREE.Vector3().copy(g.camera.position),
          toTarget: step.toTarget || new THREE.Vector3().copy(g.controls?.target || new THREE.Vector3()),
          duration: step.duration || 2.0,
          easing: step.easing || 'easeInOutCubic',
        });
        // Wall-clock advance: the lerp's update() completion only runs on
        // a frame, and frames can stall for tens of seconds (background
        // tab, slow software GL) — without this the cutscene would hang
        // on this step. The _advanced flag (shared with update()) makes
        // exactly one next() fire however the step finishes; on a normal
        // 60fps machine update() wins and this timeout is a no-op.
        {
          const stepRef = step;
          setTimeout(() => {
            if (this.current === stepRef && !stepRef._advanced) {
              stepRef._advanced = true;
              this.cameraLerp = null;
              this.next();
            }
          }, (step.duration || 2.0) * 1000 + 350);
        }
        break;

      case 'text':
        // Typewriter text box
        this.showText(step.text, step.duration || 4.0, step.position || 'bottom');
        break;

      case 'wait':
        // Just wait
        setTimeout(() => this.next(), (step.duration || 1.0) * 1000);
        break;

      case 'race_countdown':
        // 3-2-1-GO countdown for race start
        this.startRaceCountdown(step.onGo);
        return; // next() called from countdown

      case 'action':
        // Execute arbitrary function
        if (step.fn) step.fn(g);
        this.next();
        break;

      default:
        this.next();
    }
  }

  // Camera lerp with easing. Wall-clock driven (performance.now), NOT
  // accumulated frame dt: main.js clamps dt to 0.05s, so at a slow frame
  // rate (software GL, low-end phones) a dt-driven lerp would take
  // minutes of real time and mission cutscenes would never finish.
  startCameraLerp({ fromPos, fromTarget, toPos, toTarget, duration, easing }) {
    this.cameraLerp = {
      fromPos: fromPos.clone(),
      fromTarget: fromTarget.clone(),
      toPos: toPos.clone(),
      toTarget: toTarget.clone(),
      duration,
      easing,
      elapsed: 0,
      startWall: performance.now(),
    };
    // Disable player camera control during cutscene
    if (this.game.controls) this.game.controls.enabled = false;
    this.game.camera.updateMatrixWorld();
  }

  // Typewriter text box
  showText(text, duration, position) {
    if (!this.textBox) {
      this.textBox = document.createElement('div');
      this.textBox.id = 'cutscene-text';
      this.textBox.style.cssText = `
        position: fixed; left: 50%; transform: translateX(-50%);
        bottom: ${position === 'top' ? 'auto' : '80px'}; top: ${position === 'top' ? '80px' : 'auto'};
        width: 80%; max-width: 700px;
        background: rgba(10,16,24,0.95); border: 2px solid #4a6fa5;
        border-radius: 12px; padding: 20px 28px; color: #fff;
        font-family: Arial, sans-serif; font-size: 18px; line-height: 1.6;
        z-index: 50; box-shadow: 0 0 40px rgba(0,0,0,0.9);
        opacity: 0; transform: translateX(-50%) translateY(20px);
        transition: opacity .3s, transform .3s;
      `;
      document.body.appendChild(this.textBox);
    }
    this.textBox.textContent = '';
    this.textBox.style.opacity = '1';
    this.textBox.style.transform = 'translateX(-50%) translateY(0)';
    this.typewriterText = text;
    this.typewriterIndex = 0;
    this.typewriterTimer = 0;
    this.typewriterDuration = duration;
    this.typewriterStart = performance.now();

    // Auto-advance after duration
    this.typewriterTimeout = setTimeout(() => {
      this.hideText();
      this.next();
    }, duration * 1000 + text.length * this.typewriterSpeed);
  }

  hideText() {
    if (this.textBox) {
      this.textBox.style.opacity = '0';
      this.textBox.style.transform = 'translateX(-50%) translateY(-20px)';
    }
    if (this.typewriterTimeout) clearTimeout(this.typewriterTimeout);
  }

  // Race countdown: 3, 2, 1, GO!
  startRaceCountdown(onGo) {
    // Remember the GO callback: if the player skips the countdown, skip()
    // fires it so the race still starts instead of hanging in race_loading.
    this.pendingRaceGo = onGo || null;
    this.countdownDone = false;
    if (!this.countdownEl) {
      this.countdownEl = document.createElement('div');
      this.countdownEl.id = 'race-countdown';
      this.countdownEl.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);
        font-size: 120px; font-weight: 900; color: #ffd34d;
        text-shadow: 0 4px 0 rgba(0,0,0,0.8), 0 0 40px rgba(255,211,77,0.6);
        z-index: 60; pointer-events: none; opacity: 0;
        transition: opacity .15s, transform .15s;
        font-family: 'Impact', 'Arial Black', sans-serif;
        letter-spacing: 4px;
      `;
      document.body.appendChild(this.countdownEl);
    }

    const sequence = ['3', '2', '1', 'GO!'];
    let i = 0;

    const showNumber = (num) => {
      this.countdownEl.textContent = num;
      this.countdownEl.style.opacity = '1';
      this.countdownEl.style.transform = 'translate(-50%,-50%) scale(1)';
      // Pulse animation
      this.countdownEl.animate([
        { transform: 'translate(-50%,-50%) scale(1.5)', opacity: 0 },
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.3 },
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.7 },
        { transform: 'translate(-50%,-50%) scale(0.8)', opacity: 0 },
      ], { duration: 900, easing: 'cubic-bezier(0.25,0.46,0.45,0.94)' });

      setTimeout(() => {
        // The countdown may already be over (skipped): countdownDone is
        // set on GO, so a stale timeout must not fire it a second time
        // (that would re-enter the race and double-spawn the grid).
        if (this.countdownDone) return;
        i++;
        if (i < sequence.length) {
          showNumber(sequence[i]);
        } else {
          this.countdownEl.style.opacity = '0';
          this.countdownDone = true;
          this.pendingRaceGo = null;
          if (onGo) onGo();
          this.next();
        }
      }, 900);
    };

    showNumber(sequence[0]);
  }

  // Create skip button
  createSkipButton() {
    if (this.skipBtn) return;
    this.skipBtn = document.createElement('button');
    this.skipBtn.id = 'cutscene-skip';
    this.skipBtn.textContent = 'SKIP';
    this.skipBtn.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 55;
      padding: 10px 24px; background: rgba(255,90,77,0.9);
      border: 2px solid #ff5a4d; border-radius: 6px;
      color: #fff; font: 700 14px Arial, sans-serif;
      cursor: pointer; transition: all .15s;
      box-shadow: 0 4px 20px rgba(255,90,77,0.4);
    `;
    this.skipBtn.addEventListener('mouseenter', () => {
      this.skipBtn.style.background = '#ff5a4d';
      this.skipBtn.style.boxShadow = '0 6px 30px rgba(255,90,77,0.6)';
    });
    this.skipBtn.addEventListener('mouseleave', () => {
      this.skipBtn.style.background = 'rgba(255,90,77,0.9)';
      this.skipBtn.style.boxShadow = '0 4px 20px rgba(255,90,77,0.4)';
    });
    this.skipBtn.addEventListener('click', () => this.skip());
    document.body.appendChild(this.skipBtn);
  }

  removeSkipButton() {
    if (this.skipBtn) {
      this.skipBtn.remove();
      this.skipBtn = null;
    }
  }

  skip() {
    // Clear all timeouts
    if (this.typewriterTimeout) clearTimeout(this.typewriterTimeout);
    // A skipped race countdown still goes: fire GO so the race starts.
    if (this.pendingRaceGo) {
      const go = this.pendingRaceGo;
      this.pendingRaceGo = null;
      this.countdownDone = true;
      go();
    }
    // Hide UI
    this.hideText();
    if (this.countdownEl) this.countdownEl.style.opacity = '0';
    // Finish camera lerp immediately
    this.cameraLerp = null;
    // Clear queue
    this.queue = [];
    this.end();
  }

  end() {
    this.active = false;
    this.current = null;
    this.hideText();
    if (this.countdownEl) this.countdownEl.style.opacity = '0';
    this.cameraLerp = null;
    this.removeSkipButton();
    // Re-enable player camera
    if (this.game.controls) this.game.controls.enabled = true;
    if (this.onComplete) {
      const cb = this.onComplete;
      this.onComplete = null;
      cb();
    }
  }

  // Update every frame
  update(dt) {
    if (!this.active) return;

    // Update camera lerp from wall-clock time (see startCameraLerp):
    // dt is clamped to 0.05s in main.js, so accumulating it would stall
    // the lerp for minutes at a slow frame rate.
    if (this.cameraLerp) {
      this.cameraLerp.elapsed = (performance.now() - this.cameraLerp.startWall) / 1000;
      const t = clamp(this.cameraLerp.elapsed / this.cameraLerp.duration, 0, 1);
      const eased = this.ease(t, this.cameraLerp.easing);

      const pos = new THREE.Vector3().lerpVectors(this.cameraLerp.fromPos, this.cameraLerp.toPos, eased);
      const target = new THREE.Vector3().lerpVectors(this.cameraLerp.fromTarget, this.cameraLerp.toTarget, eased);

      this.game.camera.position.copy(pos);
      if (this.game.controls) this.game.controls.target.copy(target);

      if (t >= 1) {
        this.cameraLerp = null;
        // If this was a camera step, advance after a brief pause.
        // _advanced is shared with the wall-clock timeout in
        // executeStep: whichever finishes the step first claims it, so
        // the step advances exactly once.
        if (this.current && this.current.type === 'camera' && !this.current._advanced) {
          this.current._advanced = true;
          setTimeout(() => this.next(), 300);
        }
      }
    }

    // Update typewriter effect from wall-clock time (same reason as the
    // camera lerp: dt is clamped, so accumulating it types far too slowly
    // at a slow frame rate). typewriterStart is set in showText.
    if (this.textBox && this.typewriterText && this.typewriterIndex < this.typewriterText.length) {
      this.typewriterTimer = performance.now() - this.typewriterStart;
      const targetIndex = Math.floor(this.typewriterTimer / this.typewriterSpeed);
      if (targetIndex > this.typewriterIndex) {
        this.typewriterIndex = Math.min(targetIndex, this.typewriterText.length);
        this.textBox.textContent = this.typewriterText.substring(0, this.typewriterIndex);
      }
    }
  }

  ease(t, type) {
    switch (type) {
      case 'easeInOutCubic':
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      case 'easeOutCubic':
        return 1 - Math.pow(1 - t, 3);
      case 'easeInCubic':
        return t * t * t;
      case 'linear':
      default:
        return t;
    }
  }

  // Convenience: play mission intro cutscene. `lines` is optional
  // [speaker, line] dialogue played after the brief — the story round's
  // character lines. Existing callers pass three args; nothing changes.
  playMissionIntro(missionName, brief, onComplete, lines = []) {
    this.createSkipButton();
    const steps = [
      {
        type: 'camera',
        toPos: new THREE.Vector3(0, 50, 80),
        toTarget: new THREE.Vector3(0, 5, 0),
        duration: 2.5,
        easing: 'easeInOutCubic',
      },
      {
        type: 'text',
        text: missionName,
        duration: 2.0,
        position: 'top',
      },
      {
        type: 'text',
        text: brief,
        duration: 3.5,
        position: 'bottom',
      },
    ];
    for (const [who, line] of lines) {
      steps.push({ type: 'text', text: who + ': "' + line + '"', duration: 2.6, position: 'bottom' });
    }
    steps.push({
      type: 'camera',
      toPos: new THREE.Vector3().copy(this.game.camera.position),
      toTarget: new THREE.Vector3().copy(this.game.controls?.target || new THREE.Vector3()),
      duration: 1.5,
      easing: 'easeOutCubic',
    });
    this.play(steps, onComplete);
  }

  // Convenience: play mission outro cutscene
  playMissionOutro(missionName, reward, onComplete, lines = []) {
    this.createSkipButton();
    const steps = [
      {
        type: 'camera',
        toPos: new THREE.Vector3(0, 40, 60),
        toTarget: new THREE.Vector3(this.game.player.pos.x, 3, this.game.player.pos.z),
        duration: 2.0,
        easing: 'easeInOutCubic',
      },
      {
        type: 'text',
        text: missionName + ' COMPLETE',
        duration: 2.0,
        position: 'top',
      },
      {
        type: 'text',
        text: 'Reward: $' + reward.toLocaleString('en-US'),
        duration: 2.5,
        position: 'bottom',
      },
    ];
    for (const [who, line] of lines) {
      steps.push({ type: 'text', text: who + ': "' + line + '"', duration: 2.6, position: 'bottom' });
    }
    steps.push({
      type: 'camera',
      toPos: new THREE.Vector3().copy(this.game.camera.position),
      toTarget: new THREE.Vector3().copy(this.game.controls?.target || new THREE.Vector3()),
      duration: 1.0,
      easing: 'easeOutCubic',
    });
    this.play(steps, onComplete);
  }

  // Convenience: race countdown + start
  playRaceStart(onGo) {
    this.play([
      { type: 'race_countdown', onGo },
    ], () => {}); // onComplete handled by onGo
  }
}