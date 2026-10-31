# Arrakis Run

A Dune-inspired 3D endless runner for the browser. Outrun the sandworm along an ancient
causeway, harvest spice, and survive five biomes with a full day/night cycle.

Built with Three.js + Vite. Everything — terrain, textures, models, music and sound — is
generated procedurally at runtime, so the build ships as a single static bundle with no assets.

## Play

| Action | Keyboard | Touch |
| --- | --- | --- |
| Change lane / turn at corners | ← → or A D | Swipe left / right |
| Jump | ↑, W or Space | Swipe up or tap |
| Slide (fast-drop in mid-air) | ↓ or S | Swipe down |
| Pause | Esc or P | Pause button |

- **Corners**: the causeway turns 90°. Glowing floor arrows and an obelisk mark each corner — turn or fall.
- **Wormsign**: clipping an obstacle side-on makes you stumble and the worm closes in. Stumble again while it's close and you're taken.
- **Power-ups**: Holtzman shield (absorbs one hit), spice trance (slow time, spice magnet, 2× score), ornithopter (fly over everything).
- **Biomes**: Deep Desert → Shield Wall canyon → Sietch ruins → Spice fields (harvesters, spice blows) → Coriolis storm.

## Develop

```bash
npm install
npm run dev
```

## Deploy to Vercel

It's a static Vite site, so no server or environment variables are needed. `vercel.json` sets the
framework, output directory and long-lived caching for hashed assets.

- **Git**: push the repo and import it at vercel.com/new (it detects Vite automatically), or
- **CLI**: `npm i -g vercel`, then `vercel` (preview) and `vercel --prod`.

Fan-made tribute. Not affiliated with any Dune rights holder.
