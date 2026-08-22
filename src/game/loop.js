'use strict'

const os = require('bare-os')
const { World } = require('./world')
const { TerminalRenderer } = require('../render/terminal')
const { InputManager } = require('../render/input')
const { createMenu } = require('./menu')
const leaderboardApi = require('./leaderboard')
const {
  CoopSession,
  generateCode,
  formatCodeForDisplay,
  normalizeCode,
  topicFromCode
} = require('../net/coop')

// Best-effort local player name for leaderboard entries — no separate
// "enter your name" screen, since the OS username is already right there
// and zero-friction. Falls back if userInfo isn't available for some
// reason (shouldn't normally happen under Bare, but a leaderboard entry
// failing to get a name shouldn't be fatal).
function getPlayerName() {
  try {
    const info = os.userInfo()
    if (info && info.username) return info.username
  } catch {}
  return 'Jugador'
}

const TICK_MS = 40 // 25 fps — plenty for an ASCII arena, cheap to redraw
// Hyperswarm has no built-in fallback (TURN-style relay) if direct UDP
// holepunching fails outright — some NAT/firewall combinations just never
// connect. Without a deadline the "buscando" screen hangs forever with no
// feedback, which reads as broken even though it's "just" a network
// issue. Giving up after this long at least tells the player so.
const CONNECT_TIMEOUT_MS = 30000
const DEBUG_SNAPSHOT_TICKS = Math.round(5000 / TICK_MS) // every ~5s while waiting to connect

function armCoopDebug(session, label) {
  session.onDebug = (message) => console.error(`[coop-debug:${label}]`, message)
}

const EMPTY_INPUT = {
  up: false,
  down: false,
  left: false,
  right: false,
  fire: false,
  confirm: false,
  cycleWeapon: false,
  activateAbility: false,
  toggleRanking: false
}

// Wires the World simulation to a terminal renderer + raw keyboard input
// and drives it on a fixed-ish tick. Starts on a title menu (reusing the
// same renderer/input instances) and only creates the World once the
// player picks "Jugar" (or, for "Cooperativo", once a peer is found).
// Returns a small controller so the caller (bin.mjs) can push status text
// (e.g. OTA updater events) into the HUD and stop the game cleanly on
// exit.
function startGame({ rng, onExit, storageDir }) {
  const renderer = new TerminalRenderer()
  const input = new InputManager()
  const playerName = getPlayerName()

  // Local, P2P-gossiped leaderboard (src/game/leaderboard.js) — loaded
  // once and kept in memory rather than re-read from disk on every menu
  // render; refreshed whenever a run ends or a co-op peer sends its own
  // entries to merge in.
  let leaderboardEntries = storageDir ? leaderboardApi.load(storageDir) : []

  function recordScore(world, mode) {
    if (!storageDir) return
    leaderboardEntries = leaderboardApi.addEntry(storageDir, {
      name: playerName,
      score: world.score,
      mode,
      wave: world.wave,
      date: new Date().toISOString().slice(0, 10)
    })
  }

  // Reads leaderboardEntries fresh each call (rather than snapshotting it
  // once) so a co-op peer's gossiped entries — merged in mid-match via
  // wireLeaderboardSync — show up immediately next tick.
  function topEntriesFor(mode, limit) {
    return leaderboardApi.topEntries(leaderboardEntries, mode, limit)
  }

  // Runs once right when a co-op connection is established (not on every
  // restart within it) — trades local leaderboard entries with whoever we
  // just connected to and merges what comes back in, since there's no
  // server to host a shared ranking on otherwise.
  function wireLeaderboardSync(session) {
    session.onLeaderboard = (entries) => {
      if (storageDir) leaderboardEntries = leaderboardApi.mergeIncoming(storageDir, entries)
    }
    if (storageDir) session.sendLeaderboard(leaderboardEntries)
  }

  let timer = null
  let stopped = false
  let pendingStatus = null

  // Re-pointed at whichever World is currently live; while sitting on the
  // menu (including after a "volver al menú" from a game over) there's no
  // World to receive status text, so it's queued and flushed into the
  // next one created.
  let currentSetStatus = (message) => {
    pendingStatus = message
  }

  function stop(code) {
    if (stopped) return
    stopped = true
    if (timer) clearInterval(timer)
    input.stop()
    renderer.stop()
    if (onExit) onExit(code)
  }

  const controller = {
    setStatus: (message) => currentSetStatus(message),
    stop
  }

  input.onQuit = () => stop(0)
  renderer.start()
  input.start()

  function runMenu() {
    currentSetStatus = (message) => {
      pendingStatus = message
    }
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
        if (action === 'coop-auto') {
          const difficulty = menu.difficulty.id
          clearInterval(timer)
          input.resetHeld()
          runCoopSearch(difficulty)
          return
        }
        if (action === 'coop-host') {
          const difficulty = menu.difficulty.id
          clearInterval(timer)
          input.resetHeld()
          runCoopHostCode(difficulty)
          return
        }
        if (action === 'coop-join') {
          const difficulty = menu.difficulty.id
          clearInterval(timer)
          input.resetHeld()
          runCoopJoinCode(difficulty)
          return
        }
        if (menu.screen === 'ranking') {
          renderer.renderRanking(
            menu,
            leaderboardApi.topEntries(leaderboardEntries, menu.rankingMode, 15)
          )
        } else {
          renderer.renderMenu(menu)
        }
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
    currentSetStatus = (message) => world.setStatus(message)

    let lastTick = Date.now()
    let recorded = false // guards against re-recording every tick spent on the game-over screen
    let showRanking = false // R toggles a full-screen ranking view, pausing the sim while it's open

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
        const inp = input.snapshot()
        if (inp.toggleRanking) showRanking = !showRanking

        if (showRanking) {
          renderer.renderRankingOverlay(topEntriesFor('solo', 10), 'solo')
          return
        }

        world.update(dtMs, [inp])
        renderer.render(world, 0, topEntriesFor('solo', 3))

        if (world.gameOver && !recorded) {
          recorded = true
          recordScore(world, 'solo')
        }

        // The World can't tear itself down/rebuild the renderer, so it
        // just records the player's game-over choice — loop.js drives
        // the actual transition back to the menu or into a fresh run.
        if (world.gameOverAction === 'restart') {
          clearInterval(timer)
          input.resetHeld()
          runGame(difficulty)
        } else if (world.gameOverAction === 'menu') {
          clearInterval(timer)
          input.resetHeld()
          runMenu()
        }
      } catch (err) {
        stop(1)
        console.error('[game:error]', err)
      }
    }, TICK_MS)
  }

  // Co-op ("Automático"): joins a public Hyperswarm lobby (see
  // src/net/coop.js) so two players get matched up automatically, with no
  // room code or manual key exchange — that's the "assigned randomly"
  // part. Whichever peer's connection role comes out on top (a
  // deterministic public-key compare both sides make independently) runs
  // the real World and is authoritative; the other just sends its input
  // and renders whatever state it's told. Q always quits the whole app,
  // same as everywhere else, including while still searching. Relies on
  // the DHT actually punching a hole between both players' networks — if
  // that fails (some NAT/firewall setups), "Crear partida"/"Unirse con
  // código" below use the same connection mechanism on a private topic,
  // which at least guarantees the two players are looking for each other
  // specifically rather than depending on who else is in the public lobby.
  function runCoopSearch(difficulty) {
    currentSetStatus = (message) => {
      pendingStatus = message
    }
    const session = new CoopSession()
    armCoopDebug(session, 'auto')
    let settled = false
    let tick = 0
    const startedAt = Date.now()

    const timeoutHandle = setTimeout(() => {
      if (settled) return
      settled = true
      clearInterval(timer)
      console.error('[coop-search:timeout] no peer found within', CONNECT_TIMEOUT_MS, 'ms')
      session.close().catch(() => {})
      pendingStatus = 'No se encontró compañero (revisá tu red/firewall)'
      runMenu()
    }, CONNECT_TIMEOUT_MS)

    session.onConnected = (isHost) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutHandle)
      clearInterval(timer)
      wireLeaderboardSync(session)
      if (isHost) runCoopHost(difficulty, session)
      else runCoopGuest(session)
    }

    timer = setInterval(() => {
      try {
        renderer.renderSearching(null, Date.now() - startedAt)
        tick++
        if (tick % DEBUG_SNAPSHOT_TICKS === 0) {
          console.error('[coop-debug:auto]', session.debugSnapshot())
        }
      } catch (err) {
        stop(1)
        console.error('[coop-search:error]', err)
      }
    }, TICK_MS)

    session.findMatch().catch((err) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutHandle)
      clearInterval(timer)
      console.error('[coop-search:error]', err)
      session.close().catch(() => {})
      pendingStatus = 'No se pudo buscar compañero — reintenta'
      runMenu()
    })
  }

  // Co-op ("Crear partida"): generates a short code and joins a topic
  // derived from it (private, not the public lobby) — sharing that code
  // with the other player (out of band: voice, chat, whatever) is what
  // gets them onto the same topic instead of leaving it to chance.
  function runCoopHostCode(difficulty) {
    currentSetStatus = (message) => {
      pendingStatus = message
    }
    const code = generateCode()
    const session = new CoopSession()
    armCoopDebug(session, 'host-code')
    let settled = false
    let tick = 0
    const startedAt = Date.now()

    const timeoutHandle = setTimeout(() => {
      if (settled) return
      settled = true
      clearInterval(timer)
      console.error('[coop-host-code:timeout] no peer joined within', CONNECT_TIMEOUT_MS, 'ms')
      session.close().catch(() => {})
      pendingStatus = 'Nadie se conectó a ese código (revisá tu red/firewall)'
      runMenu()
    }, CONNECT_TIMEOUT_MS)

    session.onConnected = (isHost) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutHandle)
      clearInterval(timer)
      wireLeaderboardSync(session)
      if (isHost) runCoopHost(difficulty, session)
      else runCoopGuest(session)
    }

    timer = setInterval(() => {
      try {
        renderer.renderSearching(`Código: ${formatCodeForDisplay(code)}`, Date.now() - startedAt)
        tick++
        if (tick % DEBUG_SNAPSHOT_TICKS === 0) {
          console.error('[coop-debug:host-code]', session.debugSnapshot())
        }
      } catch (err) {
        stop(1)
        console.error('[coop-host-code:error]', err)
      }
    }, TICK_MS)

    session.findMatch(topicFromCode(code)).catch((err) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutHandle)
      clearInterval(timer)
      console.error('[coop-host-code:error]', err)
      session.close().catch(() => {})
      pendingStatus = 'No se pudo crear la partida — reintenta'
      runMenu()
    })
  }

  // Co-op ("Unirse con código"): a text-entry screen collects the code
  // the other player shared, then joins the same private topic it maps
  // to. Enter submits, Esc goes back to the menu (both handled here via
  // InputManager's text-capture mode rather than the normal key bindings,
  // so e.g. typing "q" doesn't quit mid-code).
  function runCoopJoinCode(difficulty) {
    currentSetStatus = (message) => {
      pendingStatus = message
    }
    input.startTextInput('')
    let joinError = null
    let settled = false

    input.onTextCancel = () => {
      if (settled) return
      settled = true
      input.stopTextInput()
      clearInterval(timer)
      runMenu()
    }
    input.onTextSubmit = (typed) => {
      if (settled) return
      const code = normalizeCode(typed)
      if (code.length !== 8) {
        joinError = 'El código debe tener 8 caracteres'
        return
      }
      settled = true
      input.stopTextInput()
      clearInterval(timer)
      runCoopJoinConnecting(difficulty, code)
    }

    timer = setInterval(() => {
      try {
        renderer.renderCoopJoin(input.textBuffer, joinError)
      } catch (err) {
        stop(1)
        console.error('[coop-join-code:error]', err)
      }
    }, TICK_MS)
  }

  function runCoopJoinConnecting(difficulty, code) {
    const session = new CoopSession()
    armCoopDebug(session, 'join-code')
    let settled = false
    let tick = 0
    const startedAt = Date.now()

    const timeoutHandle = setTimeout(() => {
      if (settled) return
      settled = true
      clearInterval(timer)
      console.error('[coop-join-connecting:timeout] no host found within', CONNECT_TIMEOUT_MS, 'ms')
      session.close().catch(() => {})
      pendingStatus = 'No se pudo conectar con ese código (revisá tu red/firewall)'
      runMenu()
    }, CONNECT_TIMEOUT_MS)

    session.onConnected = (isHost) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutHandle)
      clearInterval(timer)
      wireLeaderboardSync(session)
      if (isHost) runCoopHost(difficulty, session)
      else runCoopGuest(session)
    }

    timer = setInterval(() => {
      try {
        renderer.renderSearching(`Código: ${formatCodeForDisplay(code)}`, Date.now() - startedAt)
        tick++
        if (tick % DEBUG_SNAPSHOT_TICKS === 0) {
          console.error('[coop-debug:join-code]', session.debugSnapshot())
        }
      } catch (err) {
        stop(1)
        console.error('[coop-join-connecting:error]', err)
      }
    }, TICK_MS)

    session.findMatch(topicFromCode(code)).catch((err) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutHandle)
      clearInterval(timer)
      console.error('[coop-join-connecting:error]', err)
      session.close().catch(() => {})
      pendingStatus = 'No se pudo conectar con ese código'
      runMenu()
    })
  }

  function runCoopHost(difficulty, session) {
    const { width, height } = renderer.arenaSize()
    const world = new World({ rng, width, height, difficulty, playerCount: 2 })
    if (pendingStatus) world.setStatus(pendingStatus)
    currentSetStatus = (message) => world.setStatus(message)

    let remoteInput = EMPTY_INPUT
    session.onInput = (inp) => {
      remoteInput = inp
    }
    session.onDisconnected = () => {
      clearInterval(timer)
      session.close().catch(() => {})
      pendingStatus = 'El compañero se desconectó'
      runMenu()
    }

    let lastTick = Date.now()
    let recorded = false
    let showRanking = false // pressing R here pauses the sim for both peers — see runGame's comment
    renderer.onResize(() => {
      const size = renderer.arenaSize()
      world.resize(size.width, size.height)
    })

    timer = setInterval(() => {
      const now = Date.now()
      const dtMs = Math.min(200, now - lastTick)
      lastTick = now

      try {
        const inp = input.snapshot()
        if (inp.toggleRanking) showRanking = !showRanking

        if (showRanking) {
          renderer.renderRankingOverlay(topEntriesFor('coop', 10), 'coop')
          session.sendState(world.toSnapshot())
          return
        }

        world.update(dtMs, [inp, remoteInput])
        renderer.render(world, 0, topEntriesFor('coop', 3))
        session.sendState(world.toSnapshot())

        if (world.gameOver && !recorded) {
          recorded = true
          recordScore(world, 'coop')
        }

        if (world.gameOverAction === 'restart') {
          clearInterval(timer)
          input.resetHeld()
          runCoopHost(difficulty, session)
        } else if (world.gameOverAction === 'menu') {
          clearInterval(timer)
          input.resetHeld()
          session.close().catch(() => {})
          runMenu()
        }
      } catch (err) {
        stop(1)
        console.error('[coop-host:error]', err)
      }
    }, TICK_MS)
  }

  function runCoopGuest(session) {
    currentSetStatus = (message) => {
      pendingStatus = message
    }

    let latestState = null
    // The guest's runCoopGuest only runs once per connection (unlike
    // runCoopHost, which the host re-enters on every restart) — the host
    // can restart the same session many times, so "just entered game
    // over" has to be detected as an edge on the incoming snapshots
    // rather than a one-shot flag, or only the very first game over of
    // the whole connection would ever get recorded.
    let wasGameOver = false
    let showRanking = false
    session.onState = (worldSnapshot) => {
      latestState = worldSnapshot
    }
    session.onDisconnected = () => {
      clearInterval(timer)
      session.close().catch(() => {})
      pendingStatus = 'El anfitrión se desconectó'
      runMenu()
    }

    timer = setInterval(() => {
      try {
        const inp = input.snapshot()
        if (inp.toggleRanking) showRanking = !showRanking

        // The guest doesn't own the simulation, so opening the ranking
        // here can't pause anything — it just stops sending real movement
        // (an idle ship is still safer than one drifting unattended) and
        // shows a local overlay instead of the host's stream.
        session.sendInput(showRanking ? EMPTY_INPUT : inp)

        if (showRanking) {
          renderer.renderRankingOverlay(topEntriesFor('coop', 10), 'coop')
          return
        }

        if (latestState) {
          renderer.render(latestState, 1, topEntriesFor('coop', 3))
          if (latestState.gameOver && !wasGameOver) recordScore(latestState, 'coop')
          wasGameOver = latestState.gameOver
        }
      } catch (err) {
        stop(1)
        console.error('[coop-guest:error]', err)
      }
    }, TICK_MS)
  }

  runMenu()

  return controller
}

module.exports = { startGame }
