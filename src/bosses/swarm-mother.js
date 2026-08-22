'use strict'

const asteroid = require('../entities/asteroid')

// Boss #3 — mostly drifts, periodically hatches small asteroid "drones"
// aimed at the player instead of shooting directly.
module.exports = {
  id: 'swarm-mother',
  name: 'Madre Enjambre',
  symbol: '&',
  radius: 3,
  baseHp: 26,
  attackIntervalMs: 2200,
  contactDamage: 1,

  update({ boss, world, dtMs }) {
    boss.state.driftAngle = (boss.state.driftAngle ?? 0) + dtMs * 0.0003
    boss.pos.x += Math.sin(boss.state.driftAngle) * 0.02 * dtMs
    boss.pos.x = Math.max(boss.radius, Math.min(world.width - boss.radius, boss.pos.x))
  },

  attack({ boss, player, rng }) {
    const drones = []
    for (let i = 0; i < 3; i++) {
      const drone = asteroid.spawnAsteroid(rng, {
        x: boss.pos.x + rng.range(-2, 2),
        y: boss.pos.y + rng.range(-1, 1),
        tier: 'small'
      })
      const angle = Math.atan2(player.pos.y - drone.pos.y, player.pos.x - drone.pos.x)
      const speed = 3
      drone.vel = { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed }
      drones.push(drone)
    }
    return drones
  }
}
