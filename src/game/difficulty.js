'use strict'

// Chosen on the title menu (see menu.js/loop.js) and threaded into World.
// Keeping every difficulty knob in one place/object avoids scattering
// magic multipliers across ship.js/world.js/enemyGenerator call sites.
const LEVELS = [
  { id: 'easy', label: 'Fácil', startLives: 4, waveBias: -1, bossHpMul: 0.8 },
  { id: 'normal', label: 'Normal', startLives: 3, waveBias: 0, bossHpMul: 1 },
  { id: 'hard', label: 'Difícil', startLives: 2, waveBias: 2, bossHpMul: 1.3 }
]

const DEFAULT_INDEX = 1 // Normal

function byId(id) {
  return LEVELS.find((d) => d.id === id) || LEVELS[DEFAULT_INDEX]
}

module.exports = { LEVELS, DEFAULT_INDEX, byId }
