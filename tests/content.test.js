import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHARACTERS, characterById, isUnlocked } from '../src/content/characters.js';
import { ABILITIES } from '../src/content/abilities.js';
import { POWERUPS, STATUS, pickPowerup } from '../src/content/powerups.js';
import { ZONES, zoneAt } from '../src/content/zones.js';
import { WAYPOINTS, waypointAt, DEATHS } from '../src/content/story.js';
import { OBSTACLES, EARLY_MIX } from '../src/world/obstacles.js';
import { mulberry32 } from '../src/engine/noise.js';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('carriers', () => {
  it('have unique ids and one free starter', () => {
    const ids = CHARACTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CHARACTERS.filter((c) => !c.unlock)).toHaveLength(1);
    expect(characterById('nobody')).toBe(CHARACTERS[0]);
  });

  it('each has an ability that exists, with a cooldown', () => {
    for (const c of CHARACTERS) {
      expect(ABILITIES[c.active.id], `${c.id} → ${c.active.id}`).toBeDefined();
      expect(c.active.cooldown).toBeGreaterThan(0);
      expect(c.active.name).toBeTruthy();
    }
  });

  it('each wears one of the skinned bodies', () => {
    for (const c of CHARACTERS) expect(['f', 'm'], c.id).toContain(c.look.body);
  });

  it('only use rule modifiers the game understands', () => {
    const known = ['drain', 'crashCost', 'signRate', 'breakBonus', 'magnet', 'vision', 'hookWindow', 'hookSteps',
      'rideTime', 'hooks', 'doubleJump', 'slide', 'shieldEvery', 'stoneWater'];
    for (const c of CHARACTERS) for (const k of Object.keys(c.mods)) expect(known, `${c.id}.mods.${k}`).toContain(k);
  });

  it('unlock by best distance, or by purchase', () => {
    const locked = CHARACTERS.find((c) => c.unlock);
    expect(isUnlocked(locked, {})).toBe(false);
    expect(isUnlocked(locked, { bestDist: locked.unlock.dist })).toBe(true);
    expect(isUnlocked(locked, { unlocked: [locked.id] })).toBe(true);
    expect(isUnlocked(CHARACTERS.find((c) => !c.unlock), {})).toBe(true);
  });

  it('unlock later carriers further out and for more spice', () => {
    const gated = CHARACTERS.filter((c) => c.unlock);
    for (let i = 1; i < gated.length; i++) {
      expect(gated[i].unlock.dist).toBeGreaterThan(gated[i - 1].unlock.dist);
      expect(gated[i].unlock.spice).toBeGreaterThan(gated[i - 1].unlock.spice);
    }
  });
});

describe('powerups', () => {
  const spawnable = Object.entries(POWERUPS).filter(([, d]) => d.weight > 0).map(([id]) => id);

  it('have sane weights and an effect', () => {
    for (const [id, d] of Object.entries(POWERUPS)) {
      expect(d.weight, id).toBeGreaterThanOrEqual(0);
      expect(typeof d.apply, id).toBe('function');
    }
    expect(spawnable.length).toBeGreaterThan(0);
  });

  it('every spawnable powerup has a model in makePowerup()', () => {
    const props = source('../src/world/props.js');
    for (const id of spawnable) expect(props.includes(`type === '${id}'`), `makePowerup branch for '${id}'`).toBe(true);
  });

  it('are drawn in proportion to their weights', () => {
    const rng = mulberry32(3);
    const counts = {};
    const n = 20000;
    for (let i = 0; i < n; i++) { const id = pickPowerup(rng); counts[id] = (counts[id] || 0) + 1; }
    const total = spawnable.reduce((a, id) => a + POWERUPS[id].weight, 0);
    for (const id of spawnable) expect(counts[id] / n).toBeCloseTo(POWERUPS[id].weight / total, 1);
    expect(Object.keys(counts).every((id) => spawnable.includes(id))).toBe(true);
  });

  it('status rows read a level from the run state', () => {
    const idle = { shield: false, trance: 0, ride: 0, lure: 0, fly: 0, silent: 0, seal: 0, rush: 0 };
    for (const s of STATUS) {
      expect(s.label).toBeTruthy();
      expect(s.level(idle)).toBeLessThanOrEqual(0);
    }
  });
});

describe('the trail', () => {
  it('every obstacle a zone (or the opening mix) asks for exists', () => {
    for (const z of ZONES) for (const id of Object.keys(z.weights)) expect(OBSTACLES[id], `${z.id} → ${id}`).toBeDefined();
    for (const id of Object.keys(EARLY_MIX)) expect(OBSTACLES[id]).toBeDefined();
  });

  it('every obstacle can be placed', () => {
    for (const [id, o] of Object.entries(OBSTACLES)) expect(typeof o.place, id).toBe('function');
  });

  it('zones have unique ids and cycle by distance', () => {
    expect(new Set(ZONES.map((z) => z.id)).size).toBe(ZONES.length);
    const cycle = ZONES.reduce((a, z) => a + z.length, 0);
    expect(zoneAt(0).zone).toBe(ZONES[0]);
    expect(zoneAt(cycle + 1).zone).toBe(ZONES[0]);
    expect(zoneAt(ZONES[0].length).zone).toBe(ZONES[1]);
  });
});

describe('the story', () => {
  it('waypoints lie further and further out, forever', () => {
    for (let i = 1; i < WAYPOINTS.length + 5; i++) expect(waypointAt(i).at).toBeGreaterThan(waypointAt(i - 1).at);
    expect(waypointAt(WAYPOINTS.length + 2).name).toBeTruthy();
  });

  it('every way to die has an epitaph', () => {
    const systems = ['run', 'maker', 'controls', 'narrative', 'hud', 'presentation', 'render', 'carriers']
      .map((k) => source(`../src/game/systems/${k}.js`)).join('\n') + source('../src/game/Game.js');
    const causes = new Set([...systems.matchAll(/die\('([a-z]+)'/g)].map((m) => m[1]));
    expect(causes.size).toBeGreaterThan(0);
    for (const c of causes) expect(DEATHS[c], c).toBeDefined();
  });
});
