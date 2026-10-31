import { CHARACTERS, characterById, isUnlocked } from '../../content/characters.js';
import { $ } from '../dom.js';

// The carrier screen and title card: choose, preview and unlock characters.
// Installed on Game.prototype (see game/Game.js), so `this` is the Game.
export const CarriersSystem = {
  openChars() {
    this.state = 'chars';
    this.ui.title.classList.add('hidden');
    this.ui.chars.classList.remove('hidden');
    this.renderChars();
  },

  closeChars() {
    this.runner.applyLook(this.char.look); // undo any preview
    this.previewing = null;
    this.ui.chars.classList.add('hidden');
    this.ui.title.classList.remove('hidden');
    this.state = 'title';
    this.refreshTitle();
  },

  renderChars() {
    const sv = this.save;
    $('spice-bank').textContent = (sv.spiceBank || 0).toLocaleString();
    $('best-dist').textContent = `${(sv.bestDist || 0).toLocaleString()} m`;
    $('chars-list').innerHTML = CHARACTERS.map((c) => {
      const open = isUnlocked(c, sv);
      const sel = c.id === this.char.id;
      let foot;
      if (open) {
        foot = `<button class="char-pick" data-pick="${c.id}" ${sel ? 'disabled' : ''}>${sel ? 'Carrying the water' : `Choose ${c.name}`}</button>`;
      } else {
        const pct = Math.min(100, ((sv.bestDist || 0) / c.unlock.dist) * 100);
        const afford = (sv.spiceBank || 0) >= c.unlock.spice;
        foot = `<div class="char-lock"><div class="char-bar"><i style="width:${pct.toFixed(1)}%"></i></div>
          <span>Reach ${c.unlock.dist.toLocaleString()} m in one run</span>
          <button class="char-buy" data-buy="${c.id}" ${afford ? '' : 'disabled'}>Unlock now · ${c.unlock.spice.toLocaleString()} spice</button></div>`;
      }
      return `<article class="char-card${sel ? ' selected' : ''}${open ? '' : ' locked'}" role="listitem" tabindex="0" data-preview="${c.id}" title="${c.blurb}">
        <header><span class="char-role">${c.role}</span><b class="char-name">${c.name}</b>${open ? '' : '<i class="char-lockicon" aria-label="Locked">◇</i>'}</header>
        <p class="char-blurb">${c.blurb}</p>
        <dl>
          <dt>Trait</dt><dd>${c.passive}</dd>
          <dt>Ability · every ${c.active.cooldown} s</dt><dd><b>${c.active.name}.</b> ${c.active.text}</dd>
          <dt>Weakness</dt><dd>${c.weakness}</dd>
        </dl>
        ${foot}
      </article>`;
    }).join('');
  },

  // dress the figure behind the screen as whichever card is in focus (locked ones too)
  previewChar(id) {
    if (this.previewing === id) return;
    this.previewing = id;
    this.runner.applyLook(characterById(id).look);
  },

  pickChar(id) {
    const c = characterById(id);
    if (!isUnlocked(c, this.save)) return;
    this.char = c;
    this.save.selected = id;
    this.writeSave();
    this.runner.applyLook(c.look);
    this.audio.init();
    this.audio.powerup();
    this.renderChars();
  },

  buyChar(id) {
    const c = characterById(id);
    const sv = this.save;
    if (isUnlocked(c, sv) || (sv.spiceBank || 0) < c.unlock.spice) return;
    sv.spiceBank -= c.unlock.spice;
    sv.unlocked = [...(sv.unlocked || []), id];
    this.writeSave();
    this.pickChar(id);
  },

  refreshTitle() {
    if (this.char) $('carrier-name').textContent = `${this.char.name} · ${this.char.role}`;
    $('best-title').textContent = Math.floor(this.save.best).toLocaleString();
    $('quality-btn').textContent = `Quality · ${this.quality === 'low' ? 'Low' : 'High'}`;
  },
};
