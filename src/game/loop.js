'use strict'

const { World } = require('./world')
const { TerminalRenderer } = require('../render/terminal')
const { InputManager } = require('../render/input')
const { createMenu } = require('./menu')

const TICK_MS = 40 // 25 fps — plenty for an ASCII arena, cheap to redraw

// Wires the World simulation to a terminal renderer + raw keyboard input
// and drives it on a fixed-ish tick. Starts on a title menu (reusing the
// same renderer/input instances) and only creates the World once the
// player picks "Jugar". Returns a small controller so the caller
// (bin.mjs) can push status text (e.g. OTA updater events) into the HUD
// and stop the game cleanly on exit.
function startGame({ rng, onExit }) {
  const renderer = new TerminalRenderer()
  const input = new InputManager()

  let timer = null
  let stopped = false
  let pendingStatus = null

  function stop(code) {
    if (stopped) return
    stopped = true
    if (timer) clearInterval(timer)
    input.stop()
    renderer.stop()
    if (onExit) onExit(code)
  }

  const controller = {
    setStatus: (message) => {
      pendingStatus = message
    },
    stop
  }

  input.onQuit = () => stop(0)
  renderer.start()
  input.start()

  function runMenu() {
    const menu = createMenu()
    let lastTick = Date.now()

    timer = setInterval(() => {
      const now = Date.now()
      lastTick = now

      try {
        const action = menu.update(input.snapshot())
        if (action === 'quit') {
          stop(0)
          return
        }
        if (action === 'play') {
          const difficulty = menu.difficulty.id
          clearInterval(timer)
          input.resetHeld()
          runGame(difficulty)
          return
        }
        renderer.renderMenu(menu)
      } catch (err) {
        stop(1)
        console.error('[menu:error]', err)
      }
    }, TICK_MS)
  }

  function runGame(difficulty) {
    const { width, height } = renderer.arenaSize()
    const world = new World({ rng, width, height, difficulty })
    if (pendingStatus) world.setStatus(pendingStatus)
    controller.setStatus = (message) => world.setStatus(message)

    let lastTick = Date.now()

    renderer.onResize(() => {
      const size = renderer.arenaSize()
      world.resize(size.width, size.height)
    })

    timer = setInterval(() => {
      const now = Date.now()
      const dtMs = Math.min(200, now - lastTick)
      lastTick = now

      // A crash mid-tick must not skip cleanup — raw mode + hidden cursor
      // left on the terminal survives the process, so the shell looks dead
      // until the user blind-types `reset`. Restore the terminal first,
      // then surface the error.
      try {
        world.update(dtMs, input.snapshot())
        renderer.render(world)
      } catch (err) {
        stop(1)
        console.error('[game:error]', err)
      }
    }, TICK_MS)
  }

  runMenu()

  return controller
}

module.exports = { startGame }
