import { clamp } from '../../engine/noise.js';
import { DECK_HALF } from '../../world/layout.js';
import { JUMP_V, SLIDE_TIME } from '../constants.js';
import { ABILITIES } from '../../content/abilities.js';

// Player input: actions mapped onto the run, corner turns and the carrier ability.
// Installed on Game.prototype (see game/Game.js), so `this` is the Game.
export const ControlsSystem = {
  onAction(a) {
    const st = this.state;
    if (st === 'title') {
      if (a === 'confirm') this.start();
      return;
    }
    if (st === 'intro') {
      if (a === 'confirm' || a === 'pause') this.endIntro();
      return;
    }
    if (st === 'chars') {
      if (a === 'pause') this.closeChars();
      return;
    }
    if (st === 'over') {
      if (a === 'confirm') this.start();
      return;
    }
    if (st === 'paused') {
      if (a === 'pause' || a === 'confirm') this.resume();
      return;
    }
    if (st !== 'running') return;
    const p = this.p;
    if (a === 'pause') return this.pause();
    if (p.qte) return this.qteInput(a);
    if (a === 'thumper') return this.plantThumper();
    if (a === 'ability') return this.useAbility();
    if (p.ride > 0) return;
    if (a === 'left' || a === 'right') {
      const dir = a === 'left' ? -1 : 1;
      // approaching a corner, a press toward the bend is the turn (Temple Run style)
      const seg = p.seg;
      if (seg.next && !p.pendingTurn && dir === seg.turn && p.fly <= 0 && this.inTurnWindow()) {
        p.pendingTurn = dir;
        this.audio.whoosh(500, 1500, 0.18, 0.12);
        this.rhythmBreak();
        return;
      }
      const nl = clamp(p.lane + dir, -1, 1);
      if (nl !== p.lane) { p.lane = nl; this.audio.whoosh(600, 1200, 0.12, 0.1); this.rhythmBreak(); }
    } else if (a === 'jump' || a === 'tap') {
      if (p.fly > 0) return;
      if (p.grounded) {
        p.vy = JUMP_V;
        p.grounded = false;
        p.slideT = 0;
        p.airJumped = false;
        this.audio.jump();
        this.rhythmBreak();
      } else if (this.mods.doubleJump && !p.airJumped && p.y > -0.3) {
        p.vy = JUMP_V * 0.92;
        p.airJumped = true;
        this.audio.jump();
        this.puff(8, 0.5);
        this.rhythmBreak();
      }
    } else if (a === 'slide') {
      if (p.fly > 0) return;
      if (p.grounded) {
        if (p.slideT <= 0) { this.audio.slide(); this.rhythmBreak(); }
        p.slideT = SLIDE_TIME * (this.mods.slide || 1);
      } else {
        p.vy = Math.min(p.vy, -22);
        p.slideQueued = true;
      }
    }
  },

  // the stretch before a corner where a press toward the bend counts as the turn
  inTurnWindow() {
    const p = this.p;
    const d = p.seg.length - p.s;
    return d < Math.max(15, p.speed * 0.95) && d > -DECK_HALF;
  },

  // the carrier's active ability, on its cooldown
  useAbility() {
    const p = this.p, ab = this.char.active;
    if (p.abilityCd > 0 || p.ride > 0) return;
    // what each ability does lives in content/abilities.js
    if (ABILITIES[ab.id]?.use(this) === false) return;
    p.abilityCd = ab.cooldown;
    this.audio.powerup();
    this.toast(ab.name);
  },
};
