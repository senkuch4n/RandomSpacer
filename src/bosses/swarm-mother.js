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

  attack({ boss, player, world, rng }) {
    const drones = []
    for (let i = 0; i < 3; i++) {
      const drone = asteroid.spawnAsteroid(rng, {
        x: boss.pos.x + rng.range(-2, 2),
        y: boss.pos.y + rng.range(-1, 1),
        tier: 'small',
        // Drones hatch right next to the boss, which can be right next to
        // the player if they're fighting up close — without this they can
        // materialize already touching the ship and deal an invisible hit.
        spawnGraceMs: asteroid.SPAWN_GRACE_MS,
        // Hatch at the current wave so late-game drones are as tanky as
        // the wave enemies they imitate.
        wave: Math.max(1, world.wave)
      })
      const angle = Math.atan2(player.pos.y - drone.pos.y, player.pos.x - drone.pos.x)
      const speed = 3
      drone.vel = { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed }
      drones.push(drone)
    }
    return drones
  }
}
