// Pickups that change the rules for a while.
//
// To add a powerup:
//   1. add an entry to POWERUPS: a spawn `weight` (0 = never spawned on the trail) and an
//      `apply(game)` that changes the run state;
//   2. give it a model: a branch for its id in makePowerup() (world/props.js);
//   3. if it lasts a while, add a row to STATUS so the HUD shows it running down.
// tests/content.test.js checks that every spawnable powerup has a model branch.

import { RIDE_TIME } from './difficulty.js';

export const TRANCE_TIME = 7;
export const THOPTER_TIME = 7.5;
export const SILENCE_TIME = 10;
export const SEAL_TIME = 15;
export const RUSH_TIME = 5;

export const POWERUPS = {
  shield: {
    name: 'Holtzman shield', weight: 16, glow: 'blue',
    apply(game) {
      game.p.shield = true;
      game.runner.setShield(true);
      game.toast('Holtzman shield active');
    },
  },
  thumper: {
    name: 'Thumper', weight: 22,
    apply(game) {
      game.p.thumpers = Math.min(3, game.p.thumpers + 1);
      game.beat('gotThumper');
      game.syncInventory();
    },
  },
  hooks: {
    name: 'Maker hooks', weight: 16,
    apply(game) {
      game.p.hooks = 1;
      game.beat('gotHooks');
      game.syncInventory();
    },
  },
  thopter: {
    name: 'Ornithopter', weight: 10,
    apply(game) {
      game.p.fly = THOPTER_TIME;
      game.p.slideT = 0;
      game.audio.thopter(true);
      game.beat('thopter', true);
    },
  },
  silence: {
    name: 'Silent Step', weight: 12,
    apply(game) {
      game.p.silent = SILENCE_TIME;
      game.toast('Silent Step — the sand forgets your footsteps');
    },
  },
  seal: {
    name: 'Stillsuit Seal', weight: 12,
    apply(game) {
      game.p.seal = SEAL_TIME;
      game.toast('Stillsuit sealed — not a drop lost');
    },
  },
  rush: {
    name: 'Spice Rush', weight: 12,
    apply(game) {
      game.p.rush = RUSH_TIME;
      game.flash('#ff8a2a', 0.35);
      game.toast('Spice Rush — nothing stands in your way');
    },
  },
  // granted by spice (prescience) rather than found on the trail
  trance: {
    name: 'Spice trance', weight: 0,
    apply(game) {
      game.p.trance = TRANCE_TIME;
      game.toast('Spice trance — time bends, spice flows to you');
    },
  },
};

// one weighted draw among the powerups that spawn on the trail
export function pickPowerup(rng) {
  const pool = Object.entries(POWERUPS).filter(([, d]) => d.weight > 0);
  const total = pool.reduce((a, [, d]) => a + d.weight, 0);
  let r = rng() * total;
  for (const [id, d] of pool) {
    r -= d.weight;
    if (r <= 0) return id;
  }
  return pool[pool.length - 1][0];
}

// Effects shown running down in the HUD, in display order. level(p) is the fraction left (0 hides it).
export const STATUS = [
  { label: 'Shield', color: '#5fb8ff', level: (p) => (p.shield ? 1 : 0) },
  { label: 'Prescience', color: '#9d7bff', level: (p) => p.trance / TRANCE_TIME },
  { label: 'Sandrider', color: '#ffb35c', level: (p) => p.ride / RIDE_TIME },
  { label: 'Thumper', color: '#ff8a2a', level: (p) => p.lure / 7 },
  { label: 'Thopter', color: '#ffc54a', level: (p) => p.fly / THOPTER_TIME },
  { label: 'Silent Step', color: '#f1e6cc', level: (p) => p.silent / SILENCE_TIME },
  { label: 'Sealed', color: '#5fe0d0', level: (p) => p.seal / SEAL_TIME },
  { label: 'Spice Rush', color: '#ff8a2a', level: (p) => p.rush / RUSH_TIME },
];
