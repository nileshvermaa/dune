import * as THREE from 'three';

// Geometry of the trail that everything else lines up against. A segment's local frame runs
// along -z from its start, with +x to the runner's right.

export const LANE_W = 2.2; // distance between lane centres
export const LANES = [-1, 0, 1];
export const HALF_W = 3.6; // half-width of the runnable trail
export const DECK_HALF = 4.0; // half-size of the square where two segments meet

// the four headings a segment can take, and the yaw that faces each
export const DIRS = [
  new THREE.Vector3(0, 0, -1),
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(-1, 0, 0),
];
export const YAWS = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
