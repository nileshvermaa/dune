import { describe, expect, it } from 'vitest';
import {
  speedAt, layoutDifficulty, obstacleSpacing, stoneChance, stoneLength,
  wormsignPerMetre, straightLimit, BREAK_RELIEF, BREAK_STRAIGHT, rideDifficulty, promptFor, rideLength, balanceInterval,
} from '../src/content/difficulty.js';
import { mulberry32 } from '../src/engine/noise.js';

const distances = Array.from({ length: 401 }, (_, i) => i * 250); // 0 → 100 km

describe('speed', () => {
  it('starts at a jog and never stops climbing', () => {
    expect(speedAt(0)).toBeCloseTo(14);
    for (let i = 1; i < distances.length; i++) expect(speedAt(distances[i])).toBeGreaterThan(speedAt(distances[i - 1]));
  });

  it('has no ceiling: still gaining after the early ramp settles', () => {
    expect(speedAt(20000) - speedAt(10000)).toBeGreaterThan(20);
    expect(speedAt(100000)).toBeGreaterThan(250);
  });
});

describe('trail layout', () => {
  it('layout difficulty runs 0..1 and holds at 1', () => {
    expect(layoutDifficulty(0)).toBe(0);
    expect(layoutDifficulty(4500)).toBeCloseTo(0.5);
    expect(layoutDifficulty(50000)).toBe(1);
  });

  it('always leaves at least 16 m between obstacles', () => {
    const rng = mulberry32(7);
    for (const d of distances) expect(obstacleSpacing(speedAt(d), layoutDifficulty(d), rng)).toBeGreaterThanOrEqual(16);
  });

  it('old paving gets rarer and shorter but never vanishes', () => {
    expect(stoneChance(1)).toBeLessThan(stoneChance(0));
    expect(stoneChance(1)).toBeGreaterThan(0);
    expect(stoneLength(1, () => 1)).toBeLessThan(stoneLength(0, () => 1));
    expect(stoneLength(1, () => 0)).toBeGreaterThanOrEqual(16);
  });
});

describe('the Maker', () => {
  // metres of open sand a runner covers from no wormsign until the Maker arrives
  const metresToWorm = (runDist, weaveEvery = Infinity) => {
    let sign = 0, straight = 0;
    for (let m = 1; m < 5000; m++) {
      straight += 1;
      sign += wormsignPerMetre(straight, runDist + m);
      if (m % weaveEvery === 0) { straight *= BREAK_STRAIGHT.lane; sign = Math.max(0, sign - BREAK_RELIEF.lane); }
      if (sign >= 100) return m;
    }
    return Infinity;
  };

  it('a straight line across open sand brings the Maker within a couple of hundred metres', () => {
    expect(metresToWorm(2000)).toBeGreaterThan(120);
    expect(metresToWorm(2000)).toBeLessThan(220);
    expect(metresToWorm(12000)).toBeLessThan(metresToWorm(2000)); // the line shortens deeper in
    expect(metresToWorm(0)).toBeGreaterThan(metresToWorm(2000)); // gentle for the first stretch
  });

  it('weaving between lanes keeps it away', () => {
    expect(metresToWorm(2000, 40)).toBe(Infinity);
    expect(metresToWorm(12000, 30)).toBe(Infinity);
  });

  it('the longer the line, the faster the sign climbs', () => {
    expect(wormsignPerMetre(100, 2000)).toBeGreaterThan(wormsignPerMetre(20, 2000) * 4);
    expect(straightLimit(12000)).toBeLessThan(straightLimit(0));
    expect(BREAK_STRAIGHT.lane).toBe(0);
    expect(BREAK_RELIEF.lane).toBeGreaterThan(BREAK_RELIEF.jump);
  });

  it('ride difficulty rises with distance and rides, clamped to 0..1', () => {
    expect(rideDifficulty(0, 0)).toBe(0);
    expect(rideDifficulty(3000, 2)).toBeGreaterThan(rideDifficulty(3000, 0));
    expect(rideDifficulty(1e6, 50)).toBe(1);
  });

  it('hook prompts get longer and quicker, but stay humanly possible', () => {
    const easy = promptFor('hook', 0), hard = promptFor('hook', 1);
    expect(easy.steps).toBe(1);
    expect(hard.steps).toBeGreaterThan(easy.steps);
    expect(hard.window).toBeLessThan(easy.window);
    expect(hard.window).toBeGreaterThanOrEqual(0.6);
    expect(promptFor('balance', 1).window).toBeGreaterThanOrEqual(0.6);
  });

  it('rides shorten and balance checks come sooner with difficulty', () => {
    expect(rideLength(1)).toBeLessThan(rideLength(0));
    expect(rideLength(1)).toBeGreaterThan(5);
    expect(balanceInterval(1)).toBeLessThan(balanceInterval(0));
    expect(balanceInterval(1)).toBeGreaterThan(promptFor('balance', 1).window);
  });
});
