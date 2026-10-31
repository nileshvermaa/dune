# Roadmap

Ideas that would make the crossing deeper, fairer or more fun, roughly in order of value for
effort. Each names where it would live, so anyone can pick one up. See
[ARCHITECTURE.md](ARCHITECTURE.md) for the recipes these build on.

## Now: small changes, big payoff

- **Daily crossing.** One seed per calendar day, the same trail for everyone, with its own best
  score. The trail is already seeded (`resetWorld(seed)`): derive the seed from the date, add a
  title-screen entry, and keep `save.daily[date]`.
- **Settings screen.** Music and effects volume; quality preset; reduced motion (no shake,
  softer flashes); larger subtitles; key remapping. Most of the groundwork exists:
  - the audio engine already has `master`, `music` and `sfx` gain buses;
  - quality switches through `this.quality` and `applyQuality()`;
  - `Input` maps keys to actions in one table.
- **Haptics on phones.** A short `navigator.vibrate()` on crashes, hook prompts and thumper
  plants (`hud.js` / `maker.js`), behind the settings toggle.
- **Contracts.** Three rotating goals per run ("ride the Maker twice", "cross a biome without a
  shield", "500 spice in one run") that pay banked spice: a `content/contracts.js` registry of
  `{ text, test(p, events), reward }`, checked from `updateRun()` and shown on the pause and
  game-over screens. This gives the carrier unlocks a steady path.

## Next: new things to meet in the desert

- **Obstacles** (`world/obstacles.js`):
  - *Harkonnen patrol*: an ornithopter's searchlight sweeps the lanes; being lit raises wormsign
    sharply.
  - *Quicksand*: a lane that slows you and drags you sideways.
  - *Dune slip*: a sliding sand face that pushes the trail sideways for a stretch.
  - *Harvester crawler*: crosses the trail slowly; pass behind it or slide under its boom.
- **Powerups** (`content/powerups.js`):
  - *Paracompass*: shows the next bend early.
  - *Crysknife*: one free crash.
  - *Fremkit*: refills water and sheds wormsign.
  - *Distrans bat*: marks the obstacles ahead through the storm.
- **Carrier upgrades.** Spend banked spice on small permanent perks per carrier (bigger
  stillsuit reserve, a third thumper slot, longer rides). Add `save.upgrades[charId]` and fold
  the perks into `this.mods`, so the systems need no changes.
- **A second worm.** Past 10 km, a second wormsign gauge from another direction, so a thumper
  only diverts one. This builds on `ChaserWorm` in `actors/worm.js`.
- **Steer the ride.** While riding, weave to herd the worm through spice fields for a combo,
  instead of only holding on (`maker.js`).
- **Achievements.** A `content/achievements.js` registry checked at game over, shown in the
  journal.

## Later: bigger pieces

- **Global leaderboard.** A Vercel Function plus a Marketplace database (for example Redis),
  storing best distance per carrier and per daily seed. To limit cheating, the server can replay
  the seed and sanity-check reported distance against the run length.
- **Ghost of your best run.** Record lane, jump and slide inputs with timestamps on the daily
  seed and replay them as a translucent runner.
- **Forks in the trail.** At some corners both ways are open, with different risk and reward
  (an old-paving detour, or open sand with more spice). Needs `Track.addSegment()` to branch and
  the turn logic to accept either side.
- **The Old Man of the Desert.** A set-piece chase at milestone distances: a colossal worm,
  scripted breaches and a guaranteed ride if you hook it.
- **Installable and offline.** A web manifest and service worker (for example
  `vite-plugin-pwa`) so the game installs to a phone's home screen and runs without a network.
- **Translations.** Player-facing text is already gathered in `content/story.js` and
  `content/characters.js`; move it to per-language tables.

## Engineering

- **End-to-end smoke test.** Playwright in CI: load the page, start a run, `__sim(1500)`, and
  fail on console errors or a stalled frame loop.
- **Type checking without TypeScript.** Add `// @ts-check` and JSDoc types to the content
  registries and `this.p`, and run `tsc --noEmit` in CI.
- **Bundle budget.** Fail CI if the main chunk grows past a set size.
- **Split the largest modules.** Divide `world/props.js` by family (rocks, ruins, pickups,
  craft) and pull cloak cloth out of `actors/player.js`.
- **Segment pooling.** Reuse segment groups and colliders instead of disposing and rebuilding
  them, to cut garbage collection on long runs.
- **Play analytics.** Vercel Web Analytics custom events for run length, death cause and
  carrier, to tune `content/difficulty.js` against real play.
- **More bodies and hair.** The free Universal Base Characters pack has two bodies; the paid
  Source pack adds Regular and Teen builds, and 20 hairstyles rig to the same Head bone. Any body on
  the same skeleton drops into `BODIES` in `actors/rig.js` (build it with `scripts/build-carriers.mjs`).
