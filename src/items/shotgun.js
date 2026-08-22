'use strict'

const vector = require('../engine/vector')
const { spawnProjectile } = require('../entities/bullet')

const PELLETS = 5
const SPREAD_RAD = 0.6

// Close-range weapon: a wide fan of pellets that all connect at once
// against anything nearby, but each is individually weaker and short-
// lived — the opposite trade-off from the rifle.
module.exports = {
  id: 'shotgun',
  name: 'Escopeta',
  symbol: ':',
  type: 'weapon',
  cooldownMs: 700,
  unlimitedAmmo: false,
  ammoPerPickup: 5,
  fieldPickup: true,

  fire({ player }) {
    const shots = []
    for (let i = 0; i < PELLETS; i++) {
      const t = i / (PELLETS - 1) - 0.5
      const angle = player.angle + t * SPREAD_RAD
      shots.push(
        spawnProjectile({
          pos: player.pos,
          vel: vector.fromAngle(angle, 11),
          symbol: ':',
          damage: 1,
          ttlMs: 1600
        })
      )
    }
    return shots
  }
}
