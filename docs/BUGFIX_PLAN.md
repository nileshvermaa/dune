# Bug-fix plan: getting the game to a playable state

A hand-off for finishing the playability pass. Read [ARCHITECTURE.md](ARCHITECTURE.md) first.
Work top to bottom. After each task, run `npm run check`, which must pass, then commit.

## Already done (commit 7f6f609): don't redo

- **HUD slots:** words go in a top slot (`src/styles/play.css`); the stride panel is hidden; no
  letterbox mid-run; tips are shown at most 3 times each.
- **Phone layout:** compact HUD, ability and thumper buttons in one bottom row, wider portrait
  camera (`updateCamera` in `game/systems/presentation.js`).
- **Trail stakes:** posts along both trail edges (`buildTrail` in `world/track.js`,
  `stakeGeometry` in `world/props.js`).
- **Off-trail death:** swiping past the edge lane with no turn there is fatal (`die('edge')`).
  Near a bend the same swipe counts as an early turn, and double swipes are ignored
  (`onAction` in `game/systems/controls.js`).
- **Light:** runs start in the morning (`beginRun` sets `sky.cycle`); nights are brighter and
  shorter (`world/sky.js`).
- **Penalties:** dust devils and stumbles cost less.

## How to test (no GPU needed)

Run `npm run dev`. In the browser console, the dev tools give you:

- **`__play(secs)`:** runs the real game loop on a fake clock with the autopilot and no drawing.
  It returns `{state, dist, cause}`.
- **`__frame()`:** draws one frame, for a screenshot.
- **`__covered()`:** lists HUD elements overlapping the runner on screen. It must return
  `hits: []`.
- **`__sim(dist)`:** fast-forwards with the autopilot.

To start a run: `__game.start(); __play(1.2); __game.endIntro();`.

Test at 375×812 (phone held upright), 812×375 (phone on its side) and 1280×720. The game
auto-pauses when the tab loses focus; call `__game.resume()`.

## Tasks

### 1. Sinkholes are the top killer: make them readable (high)

In autopilot runs, every death was a fall into a sinkhole, with water near 100%. The pit is a
flat dark disc (`makeSinkholeGeometry` and `mats.sinkhole` in `world/props.js`; placed in
`buildTrail`).

- Add a visible warning 15–25 m ahead: a raised, darker rim ring, swirling sand particles
  (`dustPool.emit` near the pit), or both.
- Make sure the pit can be seen from the camera height at 30 m/s, by day and at night.
- Check that the autopilot in `dev/devtools.js` jumps early enough. Log the jump distance
  versus the gap position. Fix the jump trigger if it fires too late at high speed:
  `d < speed*0.1+0.8`.
- **Done when:** 10 runs of `__sim(4000)` with `__bot.miss = 0` average more than 3 km, and
  fewer than half of the deaths are `fall`.

### 2. Autopilot crashes into arches and walls often (medium)

Logs show frequent `crash:arch` and `crash:low`. Find out whether the slide or jump input is
being ignored. Candidates:

- The runner is not grounded.
- `slideT` is already above zero.
- The jump is queued while sliding.

Check `onAction` slide and jump handling and the `slideQueued` logic in `updateRun`. If a human
pressing at the same moment would also fail, it's a real bug: fix the input handling, not just
the bot.

### 3. Title screen on phones (medium)

On a 375×812 screen, the title's four rules (`.laws`), the story text and the carrier picker
overlap. Fix in `src/styles/responsive.css`, under `@media (max-width: 700px)`. Either use a
single column placed above the play button, or hide `.story-tease` on phones. Check at
375×667 too.

### 4. Intro camera crops the runner on phones (medium)

In the opening shots the runner sits at the left edge, partly off screen, on a phone held
upright. In `updateIntro` (`game/systems/narrative.js`), use `camera.aspect` to centre the
runner and widen the field of view when the screen is taller than it is wide.

### 5. Hood and mantle on the new bodies (low to medium)

The hood sits like a helmet and the mantle like a big collar, especially seen from the side.

- Tune in `attachRig` (`actors/player.js`): `this.head.scale`, `this.hood.rotation.x`, and the
  `headP` offset.
- Check with `__studio('idle', {yaw: Math.PI - 0.6, dist: 0.85, height: 1.6, look: 1.55})`.
- Optional: the bare superhero anatomy shows through the stillsuit. Consider a robe or tabard
  over the torso, or a darker, ribbed suit material.

### 6. Chapter card versus narration timing (low)

Narration now waits 3.5 s after a chapter card (`chapter()` in `narrative.js`). Check that no
other `narrate` call fires during a banner. If one does, queue it: add a small narration queue
in `narrate()` instead of letting a line overwrite the one on screen.

### 7. Toasts on phones (low)

Toasts sit at the top centre below the narration slot. Make sure at most two are visible at
once (trim `#toasts` children in `toast()`). Check with `__covered()` during a pickup streak.

### 8. Performance safety net (low)

In a browser without a GPU the game runs at about 10 fps, with roughly 410 draw calls and
430k triangles even on "low" quality.

- On "low", cut stakes to every 18 m and reduce `dressSand` and `decorate` scenery density.
- Merge static per-segment props where possible.
- Let `governPerformance` (`game/systems/render.js`) also act on "low": drop the pixel ratio
  to 0.75 when average frame time exceeds 40 ms.

### 9. Regression checks to run at the end

- Missed corner, wrong-way press and early press all die with `crash`; a swipe off the edge
  lane with no bend nearby dies with `edge`; double-swiping a turn does not kill.
- `__covered().hits` is empty at all three screen sizes during 30 s of `__play`.
- Holding one lane on open sand calls the worm in about 200–250 m. Weaving every 2–3 s keeps
  wormsign under 25%.
- `npm run check` is green. Then commit, ending the message with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
