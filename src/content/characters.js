// The carriers who can take the seed-water across the erg. Each shares the same skinned body and
// motion clips, dressed and proportioned differently, with a passive trait, an active ability on
// a cooldown, and a weakness, so each run plays differently.
//
// mods (all optional; 1 / 0 / false = no change):
//   drain       water drain multiplier          crashCost  extra water lost per crash
//   signRate    wormsign build multiplier       breakBonus extra wormsign removed per rhythm break
//   magnet      spice always drawn in           vision     prescience fill multiplier
//   hookWindow  hook prompt window multiplier   hookSteps  prompts added (negative removes)
//   rideTime    ride length multiplier          hooks      maker hooks at the start
//   doubleJump  a second jump in the air        slide      slide length multiplier
//   shieldEvery seconds for a Holtzman shield to recharge
//   stoneWater  water regained per second on old paving
// look: suit / cloak / hood / leather colours, body scale, shoulder and limb proportions,
//   cloak length, and the Ibad glow of the eyes

export const CHARACTERS = [
  {
    id: 'ishra',
    name: 'Ishra',
    role: 'Water-carrier',
    blurb: 'Youngest of the carriers. Light on the sand, careful with every drop.',
    passive: 'Stillsuit sealed tight: water drains 25% slower.',
    active: { id: 'still', name: 'Still the Breath', text: 'Calm your stride: wormsign drops by half.', cooldown: 24 },
    weakness: 'No special edge with the Maker.',
    unlock: null,
    mods: { drain: 0.75 },
    look: { suit: '#5c4a3b', cloak: ['#7d5d40', '#b8956b'], hood: '#8a6b4b', leather: '#6c472b', scale: 0.96, shoulders: 1, limbs: 1, cloakLen: 1.02, eyes: 0.55 },
  },
  {
    id: 'kaleb',
    name: 'Kaleb',
    role: 'Sandrider',
    blurb: 'Rode his first Maker at twelve. Carries hooks the way others carry water.',
    passive: 'Starts with Maker hooks. Hook prompts are slower and shorter; rides last 30% longer.',
    active: { id: 'call', name: 'Call the Maker', text: 'Summon the worm and hook it at once, even without hooks.', cooldown: 55 },
    weakness: 'Drinks hard: water drains 15% faster.',
    unlock: { dist: 1500, spice: 500 },
    mods: { hooks: 1, hookWindow: 1.4, hookSteps: -1, rideTime: 1.3, drain: 1.15 },
    look: { suit: '#3e3530', cloak: ['#6a2f1c', '#9a4f2c'], hood: '#5b3324', leather: '#4a3020', scale: 1.0, shoulders: 1.1, limbs: 1.02, cloakLen: 1.1, eyes: 0.7 },
  },
  {
    id: 'nadira',
    name: 'Nadira',
    role: 'Spice Diviner',
    blurb: 'Steeped in spice since birth. Sees the path a heartbeat before she runs it.',
    passive: 'Spice flows to her from every lane; prescience fills twice as fast.',
    active: { id: 'foresight', name: 'Foresight', text: 'Four seconds of spice-trance: time slows, spice flies to you.', cooldown: 30 },
    weakness: 'Smells of spice: wormsign builds 15% faster.',
    unlock: { dist: 3000, spice: 1000 },
    mods: { magnet: true, vision: 2, signRate: 1.15 },
    look: { suit: '#3b3550', cloak: ['#2f2a55', '#5a52a0'], hood: '#463f78', leather: '#3a3150', scale: 0.92, shoulders: 0.92, limbs: 0.98, cloakLen: 1.18, eyes: 1.8 },
  },
  {
    id: 'tarik',
    name: 'Tarik',
    role: 'Dune-dancer',
    blurb: 'A runner of the high ridges. Never touches the same sand twice.',
    passive: 'Double jump. Every break in stride quiets the sand a little more; slides run longer.',
    active: { id: 'leap', name: 'Dune Leap', text: 'A towering leap clear over anything ahead.', cooldown: 20 },
    weakness: 'Light kit: crashes cost 10 more water.',
    unlock: { dist: 5000, spice: 1600 },
    mods: { doubleJump: true, breakBonus: 6, slide: 1.3, crashCost: 10 },
    look: { suit: '#6b5a44', cloak: ['#a88452', '#d9b77e'], hood: '#b48d5a', leather: '#7a5432', scale: 0.98, shoulders: 0.94, limbs: 1.06, cloakLen: 0.72, eyes: 0.55 },
  },
  {
    id: 'zara',
    name: 'Zara',
    role: 'Sietch Warden',
    blurb: 'Keeper of the old stones. Where she walks, the rock remembers.',
    passive: 'A Holtzman shield recharges every 40 s. The old paving restores her water.',
    active: { id: 'volley', name: 'Warden\'s Thumper', text: 'Plant a thumper without spending one.', cooldown: 32 },
    weakness: 'Heavy armour: hook prompts are faster.',
    unlock: { dist: 8000, spice: 2500 },
    mods: { shieldEvery: 40, stoneWater: 4, hookWindow: 0.8 },
    look: { suit: '#4a4640', cloak: ['#c9bfae', '#ece4d4'], hood: '#d8cdb8', leather: '#5a4a3a', scale: 1.0, shoulders: 1.16, limbs: 1, cloakLen: 1.0, eyes: 0.55 },
  },
];

export const characterById = (id) => CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];

// unlocked by best distance, or bought with banked spice
export function isUnlocked(c, save) {
  if (!c.unlock) return true;
  if ((save.unlocked || []).includes(c.id)) return true;
  return (save.bestDist || 0) >= c.unlock.dist;
}
