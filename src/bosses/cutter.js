'use strict'

const vector = require('../engine/vector')
const { angleToPlayer, fireAimed } = require('./_helpers')

// Boss #2 — alternates between charging a dash at the player and taking a
// single aimed shot while it recovers.
module.exports = {
  id: 'cutter',
  name: 'Cortador',
  symbol: 'X',
  radius: 2,
  baseHp: 22,
  attackIntervalMs: 1400,
  contactDamage: 2,

  update({ boss, world, dt, dtMs }) {
    if (boss.state.dashMsLeft > 0) {
      boss.state.dashMsLeft -= dtMs
      boss.pos = vector.wrap(
        vector.add(boss.pos, vector.scale(boss.vel, dt)),
        world.width,
        world.height
      )
    } else {
      boss.vel = { x: 0, y: 0 }
    }
  },

  attack({ boss, player }) {
    // every other attack tick, dash instead of shooting
    boss.state.dashToggle = !boss.state.dashToggle
    if (boss.state.dashToggle) {
      const angle = angleToPlayer(boss, player)
      boss.vel = vector.fromAngle(angle, 14)
      boss.state.dashMsLeft = 350
      return []
    }
    return [fireAimed(boss, player, { speed: 7, symbol: 'x', damage: 1 })]
  }
}
