// Biomes the causeway passes through, cycled by distance travelled.

export const ZONES = [
  {
    id: 'desert', name: 'The Deep Desert', length: 900,
    fogNear: 90, fogFar: 640, haze: 0, tint: [1, 1, 1], dust: 0.18, wind: 1,
    weights: { rock: 4, low: 2, arch: 2, gap: 2 },
  },
  {
    id: 'shieldwall', name: 'The Shield Wall', length: 900,
    fogNear: 80, fogFar: 560, haze: 0.05, tint: [0.96, 0.9, 0.92], dust: 0.2, wind: 0.8,
    weights: { rock: 5, low: 2, arch: 2, gap: 3 },
  },
  {
    id: 'ruins', name: 'Ruins of the Old Sietch', length: 900,
    fogNear: 80, fogFar: 580, haze: 0, tint: [1, 0.95, 0.9], dust: 0.16, wind: 0.9,
    weights: { column: 3, low: 3, arch: 4, gap: 2 },
  },
  {
    id: 'spice', name: 'The Spice Fields', length: 900,
    fogNear: 50, fogFar: 420, haze: 0.28, tint: [1.18, 0.82, 0.55], dust: 0.4, wind: 1.2,
    weights: { pipe: 3, geyser: 4, rock: 2, arch: 1, gap: 1 },
  },
  {
    id: 'storm', name: 'The Coriolis Storm', length: 650,
    fogNear: 4, fogFar: 125, haze: 1, tint: [0.9, 0.62, 0.38], dust: 1, wind: 3.2,
    weights: { rock: 3, low: 2, arch: 2, gap: 1 },
  },
];

const CYCLE = ZONES.reduce((a, z) => a + z.length, 0);

export function zoneAt(dist) {
  let d = ((dist % CYCLE) + CYCLE) % CYCLE;
  for (let i = 0; i < ZONES.length; i++) {
    if (d < ZONES[i].length) return { zone: ZONES[i], index: i, local: d };
    d -= ZONES[i].length;
  }
  return { zone: ZONES[0], index: 0, local: 0 };
}

// Path distance from `dist` to the start of the next zone with this id (0 if inside it).
export function distToZone(dist, id) {
  const here = zoneAt(dist);
  if (here.zone.id === id) return 0;
  let d = here.zone.length - here.local;
  for (let k = 1; k <= ZONES.length; k++) {
    const z = ZONES[(here.index + k) % ZONES.length];
    if (z.id === id) return d;
    d += z.length;
  }
  return Infinity;
}
