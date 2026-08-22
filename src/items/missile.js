'use strict'

const vector = require('../engine/vector')
const { spawnProjectile } = require('../entities/bullet')

// Homing shot. Targeting itself (nearest boss/asteroid to the player) is
// now applied to every weapon centrally in world.js's _applyHoming, since
// it's no longer missile-exclusive — this just fires a slower, harder-
// hitting projectile than the rest of the roster.
module.exports = {
  id: 'missile',
  name: 'Misil',
  symbol: '^',
  type: 'weapon',
  cooldownMs: 900,
  unlimitedAmmo: true,
  ammoPerPickup: 4,
  fieldPickup: true,

  fire({ player }) {
    return [
      spawnProjectile({
        pos: player.pos,
        vel: vector.fromAngle(player.angle, 8),
        symbol: '^',
        damage: 2,
        ttlMs: 4500
      })
    ]
  }
}
