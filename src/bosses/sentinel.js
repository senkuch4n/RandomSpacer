'use strict'

const { fireSpread } = require('./_helpers')

// Boss #1 — slow orbiter that peppers the arena with spread shots.
module.exports = {
  id: 'sentinel',
  name: 'Centinela',
  symbol: '@',
  radius: 3,
  baseHp: 30,
  attackIntervalMs: 1800,
  contactDamage: 1,

  update({ boss, world, dtMs }) {
    boss.state.orbitAngle = (boss.state.orbitAngle ?? 0) + dtMs * 0.0006
    const cx = world.width / 2
    const cy = world.height / 3
    const r = 8
    boss.pos.x = cx + Math.cos(boss.state.orbitAngle) * r
    boss.pos.y = cy + Math.sin(boss.state.orbitAngle) * r * 0.5
  },

  attack({ boss, player }) {
    return fireSpread(boss, player, { count: 5, spreadRad: Math.PI / 2.2, speed: 5 })
  }
}
