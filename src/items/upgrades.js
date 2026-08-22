'use strict'

// Stat-boost pickups that only ever appear in the level-up item choice
// (world.js's _openItemChoice), never as a field pickup — they mutate the
// player's global weapon stats (src/entities/ship.js's `upgrades` field)
// instead of unlocking a new weapon/ability. `type: 'upgrade'` falls
// through world.js's _applyItemToPlayer into the generic onPickup branch,
// so no special-casing was needed there.
//
// Each is capped so the pool can stop offering it once maxed (see
// availableFor) rather than letting stacks run away into degenerate
// values (near-zero cooldowns, etc).
const DAMAGE_STEP = 0.15
const DAMAGE_MAX = 2.2
const RANGE_STEP = 0.2
const RANGE_MAX = 2.2
const CADENCE_STEP = 0.12
const CADENCE_MIN = 0.4 // cooldown floor: 40% of the weapon's base value
const MAX_EXTRA_SHOTS = 3 // 1 base + 3 = 4 bullets at once, the requested cap

const damage = {
  id: 'upgrade-damage',
  name: 'Daño mejorado',
  symbol: '⚔',
  type: 'upgrade',
  fieldPickup: false,

  isAvailable(player) {
    return player.upgrades.damageMul < DAMAGE_MAX
  },
  onPickup({ player }) {
    player.upgrades.damageMul = Math.min(DAMAGE_MAX, player.upgrades.damageMul + DAMAGE_STEP)
  }
}

const range = {
  id: 'upgrade-range',
  name: 'Alcance mejorado',
  symbol: '➤',
  type: 'upgrade',
  fieldPickup: false,

  isAvailable(player) {
    return player.upgrades.rangeMul < RANGE_MAX
  },
  onPickup({ player }) {
    player.upgrades.rangeMul = Math.min(RANGE_MAX, player.upgrades.rangeMul + RANGE_STEP)
  }
}

const cadence = {
  id: 'upgrade-cadence',
  name: 'Cadencia mejorada',
  symbol: '⚡',
  type: 'upgrade',
  fieldPickup: false,

  isAvailable(player) {
    return player.upgrades.cadenceMul > CADENCE_MIN
  },
  onPickup({ player }) {
    player.upgrades.cadenceMul = Math.max(CADENCE_MIN, player.upgrades.cadenceMul - CADENCE_STEP)
  }
}

const multishot = {
  id: 'upgrade-multishot',
  name: 'Multidisparo',
  symbol: '≡',
  type: 'upgrade',
  fieldPickup: false,

  isAvailable(player) {
    return player.upgrades.extraShots < MAX_EXTRA_SHOTS
  },
  onPickup({ player }) {
    player.upgrades.extraShots = Math.min(MAX_EXTRA_SHOTS, player.upgrades.extraShots + 1)
  }
}

const ALL = [damage, range, cadence, multishot]

function availableFor(player) {
  return ALL.filter((u) => u.isAvailable(player))
}

module.exports = { ALL, availableFor, MAX_EXTRA_SHOTS }
