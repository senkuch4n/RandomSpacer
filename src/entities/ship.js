'use strict'

const START_LIVES = 2
const INVULNERABLE_MS_ON_HIT = 1500

function createShip({ x, y }) {
  return {
    kind: 'ship',
    pos: { x, y },
    vel: { x: 0, y: 0 },
    angle: -Math.PI / 2,
    radius: 1,
    thrusting: false,

    lives: START_LIVES,
    maxLives: 5,
    score: 0,
    alive: true,
    invulnerableMs: 0,

    // 'main-shot' is always unlocked. Other weapon ids get added to this
    // set when the player picks up the matching item on the field.
    weapons: new Set(['main-shot']),
    weaponOrder: ['main-shot'],
    currentWeaponIndex: 0,

    // per-item cooldown/ammo bookkeeping, keyed by item id
    cooldowns: Object.create(null),
    ammo: Object.create(null),

    // dedicated ability slot (shockwave), separate from the weapon cycle
    abilities: new Set(),
    abilityCooldowns: Object.create(null)
  }
}

function currentWeaponId(ship) {
  return ship.weaponOrder[ship.currentWeaponIndex]
}

function unlockWeapon(ship, itemId) {
  if (ship.weapons.has(itemId)) return
  ship.weapons.add(itemId)
  ship.weaponOrder.push(itemId)
}

function cycleWeapon(ship, dir = 1) {
  const n = ship.weaponOrder.length
  ship.currentWeaponIndex = (ship.currentWeaponIndex + dir + n) % n
}

function grantLife(ship, amount = 1) {
  ship.lives = Math.min(ship.maxLives, ship.lives + amount)
}

function hit(ship) {
  if (ship.invulnerableMs > 0) return false
  ship.lives -= 1
  ship.invulnerableMs = INVULNERABLE_MS_ON_HIT
  if (ship.lives <= 0) ship.alive = false
  return true
}

module.exports = {
  START_LIVES,
  createShip,
  currentWeaponId,
  unlockWeapon,
  cycleWeapon,
  grantLife,
  hit
}
