import { Game } from './game.js';

function boot() {
  try {
    const game = new Game(document.getElementById('app'));
    if (import.meta.env.DEV) import('./devtools.js').then((m) => m.attachDevtools(game));
  } catch (err) {
    console.error(err);
    const l = document.getElementById('loading');
    l.innerHTML = '<div>WebGL is required to cross the desert.</div>';
  }
}

boot();
