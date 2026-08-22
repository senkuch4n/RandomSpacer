'use strict'

// The boss roster. This is the file OTA updates are meant to touch: to
// ship a new boss, add its module here and push a `pear release` — every
// installed copy of the game picks it up next time it checks for updates,
// no reinstall or store submission involved.
//
// Each boss def needs: id, name, symbol, radius, baseHp, attackIntervalMs,
// contactDamage, update(ctx), attack(ctx). See src/bosses/_helpers.js for
// shared aiming/firing utilities and any existing boss for the shape.
const ROSTER = [
  require('./sentinel'),
  require('./cutter'),
  require('./swarm-mother'),
  require('./turret'),
  require('./leviathan')
]

function byId(id) {
  return ROSTER.find((b) => b.id === id)
}

// Picks the boss for a given wave number. Cycles through the roster in
// order so new entries added to ROSTER slot in automatically; swap this
// for weighted/random selection via `rng` if that's preferred later.
function forWave(wave, rng) {
  if (rng) return rng.pick(ROSTER)
  return ROSTER[(wave - 1) % ROSTER.length]
}

module.exports = { ROSTER, byId, forWave }
