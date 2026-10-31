# Arrakis: The Crossing

An endless desert journey in the browser, inspired by the world of *Dune*.

The wells of Sietch Qanat are failing. Ishra, youngest of the water-carriers, must carry
the seed-water for a new cache across the deep desert before the storm season seals it.
The journey unfolds in chapters as the old stone road winds through five biomes, under a full
day/night cycle.

Everything — terrain, models, textures, music and sound — is generated procedurally at
runtime with Three.js, so the build ships as one small static bundle with no assets.

## How to survive

- **Stone is safe.** The Maker cannot follow onto rock. On the old causeway, dodge, jump and
  slide past ruins, spice pipes and spice blows.
- **Walk without rhythm.** Where dunes have buried the road, every steady step on open sand
  raises *wormsign*. Break your stride — jump, slide, weave — but unevenly: a regular pattern
  is still a rhythm, and the Maker hears it. At full wormsign, the worm takes you.
- **Guard your water.** Your stillsuit loses water every moment (more under the sun). Crashing
  into the stones costs water rather than ending the run outright. Drink dew along the way and
  the water caches at every bend in the road.
- **Thumpers** draw the worm away for a few seconds.
- **Maker hooks** turn a worm strike into a ride: Ishra mounts the worm and rides the desert.
- **Spice** fills your prescience; when it peaks, time slows and spice flows to you.
- **Holtzman shields** absorb one impact — but on open sand they drive the worm to frenzy.

| Action | Keyboard | Touch |
| --- | --- | --- |
| Weave between lanes | ← → or A D | Swipe left / right |
| Jump | ↑, W or Space | Swipe up or tap |
| Slide (fast-drop in mid-air) | ↓ or S | Swipe down |
| Plant a thumper | E, Q or Shift | Thumper button |
| Pause | Esc or P | Pause button |

## Develop

```bash
npm install
npm run dev
```

## Deployment

Deployment runs through Vercel's GitHub integration — no secrets or environment variables needed.
Import this repository once at https://vercel.com/new (it detects Vite automatically); after that
every push to `main` deploys to production and every pull request gets a preview URL.

`.github/workflows/ci.yml` builds every push and pull request on Node 20 and 22.

Fan-made tribute. Not affiliated with any Dune rights holder. All story text is original.
