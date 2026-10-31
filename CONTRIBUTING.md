# Contributing

Thanks for crossing the desert with us. This guide covers the day-to-day workflow; for how the
code fits together, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first.

## Setup

Node 20.19 or newer.

```bash
npm install
npm run dev        # http://localhost:5173 with hot reload and dev tools
```

## Scripts

| Script | Does |
| --- | --- |
| `npm run dev` | dev server with the `__game`, `__sim`, `__bot`, `__studio` console helpers |
| `npm run build` | production bundle in `dist/` |
| `npm run preview` | serve the production bundle |
| `npm run lint` | ESLint over the repo (`npm run lint:fix` to auto-fix) |
| `npm test` | Vitest unit tests (`npm run test:watch` while working) |
| `npm run check` | lint, test and build: what CI runs |

## Workflow

1. Branch from `main`.
2. Make the change. Content and tuning go in `src/content/`, new behaviour in the system it
   belongs to (`src/game/systems/`), new things in the scene under `src/world/` or `src/actors/`.
3. Run `npm run check`.
4. Play it. Unit tests cover data and curves, not feel: run a few kilometres yourself, or
   fast-forward with `__sim(3000)` and look around. Check a phone-sized viewport if you touched
   the HUD or screens.
5. Open a pull request. CI lints, tests and builds it; Vercel posts a preview URL to try it on.

## Style

- ES modules, 2-space indent, single quotes, semicolons (`.editorconfig` and ESLint enforce
  the basics).
- Open each module with a short comment on its role. Comment the *why* — the reason for a
  number or a trick — not the obvious *what*.
- Name things for the game world (`wormsign`, `thumper`, `carrier`) rather than generically.
- No allocations in per-frame code; reuse scratch vectors.
- Keep tuning numbers in `content/difficulty.js` or next to the data they belong to, not buried
  in systems.
- Player-facing text lives in `content/story.js` (or the content file it describes) so it can be
  edited in one place.

## Assets

Everything is procedural except what is credited in `public/textures/CREDITS.md` and
`public/models/CREDITS.md`. New assets must be CC0 or similarly permissive: add them to the
matching `CREDITS.md` and to `public/THIRD_PARTY_LICENSES.txt`. Keep files small (WebP for
textures, Meshopt-compressed GLB for models) — the whole game should load fast on a phone.
`scripts/build-carriers.mjs` shows the pipeline used for the character bodies.

## Commit messages

Short imperative subject naming what changed for the player or the codebase
("Dust devils sweep faster deeper in", "Move obstacle placement into a registry"), with a body
when the why isn't obvious.

## Fan project

This is a non-commercial tribute. Don't add names, logos, music or artwork owned by any *Dune*
rights holder; all story text is original.
