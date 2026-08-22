'use strict'

const vector = require('../engine/vector')

// size tier -> { radius, hp, symbol, splitInto }
// Symbols use the same solid/light block-density language as the boss
// sprites (src/render/terminal.js BOSS_SPRITES) — a retro arcade-pixel
// look shared across every hostile on screen, tier size reading as block
// density instead of a circle getting smaller.
const TIERS = {
  large: { radius: 3, hp: 3, symbol: '▓', splitInto: 'medium', splitCount: 2 },
  medium: { radius: 2, hp: 2, symbol: '▒', splitInto: 'small', splitCount: 2 },
  small: { radius: 1, hp: 1, symbol: '░', splitInto: null, splitCount: 0 }
}

let nextId = 1

function spawnAsteroid(rng, { x, y, tier = 'large', speed, angle, spawnGraceMs = 0 }) {
  const def = TIERS[tier]
  const dir = angle ?? rng.angle()
  const mag = speed ?? rng.range(1, 3)

  return {
    id: nextId++,
    kind: 'asteroid',
    tier,
    pos: { x, y },
    vel: vector.fromAngle(dir, mag),
    radius: def.radius,
    hp: def.hp,
    symbol: def.symbol,
    spin: rng.range(-1, 1),
    spawnGraceMs
  }
}

const EDGE_AIM_SPREAD = Math.PI / 6 // +/- 30 degrees of jitter around the aim point

// Spawns a large asteroid at a random edge of the arena, aimed at `target`
// (typically the player) with some spread so they visibly close in instead
// of drifting in a random direction.
function spawnAtEdge(rng, width, height, target, tier = 'large') {
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

  const aim = Math.atan2(target.y - y, target.x - x) + rng.range(-EDGE_AIM_SPREAD, EDGE_AIM_SPREAD)
  return spawnAsteroid(rng, { x, y, tier, angle: aim })
}

// ms a freshly materialized asteroid ignores ship contact — long enough
// that something popping into existence right next to the player (a
// point-blank bomb kill's shrapnel, or a boss-summoned drone spawned near
// a player standing close to the boss) can't tag them the instant it
// appears, before they could possibly have reacted to it. Any caller that
// spawns an asteroid somewhere other than off-screen/away-from-player
// (see enemyGenerator.js's awayFromPlayer/edgePoint helpers, which don't
// need this) should pass this as `spawnGraceMs`.
const SPAWN_GRACE_MS = 300

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
        speed: rng.range(2, 4),
        spawnGraceMs: SPAWN_GRACE_MS
      })
    )
  }
  return fragments
}

module.exports = { TIERS, spawnAsteroid, spawnAtEdge, split, SPAWN_GRACE_MS }
