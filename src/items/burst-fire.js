'use strict'

const vector = require('../engine/vector')
const { spawnProjectile } = require('../entities/bullet')

const SPREAD_RAD = 0.18
const SHOTS = 3

// Fires several bullets in one narrow spread instead of a single shot.
module.exports = {
  id: 'burst-fire',
  name: 'Disparo en rafaga',
  symbol: ':',
  type: 'weapon',
  cooldownMs: 500,
  unlimitedAmmo: true,
  ammoPerPickup: 6,
  fieldPickup: true,

  fire({ player }) {
    const shots = []
    for (let i = 0; i < SHOTS; i++) {
      const t = i / (SHOTS - 1) - 0.5
      const angle = player.angle + t * SPREAD_RAD
      shots.push(
        spawnProjectile({
          pos: player.pos,
          vel: vector.fromAngle(angle, 12),
          symbol: ':',
          damage: 1
        })
      )
    }
    return shots
  }
}
