import { Game } from './game.js';

function boot() {
  try {
    window.__game = new Game(document.getElementById('app'));
  } catch (err) {
    console.error(err);
    const l = document.getElementById('loading');
    l.innerHTML = '<div>WebGL is required to cross the desert.</div>';
  }
}

boot();
