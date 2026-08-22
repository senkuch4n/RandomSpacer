'use strict'

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
      { id: 'credits', label: 'Créditos', screen: 'credits' },
      { id: 'quit', label: 'Salir' }
    ],
    selected: 0,
    _prevUp: false,
    _prevDown: false,
    _prevConfirm: false,

    // Returns 'play' or 'quit' when the player confirms that action,
    // otherwise null (including while just browsing a sub-screen like
    // Controles/Créditos).
    update(input) {
      const upEdge = input.up && !this._prevUp
      const downEdge = input.down && !this._prevDown
      const confirmEdge = input.fire && !this._prevConfirm
      this._prevUp = input.up
      this._prevDown = input.down
      this._prevConfirm = input.fire

      if (this.screen !== 'main') {
        if (confirmEdge) this.screen = 'main'
        return null
      }

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
