// Carrier active abilities, keyed by the `active.id` a character declares in characters.js.
//
// To add an ability:
//   1. add an entry here whose use(game) changes the run; return false when it cannot be used
//      right now (the cooldown is then not spent);
//   2. point a character's `active` at it, with a name, a one-line text and a cooldown.
// tests/content.test.js checks that every character's ability exists here.

import { JUMP_V } from '../game/constants.js';

export const ABILITIES = {
  // Stillness: the desert forgets you for a moment
  still: {
    use(game) {
      const p = game.p;
      p.sign = Math.max(0, p.sign - 50);
      game.flash('#bfe6ff', 0.25);
    },
  },
  // Call the Maker: summon a worm to hook, hooks or not
  call: {
    use(game) {
      const p = game.p;
      if (p.qte || p.fly > 0) return false;
      p.hooks = Math.max(p.hooks, 1);
      p.sign = 100;
      game.startQTE('hook');
    },
  },
  // Foresight: a short spice trance on demand
  foresight: {
    use(game) {
      game.p.trance = 4;
      game.flash('#8f7bff', 0.3);
    },
  },
  // Leap: a towering jump that clears anything
  leap: {
    use(game) {
      const p = game.p;
      if (p.fly > 0) return false;
      p.vy = JUMP_V * 1.9;
      p.grounded = false;
      p.airJumped = true;
      p.slideT = 0;
      p.invuln = Math.max(p.invuln, 1.5);
      game.audio.jump();
      game.puff(18, 0.8);
      game.rhythmBreak();
    },
  },
  // Volley: plant a thumper from nothing
  volley: {
    use(game) {
      game.p.thumpers++;
      game.plantThumper();
    },
  },
};
