'use strict'

const { grantLife } = require('../entities/ship')

// Pure pickup: not a weapon or ability, just heals on touch. Never enters
// the weapon cycle or a cooldown/ammo slot.
module.exports = {
  id: 'life',
  name: 'Vida extra',
  symbol: '+',
  type: 'pickup',
  fieldPickup: true,

  onPickup({ player }) {
    grantLife(player, 1)
  }
}
