// Small DOM helpers shared by the game systems.

export const $ = (id) => document.getElementById(id);

// touch-first devices get touch wording in tips and the lighter quality preset by default
export const isTouch = matchMedia('(pointer: coarse)').matches;
