'use strict'

const vector = require('../engine/vector')
const { spawnProjectile } = require('../entities/bullet')

function findTarget(player, world) {
  const candidates = []
  if (world.boss) candidates.push(world.boss)
  for (const a of world.asteroids) candidates.push(a)

  let best = null
  let bestDist = Infinity
  for (const c of candidates) {
    const d = vector.distance(player.pos, c.pos)
    if (d < bestDist) {
      bestDist = d
      best = c
    }
  }
  return best
}

// Homing shot: locks onto the nearest boss/asteroid at fire time and
// steers toward it each tick. Falls back to a straight shot if nothing
// is on the field.
module.exports = {
  id: 'missile',
  name: 'Misil',
  symbol: '^',
  type: 'weapon',
  cooldownMs: 900,
  unlimitedAmmo: true,
  ammoPerPickup: 4,
  fieldPickup: true,

  fire({ player, world }) {
    const target = findTarget(player, world)
    return [
      spawnProjectile({
        pos: player.pos,
        vel: vector.fromAngle(player.angle, 8),
        symbol: '^',
        damage: 2,
        ttlMs: 4500,
        homing: Boolean(target),
        homingTargetId: target ? target.id : null,
        homingTargetKind: target ? target.kind : null,
        turnRate: 4
      })
    ]
  }
}
