'use strict'

const vector = require('../engine/vector')
const { spawnProjectile } = require('../entities/bullet')

// The player's default weapon. Always unlocked, infinite ammo, never
// spawns as a field pickup — it's the fallback everything else layers on.
module.exports = {
  id: 'main-shot',
  name: 'Disparo comun',
  symbol: '*',
  type: 'weapon',
  cooldownMs: 250,
  unlimitedAmmo: true,
  ammoPerPickup: 0,
  fieldPickup: false,

  fire({ player }) {
    return [
      spawnProjectile({
        pos: player.pos,
        vel: vector.fromAngle(player.angle, 12),
        symbol: '*',
        damage: 1
      })
    ]
  }
}
