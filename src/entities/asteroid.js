'use strict'

const vector = require('../engine/vector')

// size tier -> { radius, hp, symbol, splitInto }
const TIERS = {
  large: { radius: 3, hp: 3, symbol: 'O', splitInto: 'medium', splitCount: 2 },
  medium: { radius: 2, hp: 2, symbol: 'o', splitInto: 'small', splitCount: 2 },
  small: { radius: 1, hp: 1, symbol: '.', splitInto: null, splitCount: 0 }
}

let nextId = 1

function spawnAsteroid(rng, { x, y, tier = 'large', speed }) {
  const def = TIERS[tier]
  const angle = rng.angle()
  const mag = speed ?? rng.range(1, 3)

  return {
    id: nextId++,
    kind: 'asteroid',
    tier,
    pos: { x, y },
    vel: vector.fromAngle(angle, mag),
    radius: def.radius,
    hp: def.hp,
    symbol: def.symbol,
    spin: rng.range(-1, 1)
  }
}

// Spawns a large asteroid at a random edge of the arena, aimed roughly inward.
function spawnAtEdge(rng, width, height, tier = 'large') {
  const side = rng.int(0, 3)
  let x, y
  if (side === 0) {
    x = 0
    y = rng.range(0, height)
  } else if (side === 1) {
    x = width
    y = rng.range(0, height)
  } else if (side === 2) {
    x = rng.range(0, width)
    y = 0
  } else {
    x = rng.range(0, width)
    y = height
  }

  return spawnAsteroid(rng, { x, y, tier })
}

// On destruction, large/medium asteroids break into smaller ones.
// Returns an array of newly spawned fragments (possibly empty).
function split(rng, asteroid) {
  const def = TIERS[asteroid.tier]
  if (!def.splitInto) return []

  const fragments = []
  for (let i = 0; i < def.splitCount; i++) {
    fragments.push(
      spawnAsteroid(rng, {
        x: asteroid.pos.x,
        y: asteroid.pos.y,
        tier: def.splitInto,
        speed: rng.range(2, 4)
      })
    )
  }
  return fragments
}

module.exports = { TIERS, spawnAsteroid, spawnAtEdge, split }
