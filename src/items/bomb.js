'use strict'

const vector = require('../engine/vector')
const { spawnProjectile } = require('../entities/bullet')

// Slow-moving lob that explodes on impact or timeout, damaging everything
// in its blast radius. Infinite ammo, picked up from the field.
module.exports = {
  id: 'bomb',
  name: 'Bomba',
  symbol: 'o',
  type: 'weapon',
  cooldownMs: 1200,
  unlimitedAmmo: true,
  ammoPerPickup: 3,
  fieldPickup: true,

  fire({ player }) {
    return [
      spawnProjectile({
        pos: player.pos,
        vel: vector.fromAngle(player.angle, 5),
        symbol: 'o',
        damage: 1,
        ttlMs: 1400,
        blastRadius: 4
      })
    ]
  }
}
