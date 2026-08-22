'use strict'

const difficultyApi = require('./difficulty')

// A tiny state machine for the title screen. Navigation is edge-triggered
// (compares this tick's held-state against last tick's) rather than using
// the raw held-state directly, since holding W/S for gameplay movement
// would otherwise blow through every menu item in a single frame.
function createMenu() {
  return {
    screen: 'main',
    items: [
      { id: 'play', label: 'Jugar' },
      { id: 'controls', label: 'Controles', screen: 'controls' },
      { id: 'quit', label: 'Salir' }
    ],
    selected: 0,
    difficultyIndex: difficultyApi.DEFAULT_INDEX,
    _prevUp: false,
    _prevDown: false,
    _prevLeft: false,
    _prevRight: false,
    _prevConfirm: false,

    get difficulty() {
      return difficultyApi.LEVELS[this.difficultyIndex]
    },

    // Returns 'play' or 'quit' when the player confirms that action,
    // otherwise null (including while just browsing a sub-screen like
    // Controles). Credits are shown as a permanent footer on the main
    // screen instead of a sub-screen — see terminal.js renderMenu.
    update(input) {
      const upEdge = input.up && !this._prevUp
      const downEdge = input.down && !this._prevDown
      const leftEdge = input.left && !this._prevLeft
      const rightEdge = input.right && !this._prevRight
      const confirmEdge = input.fire && !this._prevConfirm
      this._prevUp = input.up
      this._prevDown = input.down
      this._prevLeft = input.left
      this._prevRight = input.right
      this._prevConfirm = input.fire

      if (this.screen !== 'main') {
        if (confirmEdge) this.screen = 'main'
        return null
      }

      // Left/right cycle difficulty independently of which item is
      // highlighted, so it isn't just another entry in the up/down list.
      const dCount = difficultyApi.LEVELS.length
      if (leftEdge) this.difficultyIndex = (this.difficultyIndex - 1 + dCount) % dCount
      if (rightEdge) this.difficultyIndex = (this.difficultyIndex + 1) % dCount

      const n = this.items.length
      if (upEdge) this.selected = (this.selected - 1 + n) % n
      if (downEdge) this.selected = (this.selected + 1) % n

      if (confirmEdge) {
        const item = this.items[this.selected]
        if (item.screen) {
          this.screen = item.screen
          return null
        }
        return item.id
      }

      return null
    }
  }
}

module.exports = { createMenu }
