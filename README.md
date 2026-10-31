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

## Deployment (GitHub Actions → Vercel)

`.github/workflows/deploy.yml` builds every push and pull request. Pushes to `main` deploy to
production; pull requests get a preview URL posted as a comment. Vercel's own Git
auto-deploy is disabled in `vercel.json` so the workflow is the single deploy path.

One-time setup — add three repository secrets under **Settings → Secrets and variables → Actions**:

1. `VERCEL_TOKEN` — create one at https://vercel.com/account/tokens
2. `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` — run `npx vercel link` in this folder once, then
   copy `orgId` and `projectId` from the generated `.vercel/project.json`.

Until the secrets exist the workflow still builds, and skips the deploy step with a warning.

Fan-made tribute. Not affiliated with any Dune rights holder. All story text is original.
