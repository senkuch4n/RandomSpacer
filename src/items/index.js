'use strict'

// Item registry. Same OTA story as src/bosses/index.js: add a module,
// register it here (in WEAPONS, ABILITIES, or as a plain pickup), ship a
// `pear release`, and every installed copy can find it on the field next
// run. See any file in this folder for the shape a new item needs.
const mainShot = require('./main-shot')
const bomb = require('./bomb')
const missile = require('./missile')
const boomerang = require('./boomerang')
const burstFire = require('./burst-fire')
const shockwave = require('./shockwave')
const life = require('./life')

// Weapons cycle through the player's fire key (main-shot is always first
// and always unlocked). Abilities sit on their own activation key.
// `life` is neither — it applies on contact and is never equipped.
const WEAPONS = [mainShot, bomb, missile, boomerang, burstFire]
const ABILITIES = [shockwave]
const ALL = [...WEAPONS, ...ABILITIES, life]

const BY_ID = new Map(ALL.map((item) => [item.id, item]))

// Items that can actually appear as pickups on the field (everything
// except the starting main-shot).
const FIELD_POOL = ALL.filter((item) => item.fieldPickup)

function byId(id) {
  return BY_ID.get(id)
}

module.exports = { WEAPONS, ABILITIES, ALL, FIELD_POOL, byId }
