# Model credits

All models are by [Quaternius](https://quaternius.com), released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain).

## Motion: `runner.glb`

Derived from the **Universal Animation Library (Standard)**, downloaded from the author's
[OpenGameArt page](https://opengameart.org/content/universal-animation-library).

- kept 10 of the 45 clips: Idle_Loop, Sprint_Loop, Jog_Fwd_Loop, Jump_Start, Jump_Loop,
  Jump_Land, Roll, Crouch_Idle_Loop, Hit_Chest, Death01
- removed finger, scale and non-root translation tracks, resampled, quantized and
  meshopt-compressed (6.7 MB to 277 KB)

Only the clips are used in game; they are retargeted onto the bodies below when those load
(`src/actors/retarget.js`).

## Bodies: `carrier-f.glb`, `carrier-m.glb`

The Superhero female and male bases from **Universal Base Characters (Standard)**, downloaded
from [quaternius.itch.io/universal-base-characters](https://quaternius.itch.io/universal-base-characters).

- light skin base colour used in place of the dark one (the game tints it per carrier)
- unused vertex attributes and the roughness and small normal maps removed, textures resized to
  1024 px WebP, meshes quantized and meshopt-compressed (34 MB of source files to about 290 KB each)
- built with `scripts/build-carriers.mjs`

In game the body is split into stillsuit, bare face, gloves and boots, and dressed with the
procedural hood, mantle, harness and belt; see `attachRig()` and `dressBody()` in
`src/actors/player.js`.
