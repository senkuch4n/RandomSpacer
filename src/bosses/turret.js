'use strict'

const { fireSpread, fireAimed } = require('./_helpers')

// Boss #4 — parked near the top of the arena, alternates a wide spread
// with an occasional fast aimed shot.
module.exports = {
  id: 'turret',
  name: 'Torreta',
  symbol: 'T',
  radius: 3,
  baseHp: 34,
  attackIntervalMs: 1600,
  contactDamage: 1,

  update({ boss, world }) {
    boss.pos.x = world.width / 2
    boss.pos.y = 3
  },

  attack({ boss, player }) {
    boss.state.tick = (boss.state.tick ?? 0) + 1
    if (boss.state.tick % 3 === 0) {
      return [fireAimed(boss, player, { speed: 9, symbol: '!', damage: 2 })]
    }
    return fireSpread(boss, player, { count: 7, spreadRad: Math.PI * 0.8, speed: 4.5 })
  }
}
