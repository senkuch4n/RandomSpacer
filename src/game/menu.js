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
      { id: 'coop', label: 'Cooperativo', screen: 'coop' },
      { id: 'ranking', label: 'Ranking', screen: 'ranking' },
      { id: 'controls', label: 'Controles', screen: 'controls' },
      { id: 'quit', label: 'Salir' }
    ],
    // The public-lobby "Automático" match relies on Hyperswarm's DHT
    // punching a hole between both players' networks, which doesn't
    // always succeed depending on NAT/firewall setups — "Crear
    // partida"/"Unirse con código" let two players pair deliberately on a
    // private topic instead (same underlying mechanism, just not left to
    // chance who else is in the public lobby).
    coopItems: [
      { id: 'coop-auto', label: 'Automático (aleatorio)' },
      { id: 'coop-host', label: 'Crear partida' },
      { id: 'coop-join', label: 'Unirse con código' }
    ],
    selected: 0,
    coopSelected: 0,
    rankingModeIndex: 0,
    rankingModes: ['all', 'solo', 'coop'],
    difficultyIndex: difficultyApi.DEFAULT_INDEX,
    _prevUp: false,
    _prevDown: false,
    _prevLeft: false,
    _prevRight: false,
    _prevConfirm: false,

    get difficulty() {
      return difficultyApi.LEVELS[this.difficultyIndex]
    },

    get rankingMode() {
      return this.rankingModes[this.rankingModeIndex]
    },

    // Returns 'play', 'quit', or one of coopItems' ids when the player
    // confirms that action, otherwise null (including while just
    // browsing a sub-screen like Controles). Credits are shown as a
    // permanent footer on the main screen instead of a sub-screen — see
    // terminal.js renderMenu.
    update(input) {
      const upEdge = input.up && !this._prevUp
      const downEdge = input.down && !this._prevDown
      const leftEdge = input.left && !this._prevLeft
      const rightEdge = input.right && !this._prevRight
      const confirmHeld = input.fire || input.confirm
      const confirmEdge = confirmHeld && !this._prevConfirm
      this._prevUp = input.up
      this._prevDown = input.down
      this._prevLeft = input.left
      this._prevRight = input.right
      this._prevConfirm = confirmHeld

      if (this.screen === 'coop') {
        const n = this.coopItems.length
        if (upEdge) this.coopSelected = (this.coopSelected - 1 + n) % n
        if (downEdge) this.coopSelected = (this.coopSelected + 1) % n
        if (leftEdge) {
          this.screen = 'main'
          return null
        }
        if (confirmEdge) return this.coopItems[this.coopSelected].id
        return null
      }

      if (this.screen === 'ranking') {
        // Left/right cycle which mode's scores are shown (Todos/Solo/
        // Cooperativo); confirm (not left, since that's taken by the
        // filter) goes back to the main screen.
        const n = this.rankingModes.length
        if (leftEdge) this.rankingModeIndex = (this.rankingModeIndex - 1 + n) % n
        if (rightEdge) this.rankingModeIndex = (this.rankingModeIndex + 1) % n
        if (confirmEdge) this.screen = 'main'
        return null
      }

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
