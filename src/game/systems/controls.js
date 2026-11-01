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
      const seg = p.seg;
      if (p.fly > 0 || p.strayed) return;
      // approaching a corner, a press toward the bend is the turn (Temple Run style)
      const towardBend = seg.next && !p.pendingTurn && dir === seg.turn;
      const commitTurn = () => {
        p.pendingTurn = dir;
        this.audio.whoosh(500, 1500, 0.18, 0.12);
        this.rhythmBreak('turn');
      };
      if (towardBend && this.inTurnWindow()) return commitTurn();
      if (Math.abs(p.lane + dir) <= 1) {
        p.lane += dir;
        this.audio.whoosh(600, 1200, 0.12, 0.1);
        this.rhythmBreak('lane');
        return;
      }
      // already on the trail's edge: toward a bend that is in sight, take it as an early turn;
      // anywhere else there is no turn, and the runner strides off the trail into the deep sand
      if (towardBend && seg.length - p.s < Math.max(30, p.speed * 1.9)) return commitTurn();
      // a double swipe on a turn already taken (or just made) is not a step off the edge
      if (p.pendingTurn || this.time - (p.turnedAt ?? -9) < 0.7) return;
      p.strayed = dir;
      p.lane = dir * 2.4;
      this.audio.whoosh(400, 900, 0.2, 0.12);
    } else if (a === 'jump' || a === 'tap') {
      if (p.fly > 0) return;
      if (p.grounded) {
        p.vy = JUMP_V;
        p.grounded = false;
        p.slideT = 0;
        p.slideQueued = false;
        p.jumpQueued = false;
        p.airJumped = false;
        this.audio.jump();
        this.rhythmBreak();
      } else if (this.mods.doubleJump && !p.airJumped && p.y > -0.3) {
        p.vy = JUMP_V * 0.92;
        p.airJumped = true;
        p.jumpQueued = false;
        p.slideQueued = false;
        this.audio.jump();
        this.puff(8, 0.5);
        this.rhythmBreak();
      } else {
        p.jumpQueued = true;
        p.slideQueued = false;
      }
    } else if (a === 'slide') {
      if (p.fly > 0) return;
      p.jumpQueued = false;
      if (p.grounded) {
        if (p.slideT <= 0) { this.audio.slide(); this.rhythmBreak('slide'); }
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
