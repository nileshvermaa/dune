// Keyboard + touch swipe input mapped to game actions.

export class Input {
  constructor(target, onAction) {
    this.onAction = onAction;
    const keys = {
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
      ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
      ArrowDown: 'slide', KeyS: 'slide',
      Escape: 'pause', KeyP: 'pause',
      Enter: 'confirm',
      KeyE: 'thumper', KeyQ: 'thumper', ShiftLeft: 'thumper', ShiftRight: 'thumper',
    };
    window.addEventListener('keydown', (e) => {
      const a = keys[e.code];
      if (!a) return;
      if (e.repeat && a !== 'confirm') return;
      if (e.target && (e.target.tagName === 'BUTTON') && (a === 'jump' || a === 'confirm')) e.preventDefault();
      if (a !== 'confirm' || !e.repeat) this.onAction(a, e);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });

    let sx = 0, sy = 0, st = 0, fired = false;
    target.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      sx = t.clientX; sy = t.clientY; st = performance.now(); fired = false;
    }, { passive: true });
    target.addEventListener('touchmove', (e) => {
      if (fired) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 28) {
        fired = true;
        if (Math.abs(dx) > Math.abs(dy)) this.onAction(dx > 0 ? 'right' : 'left');
        else this.onAction(dy > 0 ? 'slide' : 'jump');
      }
    }, { passive: true });
    target.addEventListener('touchend', () => {
      if (!fired && performance.now() - st < 250) this.onAction('tap');
    }, { passive: true });
  }
}
