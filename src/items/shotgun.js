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
  // Infinite ammo, matching the rest of the roster (bomb/missile/
  // shockwave) after Lautaro's "balas infinitas" balance change on main —
  // this file didn't exist there yet (it replaced burst-fire.js, which
  // did get that change), so it's applied here to keep parity.
  unlimitedAmmo: true,
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
