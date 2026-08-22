'use strict'

const { World } = require('./world')
const { TerminalRenderer } = require('../render/terminal')
const { InputManager } = require('../render/input')

const TICK_MS = 40 // 25 fps — plenty for an ASCII arena, cheap to redraw

// Wires the World simulation to a terminal renderer + raw keyboard input
// and drives it on a fixed-ish tick. Returns a small controller so the
// caller (bin.mjs) can push status text (e.g. OTA updater events) into
// the HUD and stop the game cleanly on exit.
function startGame({ rng, onExit }) {
  const renderer = new TerminalRenderer()
  const input = new InputManager()
  const { width, height } = renderer.arenaSize()
  const world = new World({ rng, width, height })

  let timer = null
  let lastTick = Date.now()
  let stopped = false

  function stop(code) {
    if (stopped) return
    stopped = true
    if (timer) clearInterval(timer)
    input.stop()
    renderer.stop()
    if (onExit) onExit(code)
  }

  input.onQuit = () => stop(0)

  renderer.onResize(() => {
    const size = renderer.arenaSize()
    world.resize(size.width, size.height)
  })

  renderer.start()
  input.start()

  timer = setInterval(() => {
    const now = Date.now()
    const dtMs = Math.min(200, now - lastTick)
    lastTick = now

    world.update(dtMs, input.snapshot())
    renderer.render(world)
  }, TICK_MS)

  return {
    setStatus: (message) => world.setStatus(message),
    stop
  }
}

module.exports = { startGame }
