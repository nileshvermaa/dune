# Arrakis: The Crossing

An endless desert journey in the browser, inspired by the world of *Dune*.

The wells of Sietch Qanat are failing. Ishra, youngest of the water-carriers, must carry
the seed-water for a new cache across the deep desert before the storm season seals it.
The journey unfolds in chapters across open desert through five biomes, under a full
day/night cycle. The run never stops getting faster.

Terrain, models and music are generated procedurally at runtime with Three.js; a few CC0
photo textures and a CC0 animation set are credited in `public/textures` and `public/models`.

## How to survive

- **Walk without rhythm.** The whole desert is open sand: every steady step raises *wormsign*.
  Break your stride — jump, slide, weave — but unevenly: a regular pattern is still a rhythm,
  and the Maker hears it. At full wormsign, the worm takes you.
- **Stone is safe.** Only scattered stretches of the old paving survive. The Maker cannot follow
  onto them, and wormsign drains while you cross.
- **Turn at the bends.** Swipe or press toward the bend before every corner. Miss it and you run
  into the rock face.
- **Dodge.** Rock spires, tumbled walls (jump, or run through the breach), standing slabs that
  block two lanes, arches to slide under, sinkholes to leap, and dust devils sweeping across.
- **Guard your water.** Your stillsuit loses water every moment (more under the sun); crashes
  cost water. Drink dew along the way and the caches at every bend.
- **Maker hooks** let you ride the worm — if you can set them. When it strikes, time slows:
  hit the prompted directions inside the closing ring. While riding, hold on through the balance
  checks. Both get harder the further you go.
- **Powerups:** thumpers lure the worm away; Holtzman shields absorb a hit (but enrage the worm on
  sand); Silent Step stops wormsign; Stillsuit Seal stops water loss; Spice Rush smashes through
  obstacles; ornithopters lift you clear; spice fills prescience.

## The carriers

Five carriers can take the water across, each with a trait, an active ability (on a cooldown)
and a weakness. All but Ishra are locked: reach their distance in a single run, or unlock them
early with spice banked across runs. Choose from **Carrier** on the title screen.

| Carrier | Unlock | Trait | Ability | Weakness |
| --- | --- | --- | --- | --- |
| Ishra, Water-carrier | — | Water drains 25% slower | Still the Breath: wormsign halves | — |
| Kaleb, Sandrider | 1,500 m / 500 spice | Starts with hooks; easier hooking; longer rides | Call the Maker: hook a worm at once | Drinks 15% faster |
| Nadira, Spice Diviner | 3,000 m / 1,000 spice | Spice flows to her; prescience fills 2× | Foresight: 4 s spice-trance | Wormsign builds 15% faster |
| Tarik, Dune-dancer | 5,000 m / 1,600 spice | Double jump; stride breaks quiet the sand more | Dune Leap: clear anything ahead | Crashes cost more water |
| Zara, Sietch Warden | 8,000 m / 2,500 spice | Recharging shield; old paving restores water | Warden's Thumper: a free thumper | Faster hook prompts |

| Action | Keyboard | Touch |
| --- | --- | --- |
| Weave between lanes / turn at a bend | ← → or A D | Swipe left / right |
| Jump | ↑, W or Space | Swipe up or tap |
| Slide (fast-drop in mid-air) | ↓ or S | Swipe down |
| Plant a thumper | E, Q or Shift | Thumper button |
| Carrier ability | F or R | Ability button |
| Pause | Esc or P | Pause button |

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run check    # lint + unit tests + production build
```

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the code fits together, and step-by-step recipes
  for adding powerups, obstacles, carriers, biomes and story.
- [CONTRIBUTING.md](CONTRIBUTING.md): scripts, workflow and style.
- [docs/ROADMAP.md](docs/ROADMAP.md): ideas worth building next.

```
src/
  game/       the Game hub, its systems (run, maker, hud, ...) and shared constants
  content/    data and tuning: difficulty curves, powerups, abilities, carriers, biomes, story
  world/      trail, obstacles, terrain, sky, procedural props, effects
  actors/     the runner and the worms
  engine/     noise, geometry, materials, textures, input
  audio/      procedural sound
  styles/     CSS partials
tests/       Vitest unit tests
```

## Deployment

Deployment runs through Vercel's GitHub integration — no secrets or environment variables needed.
Import this repository once at https://vercel.com/new (it detects Vite automatically); after that
every push to `main` deploys to production and every pull request gets a preview URL.

`.github/workflows/ci.yml` lints, tests and builds every push and pull request (build on Node 20 and 22).

Fan-made tribute. Not affiliated with any Dune rights holder. All story text is original.
