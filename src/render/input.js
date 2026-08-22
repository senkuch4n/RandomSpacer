'use strict'

const tty = require('bare-tty')

// A raw terminal never reports key-up events, only bytes as they arrive
// (with OS auto-repeat while a key is held). So "is this key held right
// now" is approximated as "did we see it in the last HOLD_TIMEOUT_MS" —
// the standard trick for real-time terminal games. This has to be longer
// than the OS's initial key-repeat delay (commonly 250-500ms before the
// first repeat, then much faster) or movement visibly stutters: the
// window expires and the ship stops turning/thrusting for a beat right
// before the next repeated byte arrives.
const HOLD_TIMEOUT_MS = 400

const ARROW = { A: 'up', B: 'down', C: 'right', D: 'left' }

class InputManager {
  constructor() {
    this.stdin = new tty.ReadStream(0)
    this._lastSeen = Object.create(null)
    this._cyclePresses = 0
    this._quit = false
    this._pendingEscape = ''
    this.onQuit = null
  }

  start() {
    this.stdin.setRawMode(true)
    this.stdin.on('data', (chunk) => this._onData(chunk))
  }

  stop() {
    try {
      this.stdin.setRawMode(false)
    } catch {}
    // An open bare-tty ReadStream keeps the event loop alive on its own,
    // so without destroying it the process (and the terminal) never
    // regains control after the game exits.
    this.stdin.destroy()
  }

  _mark(key) {
    this._lastSeen[key] = Date.now()
  }

  // Clears held-key state on a screen transition (e.g. menu -> game) so
  // the keypress that confirmed the transition doesn't also register as
  // an immediate action (a held-down "fire" from selecting "Jugar" would
  // otherwise fire the ship's weapon the instant the game starts).
  resetHeld() {
    this._lastSeen = Object.create(null)
    this._cyclePresses = 0
  }

  _onData(chunk) {
    const str = chunk.toString('utf8')

    for (let i = 0; i < str.length; i++) {
      const ch = str[i]

      if (this._pendingEscape) {
        this._pendingEscape += ch
        if (this._pendingEscape === '\x1b[') continue
        const dir = ARROW[ch]
        if (dir) this._mark(dir)
        this._pendingEscape = ''
        continue
      }

      if (ch === '\x1b') {
        this._pendingEscape = '\x1b'
        continue
      }

      if (ch === '\x03') {
        // Ctrl+C
        this._quit = true
        if (this.onQuit) this.onQuit()
        continue
      }

      const lower = ch.toLowerCase()
      if (lower === 'q') {
        this._quit = true
        if (this.onQuit) this.onQuit()
      } else if (lower === 'a') this._mark('left')
      else if (lower === 'd') this._mark('right')
      else if (lower === 'w') this._mark('up')
      else if (lower === 's') this._mark('down')
      else if (ch === ' ' || ch === '\r' || ch === '\n') this._mark('fire')
      else if (lower === 'e' || ch === '\t') this._cyclePresses += 1
      else if (lower === 'x') this._mark('ability')
    }
  }

  _held(key) {
    const seen = this._lastSeen[key]
    return seen !== undefined && Date.now() - seen <= HOLD_TIMEOUT_MS
  }

  // Snapshot of the current frame's inputs for World#update. `cycleWeapon`
  // is edge-triggered (once per keypress, drained here) since it has no
  // cooldown of its own to absorb the hold-detection window; everything
  // else is level-triggered and safe to re-check every frame.
  snapshot() {
    const cycleWeapon = this._cyclePresses > 0
    if (cycleWeapon) this._cyclePresses = 0

    return {
      up: this._held('up'),
      down: this._held('down'),
      left: this._held('left'),
      right: this._held('right'),
      fire: this._held('fire'),
      cycleWeapon,
      activateAbility: this._held('ability')
    }
  }

  get quit() {
    return this._quit
  }
}

module.exports = { InputManager }
