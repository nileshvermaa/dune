// Dev-only helpers (never bundled in production): an autopilot and a fast-forward used for
// playtesting layouts and capturing screenshots of each biome.

export function attachDevtools(g) {
  const bot = () => {
    const p = g.p, seg = p.seg;
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
      if (!o.active && o.kind !== 'geyser') continue;
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
    g.state = 'paused';
    document.getElementById('pause').classList.add('hidden');
    document.getElementById('toasts').innerHTML = '';
    return { dist: Math.round(g.p.runDist), zone: g.p.seg.zone.id, state: st };
  };

  Object.assign(window, { __game: g, __bot: bot, __sim: sim });
}
