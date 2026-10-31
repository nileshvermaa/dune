import * as THREE from 'three';

// Physics and timing shared by the game systems. Difficulty curves (how these change over a
// run) live in content/difficulty.js; durations of pickups in content/powerups.js.

export const GRAVITY = 40; // m/s² — snappier than real, for a readable jump arc
export const JUMP_V = 13.2; // take-off speed: ~0.66 s in the air
export const SLIDE_TIME = 0.8; // seconds under an arch
export const RIDE_OFFSET = -12.5; // how far beside the trail the ridden worm swims
export const FLY_H = 7; // height of the ornithopter skid ride
export const UP = new THREE.Vector3(0, 1, 0);

export { TRANCE_TIME, THOPTER_TIME } from '../content/powerups.js';
export { RIDE_TIME } from '../content/difficulty.js';

// distance milestones toasted during a run
export const MILESTONES = [
  [500, 'The desert notices you'], [1000, 'A true sandwalker'], [2000, 'Fremen pace'],
  [3500, 'The sietch speaks your name'], [5000, 'Rider of the deep desert'], [7500, 'Legend of the dunes'], [10000, 'Beyond the Shield Wall of legend'],
];

// short biome names for the game-over journey line, in zone order
export const ZONE_LABELS = ['Erg', 'Wall', 'Sietch', 'Spice', 'Storm'];
// seconds per story card / camera shot in the opening
export const INTRO_SHOT = 4.6;
// how much the land throws sound back: canyon walls and ruins echo, open sand swallows it
export const ROOM = { desert: 0.12, shieldwall: 0.65, ruins: 0.55, spice: 0.2, storm: 0.06 };
