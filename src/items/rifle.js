'use strict'

const vector = require('../engine/vector')
const { spawnProjectile } = require('../entities/bullet')

// Long-range precision weapon: a single fast, hard-hitting shot that
// outranges everything else in the game. Eligible for the multishot
// upgrade (see items/upgrades.js) since it's a focused single projectile
// rather than an already-spread pattern like the shotgun.
module.exports = {
  id: 'rifle',
  name: 'Rifle',
  symbol: '|',
  type: 'weapon',
  cooldownMs: 350,
  unlimitedAmmo: false,
  ammoPerPickup: 10,
  fieldPickup: true,
  multishotEligible: true,

  fire({ player }) {
    return [
      spawnProjectile({
        pos: player.pos,
        vel: vector.fromAngle(player.angle, 16),
        symbol: '|',
        damage: 2,
        ttlMs: 6000
      })
    ]
  }
}
