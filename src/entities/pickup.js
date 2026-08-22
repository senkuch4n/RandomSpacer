'use strict'

let nextId = 1

// Field pickup for any item in the registry (weapon unlock, ability charge,
// or the life item). Touching it applies the item's onPickup effect.
function spawnPickup(rng, { x, y, itemId, ttlMs = 12000 }) {
  return {
    id: nextId++,
    kind: 'pickup',
    itemId,
    pos: { x, y },
    vel: { x: rng.range(-0.3, 0.3), y: rng.range(-0.3, 0.3) },
    radius: 1,
    ttlMs,
    ageMs: 0
  }
}

module.exports = { spawnPickup }
