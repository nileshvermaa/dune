// Every difficulty curve in one place, so the game can be tuned without hunting through the
// systems. All are pure functions of how far the run has gone (and how often the Maker has
// been ridden), which keeps them easy to test and to graph.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// Running speed (m/s). Never stops climbing: a quick early ramp, then +2.5 m/s every kilometre.
export function speedAt(dist) {
  return 14 + 6 * (1 - Math.exp(-dist / 1500)) + dist * 0.0025;
}

// How dense and unforgiving the trail is laid out, 0 at the start to 1 by 9 km.
export const layoutDifficulty = (dist) => clamp(dist / 9000, 0, 1);

// Gap to the next obstacle (m): about a second of reaction time, tightening with layout difficulty.
export function obstacleSpacing(speed, diff, rng) {
  return Math.max(16, speed * (1.15 - diff * 0.3)) + rng() * 14 * (1.2 - diff);
}

// Chance and length of a surviving stretch of old paving (safe ground) in a segment.
export const stoneChance = (diff) => 0.55 - diff * 0.25;
export const stoneLength = (diff, rng) => 16 + rng() * 22 * (1 - diff * 0.5);

// Wormsign gained per second of steady running on open sand (before carrier and powerup modifiers).
export function wormsignRate(speed, runDist) {
  const ease = Math.min(1, 0.45 + runDist / 600); // gentle for the first stretch
  return (9 + speed * 0.28) * ease;
}

// How hard the Maker is to hook and to hold, 0..1: rises with distance and with every ride.
export function rideDifficulty(runDist, rides) {
  return clamp(runDist / 9000 + rides * 0.12, 0, 1);
}

export const RIDE_TIME = 14; // seconds of a ride at difficulty 0

// The quick-time prompt for a given difficulty: how many directions, how long for each.
export function promptFor(kind, d) {
  if (kind === 'hook') return { steps: 1 + Math.round(d * 3), window: 1.35 - d * 0.65 };
  return { steps: 1, window: 1.1 - d * 0.45 }; // balance check while riding
}

export const rideLength = (d) => RIDE_TIME * (1 - d * 0.45);
export const balanceInterval = (d) => 4.5 - d * 1.8;
