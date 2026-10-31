// "The Crossing" — an original story set on Arrakis. All prose here is written for this game.

export const HERO = 'Ishra';

export const PROLOGUE = [
  'The wells of Sietch Qanat are failing.',
  'Ishra, youngest of the water-carriers, must cross the open erg with the seed-water for a new cache before the storm season seals the desert.',
  'Keep to the old stone roads. Where the sand has swallowed them, walk without rhythm — or the Maker will hear you.',
];

// One chapter per biome visit; lines rotate on later cycles so the journey keeps unfolding.
export const CHAPTERS = {
  desert: {
    title: 'The Open Erg',
    lines: [
      'The dunes roll on like a sleeping sea. Somewhere beneath them, something listens.',
      'The road is older than the sietch. Older, some say, than the worms.',
      'Ishra counts water in heartbeats now, not days.',
    ],
  },
  shieldwall: {
    title: 'Beneath the Shield Wall',
    lines: [
      'Stone rises on either hand. Here, at least, the Maker cannot follow.',
      'The cliffs keep the wind at bay, and the silence close.',
      'Old carvings watch from the rock: hands raised against the sky.',
    ],
  },
  ruins: {
    title: 'The Drowned Sietch',
    lines: [
      'A sietch the sand took back. Its lanterns still remember how to burn.',
      'Someone carried water here once, along this very road.',
      'The arches stand because no one told them the city is gone.',
    ],
  },
  spice: {
    title: 'Where the Spice Breathes',
    lines: [
      'The air tastes of cinnamon and fire. The ground is restless here.',
      'Harvesters crawl on the horizon, loud as thunder. The worms will come for them first.',
      'Every breath of spice opens the eyes a little wider.',
    ],
  },
  storm: {
    title: 'Into the Coriolis',
    lines: [
      'The sky goes the colour of old blood. The storm eats light and sound alike.',
      'In the storm, even the Maker goes blind. Run.',
      'Sand like knives. Ishra pulls the hood tight and does not look back.',
    ],
  },
};

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
export const roman = (n) => ROMAN[n - 1] || String(n);

export function chapterFor(zoneId, visit) {
  const c = CHAPTERS[zoneId];
  return { title: c.title, line: c.lines[visit % c.lines.length] };
}

// One-time beats the first time something happens in a run.
export const BEATS = {
  firstSand: 'The stone road ends. Sand has swallowed it. Break your stride — the Maker hears a steady step.',
  tooRegular: 'Too even. A pattern is still a rhythm.',
  wormRising: 'Wormsign. Vary your steps — or plant a thumper.',
  thumper: 'The thumper pounds the sand. Far off, the Maker turns toward the false heartbeat.',
  gotThumper: 'A thumper. One false heartbeat, to spend wisely.',
  gotHooks: 'Maker hooks. If the worm rises beneath you, you need not die — you can ride.',
  ride: 'Hooks set. The great back rises. For a moment, Ishra rides the desert itself.',
  rideEnd: 'The Maker sounds and dives. Ishra leaps for the stones.',
  lowWater: 'The stillsuit catchpockets run dry. Find water, or become water for the sand.',
  cache: 'A cache of the old roads. Sweet water — enough to go on.',
  vision: 'The spice opens the mind. For a heartbeat the path ahead is already walked.',
  shieldSand: 'A shield on open sand drives the Maker to frenzy. Hurry.',
  thopter: 'An ornithopter from Qanat drops low. Grab the skid!',
};

export const DEATHS = {
  crash: ['Broken on the Stones', 'The road was kind. Ishra was too fast for it.'],
  geyser: ['Consumed by a Spice Blow', 'The desert exhaled, and Ishra was in its breath.'],
  fall: ['Swallowed by the Sand', 'Where the road broke, the desert was waiting.'],
  worm: ['Taken by the Maker', 'The rhythm carried. The Maker answered.'],
  thirst: ['The Desert Drank Its Fill', 'Every drop returns to Arrakis in the end.'],
};

// Original desert sayings, shown on the title and game-over screens.
export const SAYINGS = [
  'Water spent in haste is water owed to the sand.',
  'The rock remembers every footstep. The sand forgets — but the Maker does not.',
  'A steady heart is a loud heart on open sand.',
  'Carry your water as you carry your name.',
  'The desert does not hate you. It simply has no need of you.',
  'Whoever would ride the Maker must first be willing to be swallowed by it.',
  'Every grain moves. Learn to move like one of them.',
  'The road ends where the sand begins. The journey does not.',
];

export const saying = () => SAYINGS[Math.floor(Math.random() * SAYINGS.length)];
