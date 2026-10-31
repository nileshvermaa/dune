# Architecture

Arrakis: The Crossing is a static single-page game: Vite bundles plain ES modules and Three.js,
with no UI framework and no backend. Everything you see is built at runtime from code, apart
from a few CC0 photo textures and one skinned character file in `public/`.

This document explains how the pieces fit together and how to add to them. For workflow (scripts,
style, pull requests) see [CONTRIBUTING.md](../CONTRIBUTING.md); for ideas worth building next see
[ROADMAP.md](ROADMAP.md).

## Folder map

```
src/
  main.js            boot: create the Game, attach dev tools in development
  game/              the hub and its systems — behaviour
    Game.js          scene, actors, run state, save, state machine, frame loop
    systems/         behaviour grouped by concern, installed on Game.prototype
    constants.js     physics and timing shared by the systems
    shaders.js       post-processing shaders (heat shimmer, sun shafts, colour grade)
    dom.js           $() and touch detection
  content/           data and tuning — what the game is made of, no Three.js scenes
    difficulty.js    every difficulty curve (speed, spacing, wormsign, hooking, riding)
    powerups.js      pickups: weights, effects, HUD status rows
    abilities.js     carrier active abilities
    characters.js    the five carriers: traits, abilities, unlocks, rule modifiers, looks
    zones.js         biomes: length, fog, wind, which obstacles appear and how often
    story.js         prologue, waypoints, chapter cards, narration beats, epitaphs
  world/             things placed in the scene
    layout.js        lane and segment geometry everything lines up against
    track.js         the trail: segments, corners, obstacles, pickups, scenery
    obstacles.js     obstacle registry: how each kind is built and passed
    terrain.js       the dune field (streamed height-mapped chunks)
    sky.js           sky dome, sun/moon, day–night cycle, height fog
    props.js         procedural models: rocks, ruins, pickups, thumpers, ornithopters…
    effects.js       particles, drifting dust, the storm wall, the worm's sand mound
  actors/
    player.js        the runner: skinned rig, cloak cloth, procedural layers on the clips
    rig.js           loads the skinned body and animation clips (public/models/runner.glb)
    worm.js          the chasing worm, breaching worms and the devouring worm
  engine/            low-level helpers with no game knowledge
    noise.js         seeded RNG, simplex noise, easing and damping
    geom.js          geometry building and merging
    materials.js     material patches (detail textures, photo textures)
    textures.js      generated canvas/data textures
    input.js         keyboard, swipe and tap → actions
  audio/audio.js     procedural sound: music, wind, footsteps, the worm, room echo
  styles/            index.css imports the partials in cascade order
  dev/devtools.js    autopilot, fast-forward, photo studio (development only)
tests/               Vitest unit tests for content and difficulty
```

Dependencies point downward: `game` uses everything; `world` and `actors` use `engine` and
`content`; `content` is plain data (it may read `game/constants.js` for shared numbers); `engine`
depends on nothing but Three.js.

## Boot and the frame loop

`index.html` holds every screen and HUD element as plain markup; `main.js` creates the `Game`
on `#app`. The constructor builds the renderer, scene, terrain, sky, track, runner and worms,
wires the DOM (`setupUI`), loads the save, and starts `loop()` on `requestAnimationFrame`.

Each frame `Game.loop`:

1. measures `dt`, lets the performance governor adjust resolution, and caps `dt` at 50 ms;
2. while a quick-time prompt is up, runs it in real time and slows the world around it;
3. advances the current state: `updateRun`, `updateIntro` or `updateDeath`;
4. streams and animates the world: track segments, the runner's pose, terrain chunks, sky,
   atmosphere, the worms and their sand, particles, dust, the storm wall;
5. moves the camera, refreshes the HUD, mixes the audio, and renders through the post chain.

## The state machine

```
title ──start──▶ intro ──▶ running ⇄ paused
  ▲  ⇅                       │
  │ chars                  dying ──▶ over ──▶ title
```

`this.state` is one of `title`, `chars`, `intro`, `running`, `paused`, `dying`, `over`. The
first run of a session plays the story intro; later ones skip straight to `running`.

## Run state: `this.p`

Everything about the run in progress lives on `this.p`, rebuilt by `resetWorld()`. The fields
you will touch most:

| Field | Meaning |
| --- | --- |
| `seg`, `s` | the current trail segment and the distance along it (m) |
| `lane`, `laneX` | target lane (−1, 0, 1) and the actual sideways offset (m) |
| `y`, `vy`, `grounded`, `slideT` | jump and slide physics |
| `speed`, `runDist` | current speed (m/s) and distance run (m) |
| `water`, `sign`, `vision` | the three gauges: water %, wormsign %, prescience % |
| `spice`, `score`, `mult` | collected spice, score and multiplier |
| `thumpers`, `hooks`, `shield` | inventory |
| `trance`, `fly`, `silent`, `seal`, `rush`, `lure` | timed effects (seconds left) |
| `ride`, `rideOff`, `rides`, `balanceT` | worm riding |
| `qte` | the active quick-time prompt, or `null` |
| `abilityCd` | carrier ability cooldown (s) |

Rule changes from the chosen carrier are read through `this.mods` (see
[characters.js](../src/content/characters.js) for the list); always default them, as in
`this.mods.drain || 1`.

## Systems

`Game` keeps construction, the session lifecycle (`resetWorld`, `start`, `beginRun`, `pause`,
`resume`, `toTitle`, `die`, `gameOver`) and the frame loop. Everything else is a *system*: a plain
object of methods in `src/game/systems/`, copied onto `Game.prototype` at the bottom of
`Game.js`. Inside a system, `this` is the game, so systems call each other freely
(`this.toast()`, `this.startQTE()`).

| System | File | Responsible for |
| --- | --- | --- |
| Run | `run.js` | movement, corners, gravity, water, wormsign, collisions, pickups |
| Maker | `maker.js` | rhythm, thumpers, hooking prompts, riding, the worm in the sand |
| Controls | `controls.js` | actions → moves, the turn window, the carrier ability |
| Narrative | `narrative.js` | the intro, chapter cards, waypoints, narration, the journal |
| HUD | `hud.js` | DOM wiring, gauges, toasts, banners, the stride trace, tips |
| Carriers | `carriers.js` | the title card and the carrier picker |
| Presentation | `presentation.js` | the runner on the path, atmosphere, blown sand, the camera |
| Render | `render.js` | quality presets, the post-processing chain, performance governor |

To add a system: create `src/game/systems/<name>.js` exporting `export const NameSystem = {…}`,
import it in `Game.js` and add it to the `Object.assign(Game.prototype, …)` list. Method names
share one namespace across systems, so pick specific ones. Getters must stay in the class body
(`Object.assign` does not copy accessors).

## Content registries

Gameplay is data-driven where it pays off. Each registry documents its own shape at the top of
its file, and `tests/content.test.js` checks the links between them.

- **Difficulty** — [content/difficulty.js](../src/content/difficulty.js). Pure functions of
  distance (and rides). Change a curve here and every system follows. `tests/difficulty.test.js`
  pins the important properties: speed never stops rising, spacing never drops under 16 m, prompts
  stay humanly possible.
- **Powerups** — [content/powerups.js](../src/content/powerups.js). Spawn weight, `apply(game)`,
  and a HUD `STATUS` row for timed effects.
- **Obstacles** — [world/obstacles.js](../src/world/obstacles.js). `place(ctx)` builds meshes and
  colliders and returns the way past (free lanes, jump, slide); optional `animate()` for movers.
- **Abilities** — [content/abilities.js](../src/content/abilities.js). `use(game)`; return
  `false` to refuse without spending the cooldown.
- **Carriers** — [content/characters.js](../src/content/characters.js). Text, ability, unlock,
  `mods` and `look`.
- **Biomes** — [content/zones.js](../src/content/zones.js). Atmosphere and obstacle weights.
- **Story** — [content/story.js](../src/content/story.js). All player-facing prose.

## Recipes

### Add a powerup

1. Add an entry to `POWERUPS` with a `weight` and an `apply(game)`.
2. Add a model branch for its id in `makePowerup()` in `world/props.js` (the test fails until you do).
3. If it lasts a while, add a field to `this.p` in `resetWorld()`, count it down in `updateRun()`,
   act on it where it matters, and add a `STATUS` row so the HUD shows it.

### Add an obstacle

1. Add an entry to `OBSTACLES` in `world/obstacles.js` with `place({ track, seg, s, rng, diff })`.
   Build meshes into `seg.group` at `z = -s`, register colliders with `track.addCollider(seg, {…})`
   (`s0/s1` along the path, `x0/x1` across it, `y0/y1` height), and return
   `{ free, blocked, jump, slide }` so spice is laid sensibly around it.
2. Use only `rng` (never `Math.random`) so a seed always lays out the same trail.
3. If it moves, push `{ type: '<id>', … }` onto `seg.animated` and add `animate(a, time, dt)`.
4. Give it a weight in the zones it belongs to.
5. If contact should do something special, handle its `kind` in `collide()` (`systems/run.js`).
6. Teach the autopilot in `dev/devtools.js` if it needs a new kind of dodge, then fast-forward
   with `__sim()` to watch it in place.

### Add a carrier

1. Add an entry to `CHARACTERS` with a new `id`, text, `unlock: { dist, spice }` (each later
   than the last; the tests check), `mods`, and a `look` (colours and proportions).
2. Point `active.id` at an existing ability, or add one to `ABILITIES`.
3. A new kind of rule change is a new `mods` key: document it in the header of
   `characters.js`, read it where the rule lives (`this.mods.myKey || default`) and add it to the
   known list in `tests/content.test.js`.

### Add a biome

1. Add a zone to `ZONES` with its fog, tint, dust, wind and obstacle `weights`.
2. Add a label to `ZONE_LABELS` (`game/constants.js`), a `ROOM` echo amount, and chapter lines in
   `CHAPTERS` (`story.js`).
3. Zone-specific scenery is placed by `decorate()` and `dressSand()` in `world/track.js`.

### Add a waypoint or story beat

Waypoints are in `WAYPOINTS` (`story.js`), ordered by distance; past the last one `waypointAt()`
generates cairns forever. Narration lines are `BEATS`; show one with `this.beat('<key>')`
(once per run) or `this.narrate(text)`.

### Tune difficulty

Change the curve in `content/difficulty.js`, run `npm test` to keep its guarantees, then play or
fast-forward (`__sim(6000)`) to feel it.

## Conventions

- **Units:** metres and seconds. A segment's local frame runs along −z from its start, +x to the
  runner's right. Lanes are −1, 0, 1, `LANE_W` apart.
- **Determinism:** trail layout comes from a seeded `mulberry32` RNG per run. Visual-only
  randomness (particles, sway) may use `Math.random`.
- **No per-frame allocation in hot paths:** reuse `this.v.a…e` and module-level scratch vectors.
- **DOM writes are diffed:** go through `setText()` or the `ui.last` cache in the HUD.
- **Comments say why, not what.** Each module opens with a short paragraph on its role.

## Dev tools

In `npm run dev` the console exposes:

| Helper | Does |
| --- | --- |
| `__game` | the live `Game` |
| `__sim(dist)` | autopilot fast-forward to a distance, then freeze the frame |
| `__bot` | the autopilot; set `__bot.miss = 0.3` to fumble 30% of hook prompts |
| `__studio(mode, opts)` | close-up of the runner in a pose (`run`, `idle`, `jump`, …) |
| `__photos(on)` | toggle photo-scanned surface detail for before/after shots |

They are dynamically imported only in development and never ship in the production bundle.
