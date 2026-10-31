// Dev-only helpers (never bundled in production): an autopilot and a fast-forward used for
// playtesting layouts and capturing screenshots of each biome.

import { photoUniforms } from '../engine/materials.js';

export function attachDevtools(g) {
  const bot = () => {
    const p = g.p, seg = p.seg;
    // quick-time prompts: answered after a human-ish delay, wrong bot.miss of the time
    if (p.qte) {
      const q = p.qte;
      if (q.t > 0.25) {
        const want = q.steps[q.idx];
        const wrong = Math.random() < (bot.miss ?? 0) ? ['left', 'right', 'up', 'down'].find((d) => d !== want) : want;
        g.onAction(wrong === 'up' ? 'jump' : wrong === 'down' ? 'slide' : wrong);
      }
      return;
    }
    // corners: commit to the turn a little before the bend
    if (seg.next && !p.pendingTurn && p.fly <= 0 && p.ride <= 0 && seg.length - p.s < Math.max(6, p.speed * 0.45)) {
      g.onAction(seg.turn < 0 ? 'left' : 'right');
    }
    // open sand: break rhythm at irregular intervals, lure the worm when it gets close
    if (p.onSand) {
      bot.next = bot.next ?? 0;
      if (g.time > bot.next) {
        const r = Math.random();
        if (r < 0.45 && p.grounded) g.onAction('jump');
        else g.onAction(p.lane <= 0 ? 'right' : 'left');
        bot.next = g.time + 0.3 + Math.random() * 0.6;
      }
      if (p.sign > 80 && p.thumpers > 0) g.onAction('thumper');
    }
    const look = p.speed * 0.5 + 4;
    let needJump = false, needSlide = false;
    const blocked = new Set();
    for (const o of seg.obstacles) {
      if ((!o.active && o.kind !== 'geyser') || o.fatal) continue;
      const d = o.s0 - p.s;
      if (d < -1.5 || d > look) continue;
      if (o.kind === 'geyser' || (o.y1 > 5 && o.y0 < 1)) {
        for (const l of [-1, 0, 1]) if (l * 2.2 + 0.4 > o.x0 && l * 2.2 - 0.4 < o.x1) blocked.add(l);
      } else if (o.y0 > 1) {
        if (d < p.speed * 0.2 + 0.5) needSlide = true;
      } else if (d < p.speed * 0.16 + 0.6) needJump = true;
    }
    for (const [a] of seg.gaps) { const d = a - p.s; if (d > -0.5 && d < p.speed * 0.1 + 0.8) needJump = true; }
    if (blocked.has(p.lane)) {
      const free = [-1, 0, 1].filter((l) => !blocked.has(l)).sort((x, y) => Math.abs(x - p.lane) - Math.abs(y - p.lane));
      if (free.length) g.onAction(free[0] < p.lane ? 'left' : 'right');
    }
    if (needJump && p.grounded) g.onAction('jump');
    if (needSlide && p.grounded && p.slideT <= 0) g.onAction('slide');
  };

  // Simulate (with autopilot) up to a distance, then freeze the frame for inspection.
  const sim = (toDist) => {
    if (g.state !== 'running' && g.state !== 'paused') g.start();
    g.state = 'running';
    const dt = 1 / 60;
    let n = 0;
    while (g.state === 'running' && g.p.runDist < toDist && n < 60 * 400) {
      bot();
      if (g.p.qte) g.updateQTE(dt);
      g.time += dt;
      g.updateRun(dt);
      if (g.state !== 'running') break;
      g.track.ensure(g.p.seg.startDist + g.p.s);
      g.track.update(dt, g.time);
      g.updatePlayerVisual(dt);
      g.updateAtmosphere(dt);
      n++;
    }
    const st = g.state;
    g.terrain.buildAll(g.playerPos.x, g.playerPos.z);
    for (let i = 0; i < 200; i++) g.updateAtmosphere(0.05);
    g.p.wormGap = 45;
    for (let i = 0; i < 60; i++) g.updateCamera(0.05);
    g.sky.update(0.016, g.camera.position, g.atmo, g.time);
    g.state = 'paused';
    document.getElementById('pause').classList.add('hidden');
    document.getElementById('toasts').innerHTML = '';
    return { dist: Math.round(g.p.runDist), zone: g.p.seg.zone.id, state: st };
  };

  // Close-up of the runner in a given pose, for inspecting the model and animation.
  // phase: run-cycle phase in radians; yaw: camera orbit angle (0 = behind, PI = front); air: simulated airspeed for the cloth.
  const studio = (mode = 'run', { phase = 0, yaw = 2.4, dist = 3.2, height = 1.1, speed = 20, vy = 2, look = 0.85, air = mode === 'idle' ? 0 : speed } = {}) => {
    if (g.state === 'title' || g.state === 'over') g.start();
    g.state = 'paused';
    g.app.classList.remove('cinema', 'chaptering');
    for (const id of ['pause', 'hud', 'narration', 'zone-banner', 'tip']) document.getElementById(id).classList.add('hidden');
    const r = g.runner;
    for (let i = 0; i < 40; i++) {
      r.phase = phase - (40 - i) * 0.0001;
      r.update(1 / 30, { speed, mode, vy, air });
    }
    const c = r.root.position, yw = r.root.rotation.y + yaw;
    g.camera.position.set(c.x + Math.sin(yw) * dist, c.y + height, c.z + Math.cos(yw) * dist);
    g.camera.lookAt(c.x, c.y + look, c.z);
    g.camera.fov = 35;
    g.camera.updateProjectionMatrix();
    return mode;
  };

  // toggle the photo-scanned surface detail for before/after comparisons
  const photos = (on) => {
    for (const u of Object.values(photoUniforms)) {
      u.held = !on; // stop the loader's fade-in from switching them straight back on
      u.on.value = on ? 1 : 0;
    }
    return on;
  };

  Object.assign(window, { __game: g, __bot: bot, __sim: sim, __studio: studio, __photos: photos });
}
