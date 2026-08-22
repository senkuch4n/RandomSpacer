'use strict'

let nextId = 1

// Instantiates a boss entity from a definition (see src/bosses/*.js).
// `wave` scales hp so later boss appearances are tougher; `hpMultiplier`
// applies the chosen difficulty on top of that curve.
function spawnBoss(def, { x, y, wave = 1, hpMultiplier = 1 }) {
  const maxHp = Math.round(def.baseHp * (1 + 0.35 * (wave - 1)) * hpMultiplier)

  return {
    id: nextId++,
    kind: 'boss',
    defId: def.id,
    name: def.name,
    symbol: def.symbol,
    pos: { x, y },
    vel: { x: 0, y: 0 },
    radius: def.radius,
    maxHp,
    hp: maxHp,
    phase: 0,
    attackTimerMs: def.attackIntervalMs,
    state: {} // scratch space for the boss's own attack pattern
  }
}

module.exports = { spawnBoss }
