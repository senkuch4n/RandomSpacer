import { command, flag, summary } from 'paparam'
import { persistent } from 'bare-storage'
import process from 'bare-process'
import os from 'bare-os'
import { isWindows } from 'which-runtime'
import path from 'bare-path'
import pkg from './package.json'
import App from './app.js'
import rngModule from './src/engine/rng.js'
import congruentialModule from './src/engine/congruential.js'
import gameLoop from './src/game/loop.js'

const { createRng } = rngModule
const { createCongruential } = congruentialModule
const { startGame } = gameLoop

const appName = pkg.productName || pkg.name
const isDev = path.basename(Bare.argv[0]) === (isWindows ? 'bare.exe' : 'bare')

const cmd = command(
  appName,
  summary(pkg.description),
  flag('--version|-v', 'Print the current version'),
  flag('--storage <dir>', 'custom storage directory'),
  flag('--no-updates', 'disable OTA updates for this run')
)

cmd.parse(Bare.argv.slice(isDev ? 2 : 1))
if (cmd.flags.help) Bare.exit()
if (cmd.flags.version) {
  console.log(`${appName} v${pkg.version}`)
  Bare.exit()
}

const updates = cmd.flags.updates
const storage = cmd.flags.storage || (isDev ? null : path.join(persistent(), appName))
const dir = storage || path.join(os.tmpdir(), 'pear', appName)

console.log(`Updates: ${updates === false ? 'disabled' : 'enabled'}`)

const app = new App({
  dir,
  app: isDev ? null : os.execPath(),
  updates,
  version: pkg.version,
  upgrade: pkg.upgrade,
  name: isWindows ? appName + '.exe' : appName
})

// Once the game starts it owns the terminal (raw input, full-screen ANSI
// redraws), so updater notifications can't go through console.log anymore
// — they'd tear the frame. Route them into the in-game HUD status line
// instead, falling back to console.log for the brief window before the
// game loop is up.
let game = null
const notify = (message) => (game ? game.setStatus(message) : console.log(message))

app.on('message', (message) => notify(message))
app.on('updating', () => notify('[updater] descargando actualizacion'))
app.on('updating-delta', (delta) => notify(`[updater] ${delta}`))
app.on('updated', () => notify('[updater] actualizacion lista, aplicando'))
app.on('update-applied', () => notify('[updater] actualizado, reinicia para ver los cambios'))
app.on('error', (err) => {
  if (game) game.stop()
  console.error('[app:error]', err)
})

// game.stop()'s onExit calls back into shutdown() (the player pressed Q
// in-game), and shutdown() calls game.stop() (a signal arrived) — guard
// against the resulting re-entrant loop so app.exit() only ever runs once.
let shuttingDown = false
async function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  if (game) game.stop()
  await app.exit(code)
}

process.on('SIGHUP', () => shutdown(129))
process.on('SIGINT', () => shutdown(130))
process.on('SIGQUIT', () => shutdown(131))
process.on('SIGTERM', () => shutdown(143))

// A crash anywhere outside the game tick (loop.js guards the tick itself)
// would otherwise kill the process while raw mode + hidden cursor are
// still set on the terminal — the shell looks dead until the user
// blind-types `reset`. Always restore the terminal before going down.
process.on('uncaughtException', (err) => {
  shutdown(1).finally(() => console.error('[fatal]', err))
})
process.on('unhandledRejection', (err) => {
  shutdown(1).finally(() => console.error('[fatal]', err))
})

try {
  await app.ready()

  const rng = createRng({ source: createCongruential() })
  game = startGame({
    rng,
    onExit: (code) => shutdown(code ?? 0),
    storageDir: dir
  })
} catch (err) {
  console.error('[app:error]', err)
  await app.close().finally(() => Bare.exit(1))
}
