import { clamp } from '../../engine/noise.js';
import { ZONES } from '../../content/zones.js';
import { BEATS, INTRO, chapterFor, roman, waypointAt } from '../../content/story.js';
import { INTRO_SHOT } from '../constants.js';
import { $ } from '../dom.js';

// Story: the opening, chapters, waypoints, narration beats and the journal.
// Installed on Game.prototype (see game/Game.js), so `this` is the Game.
export const NarrativeSystem = {
  startIntro() {
    this.state = 'intro';
    this.introT = 0;
    this.introIdx = -1;
    this.ui.hud.classList.add('hidden');
    this.ui.intro.classList.remove('hidden');
    this.ui.introDots.innerHTML = INTRO.map(() => '<i></i>').join('');
    this.cinema(true);
    this.audio.braam(0.6);
  },

  updateIntro(dt) {
    this.introT += dt;
    const cam = this.camera;
    if (cam) {
      // widen the view and centre the runner when the screen is taller than wide
      this.introTall = clamp((1.0 - cam.aspect) / 0.5, 0, 1);
    }
    const idx = Math.floor(this.introT / INTRO_SHOT);
    if (idx >= INTRO.length) return this.endIntro();
    if (idx !== this.introIdx) {
      this.introIdx = idx;
      const card = this.ui.introCard;
      card.classList.remove('show');
      void card.offsetWidth;
      this.ui.introKicker.textContent = INTRO[idx].kicker;
      this.ui.introLine.textContent = INTRO[idx].line;
      card.classList.add('show');
      [...this.ui.introDots.children].forEach((d, i) => d.classList.toggle('on', i <= idx));
      if (idx === INTRO.length - 1) this.audio.braam(0.7);
    }
  },

  endIntro() {
    if (this.state !== 'intro') return;
    this.introSeen = true;
    this.ui.intro.classList.add('hidden');
    this.ui.introCard.classList.remove('show');
    this.beginRun();
  },

  // the next place the seed-water must reach, and how far off it is
  updateGoal() {
    const p = this.p;
    const w = waypointAt(p.wp || 0);
    const km = Math.max(0, (w.at - p.runDist) / 1000);
    const left = km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
    this.setText('goal', this.ui.goal, `To ${w.name} · ${left}`);
  },

  reachWaypoint() {
    const p = this.p;
    const w = waypointAt(p.wp);
    p.wp++;
    p.water = 100;
    p.score += 1000 * p.mult;
    p.journal.push({ num: '◆', title: w.name.replace(/^the /, ''), line: w.line });
    this.narrate(w.line, 5200);
    this.toast(`Seed-water reached ${w.name}`);
    this.audio.braam(0.9);
    this.audio.powerup();
    this.flash('#9fd8ff', 0.25);
  },

  beat(key, repeatable = false) {
    const p = this.p;
    if (!repeatable && p.beats[key]) return;
    if (repeatable && p.beats[key] && this.time - p.beats[key] < 6) return;
    p.beats[key] = this.time;
    this.narrate(BEATS[key]);
  },

  cinema(on, ms = 0) {
    clearTimeout(this.cinemaTimer);
    this.app.classList.toggle('cinema', on);
    if (on && ms) this.cinemaTimer = setTimeout(() => this.app.classList.remove('cinema'), ms);
  },

  narrate(text, ms = 4600) {
    if (!text) return;
    this.narrQueue = this.narrQueue || [];
    const bannerActive = this.ui.zoneBanner && !this.ui.zoneBanner.classList.contains('hidden');
    const narrActive = this.ui.narration && !this.ui.narration.classList.contains('hidden');
    if (bannerActive || narrActive) {
      if (this.narrQueue.length < 5) this.narrQueue.push({ text, ms });
      return;
    }
    this._showNarrate(text, ms);
  },

  _showNarrate(text, ms) {
    const el = this.ui.narration;
    el.textContent = text;
    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(this.narrTimer);
    this.narrTimer = setTimeout(() => {
      el.classList.add('hidden');
      this.flushNarrate();
    }, ms);
  },

  flushNarrate() {
    if (!this.narrQueue || !this.narrQueue.length) return;
    if (this.state !== 'running' && this.state !== 'intro') return;
    const bannerActive = this.ui.zoneBanner && !this.ui.zoneBanner.classList.contains('hidden');
    if (bannerActive) return;
    const next = this.narrQueue.shift();
    if (next) this._showNarrate(next.text, next.ms);
  },

  chapter(zoneId) {
    const p = this.p;
    p.chapter++;
    const visit = p.visits[zoneId] || 0;
    p.visits[zoneId] = visit + 1;
    const c = chapterFor(zoneId, visit);
    const num = roman(p.chapter);
    p.journal.push({ num, title: c.title, line: c.line });
    this.ui.zoneBanner.querySelector('small').textContent = `Chapter ${num}`;
    this.ui.hudChapter.textContent = `Chapter ${num} · ${c.title}`;
    // progress through the current cycle of five biomes
    const inCycle = ZONES.findIndex((z) => z.id === zoneId) + 1;
    $('zone-dashes').innerHTML = ZONES.map((_, i) => `<i class="${i < inCycle ? 'on' : ''}"></i>`).join('');
    this.banner(c.title);
    if (p.chapter > 1) {
      // no letterbox mid-run: it would hide the HUD and the trail ahead
      this.audio.braam(0.6);
      this.app.classList.add('chaptering');
      clearTimeout(this.duskTimer);
      this.duskTimer = setTimeout(() => this.app.classList.remove('chaptering'), 3000);
      setTimeout(() => this.state === 'running' && this.narrate(c.line, 5200), 3500); // once the card has gone
    }
  },

  renderJournal() {
    const entries = this.p.journal.slice(-4);
    $('journal-list').innerHTML = entries
      .map((e) => `<li><span class="n">${e.num}</span><div><b>${e.title}</b><p>${e.line}</p></div></li>`)
      .join('');
  },
};
