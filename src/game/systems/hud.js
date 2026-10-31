import { clamp } from '../../engine/noise.js';
import { straightLimit } from '../../content/difficulty.js';
import { roman, saying } from '../../content/story.js';
import { STATUS } from '../../content/powerups.js';
import { TRANCE_TIME, ZONE_LABELS } from '../constants.js';
import { $, isTouch } from '../dom.js';

// Heads-up display and screen chrome: DOM wiring, toasts, banners, gauges and tips.
// Installed on Game.prototype (see game/Game.js), so `this` is the Game.
export const HudSystem = {
  setupUI() {
    const ui = (this.ui = {
      hud: $('hud'), score: $('score'), mult: $('mult'), spice: $('spice'), dist: $('dist'),
      wormMeter: $('worm-meter'), wormFill: $('worm-fill'), powerups: $('powerups'),
      turnHint: $('turn-hint'), tip: $('tip'), zoneBanner: $('zone-banner'), zoneText: $('zone-text'),
      toasts: $('toasts'), title: $('title'), pause: $('pause'), over: $('over'), tint: $('tint'), flash: $('flash'),
      narration: $('narration'), waterBar: $('water-bar'), visionFill: $('vision-fill'),
      thumpers: $('inv-thumper-count'), invThumper: $('inv-thumper'), invHooks: $('inv-hooks'), thumperBtn: $('thumper-btn'), abilityBtn: $('ability-btn'), abilityFill: $('ability-fill'), abilityName: $('ability-name'),
      qte: $('qte'), qteRing: $('qte-ring'), qteKey: $('qte-key'), qteLabel: $('qte-label'), qteDots: $('qte-dots'),
      intro: $('intro'), introCard: $('intro-card'), introKicker: $('intro-kicker'), introLine: $('intro-line'), introDots: $('intro-dots'),
      goal: $('hud-goal'), chars: $('chars'),
      thumperBtnCount: $('thumper-btn-count'), hudChapter: $('hud-chapter'), waterPct: $('water-pct'), visionBar: $('vision-bar'),
      wormPct: $('worm-pct'), wormStraight: $('worm-straight'), danger: $('danger'), stride: $('stride'), strideBars: $('stride-bars'), strideStatus: $('stride-status'),
    });
    ui.waterSegs = Array.from({ length: 10 }, () => $('water-segs').appendChild(document.createElement('i')));
    ui.strideEls = Array.from({ length: 8 }, () => ui.strideBars.appendChild(document.createElement('i')));
    $('journey-labels').innerHTML = ZONE_LABELS.map((l, i) => `<span>${roman(i + 1)} · ${l}</span>`).join('');
    ui.thumperBtn.addEventListener('click', (e) => { e.stopPropagation(); this.onAction('thumper'); });
    ui.abilityBtn.addEventListener('click', (e) => { e.stopPropagation(); this.onAction('ability'); });
    ui.abilityBtn.addEventListener('touchend', (e) => e.stopPropagation());
    ui.thumperBtn.addEventListener('touchend', (e) => e.stopPropagation());
    $('title-saying').textContent = `“${saying()}”`;
    $('play-btn').addEventListener('click', () => this.start());
    $('intro-skip').addEventListener('click', (e) => { e.stopPropagation(); this.endIntro(); });
    $('chars-btn').addEventListener('click', () => this.openChars());
    $('chars-back').addEventListener('click', () => this.closeChars());
    const list = $('chars-list');
    list.addEventListener('click', (e) => {
      const pick = e.target.closest('[data-pick]'), buy = e.target.closest('[data-buy]'), card = e.target.closest('[data-preview]');
      if (pick) this.pickChar(pick.dataset.pick);
      else if (buy) this.buyChar(buy.dataset.buy);
      else if (card) this.previewChar(card.dataset.preview);
    });
    const hover = (e) => { const card = e.target.closest('[data-preview]'); if (card) this.previewChar(card.dataset.preview); };
    list.addEventListener('pointerover', hover);
    list.addEventListener('focusin', hover);
    $('play-btn-m').addEventListener('click', () => this.start());
    $('again-btn').addEventListener('click', () => this.start());
    $('menu-btn').addEventListener('click', () => this.toTitle());
    $('resume-btn').addEventListener('click', () => this.resume());
    $('quit-btn').addEventListener('click', () => { this.ui.pause.classList.add('hidden'); this.state = 'running'; this.die('crash', true); });
    $('pause-btn').addEventListener('click', (e) => { e.stopPropagation(); this.pause(); });
    const qb = $('quality-btn');
    qb.addEventListener('click', () => {
      this.quality = this.quality === 'high' ? 'low' : 'high';
      this.save.quality = this.quality;
      this.writeSave();
      this.applyQuality(true);
    });
    const sb = $('sound-btn');
    const syncSound = () => { sb.textContent = `Sound · ${this.audio.enabled ? 'On' : 'Off'}`; };
    sb.addEventListener('click', () => { this.audio.init(); this.audio.setEnabled(!this.audio.enabled); syncSound(); });
    syncSound();
    this.refreshTitle();
    ui.last = {};
    // ambient motion for the screens: dust in the pause light, sand sifting on the end screen
    const rnd = (a, b) => a + Math.random() * (b - a);
    $('motes').innerHTML = Array.from({ length: 26 }, () =>
      `<i style="left:${rnd(45, 100)}%;top:${rnd(10, 100)}%;animation-duration:${rnd(7, 15)}s;animation-delay:-${rnd(0, 15)}s;opacity:${rnd(0.3, 0.9)}"></i>`).join('');
    $('sandfall').innerHTML = Array.from({ length: 40 }, () =>
      `<i style="left:${rnd(0, 100)}%;animation-duration:${rnd(2.5, 6)}s;animation-delay:-${rnd(0, 6)}s;height:${rnd(8, 22)}px"></i>`).join('');
    // the title's sayings drift past one after another
    setInterval(() => {
      if (this.state !== 'title') return;
      const el = $('title-saying');
      el.style.opacity = 0;
      setTimeout(() => { el.textContent = `“${saying()}”`; el.style.opacity = 1; }, 800);
    }, 9000);
  },

  setText(key, el, value) {
    if (this.ui.last[key] !== value) { this.ui.last[key] = value; el.textContent = value; }
  },

  toast(text) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = text;
    this.ui.toasts.appendChild(d);
    setTimeout(() => d.remove(), 3100);
  },

  banner(text) {
    const b = this.ui.zoneBanner;
    this.ui.zoneText.textContent = text;
    b.classList.remove('hidden');
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => b.classList.add('hidden'), 3400);
  },

  flash(color = '#fff', strength = 0.6) {
    const f = this.ui.flash;
    f.style.transition = 'none';
    f.style.background = color;
    f.style.opacity = strength;
    void f.offsetWidth;
    f.style.transition = 'opacity 0.5s';
    f.style.opacity = 0;
  },

  syncInventory() {
    const p = this.p;
    this.setText('thumpers', this.ui.thumpers, String(p.thumpers));
    this.setText('thumperBtn', this.ui.thumperBtnCount, `× ${p.thumpers}`);
    this.ui.invThumper.classList.toggle('empty', p.thumpers <= 0);
    this.ui.invHooks.classList.toggle('hidden', p.hooks <= 0);
    this.ui.thumperBtn.classList.toggle('empty', p.thumpers <= 0);
  },

  // Stride trace: one bar per recent move on sand, height = time since the move before it.
  drawStride() {
    const p = this.p, ui = this.ui;
    const list = p.strides;
    ui.strideEls.forEach((el, i) => {
      const s = list[i - (8 - list.length)];
      el.style.display = s ? '' : 'none';
      if (!s) return;
      el.style.height = `${Math.round(clamp(s.gap * 40, 5, 38))}px`;
      el.classList.toggle('match', s.match);
    });
    const last = list[list.length - 1];
    const st = ui.strideStatus;
    st.textContent = !last ? 'Break your stride' : last.match ? 'Last two matched — too regular' : 'Uneven — the sand is quiet';
    st.classList.toggle('good', !!last && !last.match);
  },

  tips(seg) {
    const p = this.p;
    const ui = this.ui;
    // the turn arrow: shown for every corner until the turn is committed
    const turning = seg.next && !p.pendingTurn && p.fly <= 0 && p.ride <= 0 && p.seg.length - p.s < Math.max(30, p.speed * 1.6);
    ui.turnHint.classList.toggle('hidden', !turning);
    if (turning) ui.turnHint.classList.toggle('left', seg.turn < 0);
    let tip = null;
    if (turning && this.inTurnWindow()) {
      tip = isTouch ? `Swipe ${seg.turn < 0 ? 'left' : 'right'} to turn` : `${seg.turn < 0 ? '←' : '→'} Turn`;
    } else if (this.tutorial && p.fly <= 0 && p.ride <= 0) {
      const rockAhead = (seg.rocks || []).find(([a]) => a - p.s > 0 && a - p.s < 30);
      if (p.onSand && p.sign > 65 && p.thumpers > 0) {
        tip = isTouch ? 'Tap THUMPER to lure the worm' : 'E — plant a thumper';
      } else if (rockAhead && p.sign > 30) {
        tip = 'Stone ahead — the Maker cannot follow';
      } else if (p.onSand && p.sign > 35) {
        tip = isTouch ? 'Swipe unevenly — break your rhythm' : 'Jump · slide · weave — unevenly';
      } else {
        for (const o of seg.obstacles) {
          const d = o.s0 - p.s;
          if (d < 0 || d > 28 || !o.active || o.fatal) continue;
          if (o.y0 > 1) tip = isTouch ? 'Swipe down to slide' : '↓ Slide';
          else if (o.y1 < 2) tip = isTouch ? 'Swipe up to jump' : '↑ Jump';
          else tip = isTouch ? 'Swipe to dodge' : '← → Dodge';
          break;
        }
        if (!tip) for (const [a] of seg.gaps) if (a - p.s > 0 && a - p.s < 28) { tip = isTouch ? 'Swipe up to leap' : '↑ Leap the sinkhole'; break; }
      }
    }
    if (p.qte) tip = null; // the prompt has the stage
    if (tip) {
      ui.tip.classList.remove('hidden');
      this.setText('tip', ui.tip, tip);
    } else ui.tip.classList.add('hidden');
  },

  updateHUD() {
    const p = this.p;
    const ui = this.ui;
    this.setText('score', ui.score, Math.floor(p.score).toLocaleString());
    this.setText('mult', ui.mult, `×${p.mult}`);
    this.setText('spice', ui.spice, String(p.spice));
    this.setText('dist', ui.dist, Math.floor(p.runDist).toLocaleString());
    const close = p.sign / 100;
    const signPct = Math.round(close * 100);
    // always on during a run: how close the Maker is, and how long you have held a straight line
    ui.wormMeter.classList.add('show');
    const line = p.onSand && p.straight > 25 ? Math.round(p.straight / 5) * 5 : 0;
    this.setText('wormStraight', ui.wormStraight, line ? `straight ${line} m — weave` : p.onSand ? '' : p.ride > 0 || p.fly > 0 ? '' : 'old stone — safe');
    ui.wormMeter.classList.toggle('straight', p.straight > straightLimit(p.runDist) * 0.55 && p.onSand);
    ui.wormMeter.classList.toggle('lured', p.lure > 0);
    ui.wormFill.style.width = `${signPct}%`;
    this.setText('wormPct', ui.wormPct, `${signPct}%`);
    const danger = (Math.max(0, signPct - 40) / 60).toFixed(2);
    if (ui.last.danger !== danger) { ui.last.danger = danger; ui.danger.style.opacity = danger; }
    ui.thumperBtn.classList.toggle('show', p.thumpers > 0 && p.ride <= 0 && (signPct >= 40 || p.onSand));
    // the ability button fills as its cooldown runs down
    const ab = this.char.active;
    this.setText('abilityName', ui.abilityName, p.abilityCd > 0 ? `${ab.name} · ${Math.ceil(p.abilityCd)}` : ab.name);
    const ready = p.abilityCd <= 0;
    ui.abilityBtn.classList.toggle('ready', ready);
    ui.abilityFill.style.transform = `scaleX(${ready ? 1 : 1 - p.abilityCd / ab.cooldown})`;
    ui.stride.classList.toggle('hidden', !p.onSand || p.ride > 0);
    const water = Math.round(p.water);
    if (ui.last.water !== water) {
      ui.last.water = water;
      ui.waterPct.textContent = `${water}%`;
      const lit = Math.ceil(water / 10);
      ui.waterSegs.forEach((s, i) => s.classList.toggle('on', i < lit));
    }
    ui.waterBar.classList.toggle('low', p.water < 25);
    const vision = p.trance > 0 ? (p.trance / TRANCE_TIME) * 100 : p.vision;
    ui.visionBar.classList.toggle('show', vision > 0.5);
    ui.visionFill.style.width = `${Math.round(vision)}%`;
    // effects running down, in the order and colours set in content/powerups.js
    const pu = [];
    for (const st of STATUS) {
      const f = st.level(p);
      if (f > 0) pu.push([st.label, st.color, f]);
    }
    const key = pu.map((x) => x[0] + Math.round(x[2] * 30)).join();
    if (key !== ui.last.pu) {
      ui.last.pu = key;
      ui.powerups.innerHTML = pu.map(([n, c, f]) => `<div class="pu"><span>${n}</span><span class="t" style="color:${c}"><b style="width:${Math.round(f * 100)}%"></b></span></div>`).join('');
    }
    const tint = p.trance > 0 ? 0.2 : 0;
    if (ui.last.tint !== tint) {
      ui.last.tint = tint;
      ui.tint.style.background = '#3a4cff';
      ui.tint.style.opacity = tint;
    }
  },
};
