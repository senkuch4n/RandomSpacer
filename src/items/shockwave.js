'use strict'

const vector = require('../engine/vector')

const RADIUS = 10
const BOSS_DAMAGE = 4

let nextEffectId = 1

// Panic-button ability rather than a cycled weapon: instantly clears every
// asteroid in range and chips the boss. Unlimited charges, picked up from
// the field like everything else.
module.exports = {
  id: 'shockwave',
  name: 'Onda expansiva',
  symbol: 'O',
  type: 'ability',
  cooldownMs: 300,
  unlimitedAmmo: true,
  ammoPerPickup: 1,
  fieldPickup: true,

  activate({ player, world }) {
    world.asteroids = world.asteroids.filter((a) => {
      if (vector.distance(player.pos, a.pos) <= RADIUS) {
        player.score += 5
        return false
      }
      return true
    })

    if (world.boss && vector.distance(player.pos, world.boss.pos) <= RADIUS) {
      world.boss.hp -= BOSS_DAMAGE
    }

    return [
      {
        id: nextEffectId++,
        kind: 'effect',
        type: 'shockwave-ring',
        pos: { x: player.pos.x, y: player.pos.y },
        maxRadius: RADIUS,
        ttlMs: 350,
        ageMs: 0
      }
    ]
  }
}
