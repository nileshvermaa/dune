# Model credits

`runner.glb` is derived from the **Universal Animation Library (Standard)** by
[Quaternius](https://quaternius.com/packs/universalanimationlibrary.html), released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain). Downloaded from
the author's [OpenGameArt page](https://opengameart.org/content/universal-animation-library).

Changes for the game:
- kept 10 of the 45 clips: Idle_Loop, Sprint_Loop, Jog_Fwd_Loop, Jump_Start, Jump_Loop,
  Jump_Land, Roll, Crouch_Idle_Loop, Hit_Chest, Death01
- removed finger, scale and non-root translation tracks, resampled, quantized and
  meshopt-compressed (6.7 MB to 277 KB)

In game the mannequin is recoloured as a stillsuit and dressed with the procedural hood,
mantle, harness and belt; see `attachRig()` in `src/player.js`.
