'use strict'

const vector = require('../engine/vector')
const { spawnProjectile } = require('../entities/bullet')

// Flies out, then reverses back toward the ship once it reaches maxRange
// (world.js flips its velocity when `traveled >= maxRange`). Can hit
// asteroids on both legs of the trip.
module.exports = {
  id: 'boomerang',
  name: 'Boomerang',
  symbol: ')',
  type: 'weapon',
  cooldownMs: 700,
  unlimitedAmmo: true,
  ammoPerPickup: 0,
  fieldPickup: true,

  fire({ player }) {
    return [
      spawnProjectile({
        pos: player.pos,
        vel: vector.fromAngle(player.angle, 9),
        symbol: ')',
        damage: 1,
        ttlMs: 2500,
        boomerang: true,
        maxRange: 12
      })
    ]
  }
}
