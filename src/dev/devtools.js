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
    const look = p.speed * 0.5 + 4;
    // open sand: break rhythm at irregular intervals, lure the worm when it gets close
    if (p.onSand) {
      bot.next = bot.next ?? 0;
      if (g.time > bot.next) {
        const r = Math.random();
        const danger = seg.gaps.some(([a]) => a - p.s > 0 && a - p.s < look) ||
          seg.obstacles.some((o) => o.active && !o.fatal && o.s0 - p.s > 0 && o.s0 - p.s < look);
        if (r < 0.45 && p.grounded && !danger) g.onAction('jump');
        else g.onAction(p.lane <= 0 ? 'right' : 'left');
        bot.next = g.time + 0.3 + Math.random() * 0.6;
      }
      if (p.sign > 80 && p.thumpers > 0) g.onAction('thumper');
    }
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
    for (const [a] of seg.gaps) { const d = a - p.s; if (d > -0.5 && d < p.speed * 0.22 + 1.2) needJump = true; }
    if (blocked.has(p.lane)) {
      const free = [-1, 0, 1].filter((l) => !blocked.has(l)).sort((x, y) => Math.abs(x - p.lane) - Math.abs(y - p.lane));
      if (free.length) g.onAction(free[0] < p.lane ? 'left' : 'right');
    }
    if (needJump) g.onAction('jump');
    if (needSlide && (p.slideT < 0.25 || !p.grounded)) g.onAction('slide');
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

  // Play the real frame loop on a fake clock (works while the page is hidden). Drawing is skipped
  // unless draw is true; the autopilot steers when auto is true; each(i) runs after every frame.
  let clock = 0;
  const play = (secs, { auto = true, draw = false, each } = {}) => {
    const raf = window.requestAnimationFrame, render = g.renderer.render, comp = g.composer && g.composer.render;
    window.requestAnimationFrame = () => 0;
    if (!draw) {
      g.renderer.render = () => {};
      if (g.composer) g.composer.render = () => {};
    }
    clock = Math.max(clock, performance.now());
    try {
      for (let i = 0; i < Math.max(1, Math.round(secs * 60)); i++) {
        clock += 1000 / 60;
        g.last = clock - 1000 / 60;
        if (auto && g.state === 'running') bot();
        g.loop(clock);
        if (each) each(i);
        if (g.state === 'over') break;
      }
    } finally {
      window.requestAnimationFrame = raf;
      g.renderer.render = render;
      if (g.composer) g.composer.render = comp;
    }
    return { state: g.state, dist: Math.round(g.p.runDist), cause: g.deathCause };
  };
  // draw exactly one frame, for a screenshot
  const frame = () => play(0, { auto: false, draw: true });

  // HUD pieces whose boxes cover the runner on screen right now (the runner must stay in clear view)
  const covered = () => {
    const cam = g.camera, W = innerWidth, H = innerHeight, p = g.runner.root.position;
    cam.updateMatrixWorld();
    const v = p.clone();
    const right = p.clone().set(1, 0, 0).applyQuaternion(cam.quaternion).multiplyScalar(0.5);
    const pts = [[0, 0, 0], [0, 1.9, 0], [right.x, 1, right.z], [-right.x, 1, -right.z]].map(([x, y, z]) => {
      v.set(p.x + x, p.y + y, p.z + z).project(cam);
      return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H];
    });
    const box = {
      x0: Math.min(...pts.map((q) => q[0])), x1: Math.max(...pts.map((q) => q[0])),
      y0: Math.min(...pts.map((q) => q[1])), y1: Math.max(...pts.map((q) => q[1])),
    };
    const shown = (e) => {
      for (let a = e; a && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05) return false;
      }
      return true;
    };
    const hits = [];
    const pieces = '#hud .hud-left > *, #hud .hud-right > *, #narration, #tip, #toasts > *, #zone-banner, #turn-hint, #qte, #ability-btn, #thumper-btn, #worm-meter, #pause-btn';
    for (const e of document.querySelectorAll(pieces)) {
      const b = e.getBoundingClientRect();
      if (b.width < 2 || b.height < 2 || !shown(e)) continue;
      if (b.right > box.x0 && b.left < box.x1 && b.bottom > box.y0 && b.top < box.y1) hits.push(`${e.id || e.className}: ${e.textContent.trim().slice(0, 30)}`);
    }
    return { box: Object.values(box).map(Math.round), hits };
  };

  Object.assign(window, { __game: g, __bot: bot, __sim: sim, __play: play, __frame: frame, __covered: covered, __studio: studio, __photos: photos });
}
