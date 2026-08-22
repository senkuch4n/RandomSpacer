'use strict'

const asteroid = require('../entities/asteroid')
const { fireAimed, fireSpread } = require('./_helpers')

// Boss #5 — big, slow final boss. Enters an enraged phase under 50% hp:
// faster attacks and summons an asteroid alongside every volley.
module.exports = {
  id: 'leviathan',
  name: 'Leviatán',
  symbol: 'M',
  radius: 4,
  baseHp: 50,
  attackIntervalMs: 2000,
  contactDamage: 2,

  update({ boss, world, dtMs }) {
    const enraged = boss.hp <= boss.maxHp * 0.5
    boss.phase = enraged ? 1 : 0

    boss.state.driftAngle = (boss.state.driftAngle ?? 0) + dtMs * (enraged ? 0.0009 : 0.0004)
    boss.pos.x = world.width / 2 + Math.cos(boss.state.driftAngle) * 6
    boss.pos.y = world.height / 4 + Math.sin(boss.state.driftAngle) * 2
  },

  attack({ boss, player, world, rng }) {
    if (boss.phase === 0) {
      return [fireAimed(boss, player, { speed: 6, symbol: 'M', damage: 2 })]
    }

    const shots = fireSpread(boss, player, {
      count: 4,
      spreadRad: Math.PI / 2,
      speed: 6,
      symbol: 'M',
      damage: 2
    })
    // Spawns right on top of the boss, which can be right on top of the
    // player at close range — grace period stops it from landing an
    // invisible hit the instant it appears.
    const drone = asteroid.spawnAsteroid(rng, {
      x: boss.pos.x,
      y: boss.pos.y,
      tier: 'medium',
      spawnGraceMs: asteroid.SPAWN_GRACE_MS
    })
    return [...shots, drone]
  }
}
