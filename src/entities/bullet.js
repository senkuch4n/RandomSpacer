'use strict'

let nextId = 1

// A single flexible projectile shape shared by every weapon item.
// Weapon defs (src/items/*) only need to fill in the fields relevant to
// their behavior; unused fields stay at their default.
function spawnProjectile({
  pos,
  vel,
  symbol = '*',
  damage = 1,
  radius = 0.5,
  ttlMs = 2500, // default gives a speed-12 shot ~30 units of range — enough to cross the (smaller) arena
  blastRadius = 0, // > 0: explodes on impact/expiry, damaging everything in range
  homing = false, // true: steers toward homingTargetId each tick (missile)
  homingTargetId = null,
  homingTargetKind = null, // 'boss' | 'asteroid' — disambiguates id collisions across kinds
  turnRate = 0, // radians/sec applied when homing
  boomerang = false, // true: returns to owner after reaching maxRange
  maxRange = 0,
  owner = 'player' // 'player' or 'boss' — decides what it can collide with
}) {
  return {
    id: nextId++,
    kind: 'projectile',
    owner,
    pos: { x: pos.x, y: pos.y },
    vel: { x: vel.x, y: vel.y },
    symbol,
    damage,
    radius,
    ttlMs,
    ageMs: 0,
    traveled: 0,
    blastRadius,
    homing,
    homingTargetId,
    homingTargetKind,
    turnRate,
    boomerang,
    maxRange,
    returning: false
  }
}

module.exports = { spawnProjectile }
