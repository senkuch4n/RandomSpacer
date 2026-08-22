'use strict'

const tty = require('bare-tty')
const items = require('../items')
const experienceApi = require('../game/experience')
const pkg = require('../../package.json')

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const C = {
  cyan: '\x1b[36m',
  brightCyan: '\x1b[96m',
  yellow: '\x1b[33m',
  brightYellow: '\x1b[93m',
  red: '\x1b[31m',
  brightRed: '\x1b[91m',
  brightMagenta: '\x1b[95m',
  brightGreen: '\x1b[92m',
  white: '\x1b[37m',
  gray: '\x1b[90m'
}

function colored(code, text) {
  return `${code}${text}${RESET}`
}

// Single-width Unicode arrows read as a ship's facing direction much more
// clearly than plain ASCII slashes, without needing a multi-cell sprite.
const SHIP_GLYPHS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗']
const SHIP_COLOR = BOLD + C.brightCyan
const PARTNER_SHIP_COLOR = BOLD + C.brightMagenta
const ASTEROID_COLOR = { large: C.white, medium: C.gray, small: DIM + C.gray }
const PLAYER_SHOT_COLOR = C.brightYellow
const BOSS_SHOT_COLOR = C.brightRed
const BOSS_COLOR = BOLD + C.brightMagenta
// Each boss gets its own identity color (ship glyph, HUD name/HP bar,
// intro banner, death burst) so they read as distinct threats rather
// than palette-swapped copies of the same enemy.
const BOSS_COLORS = {
  sentinel: BOLD + C.brightCyan,
  cutter: BOLD + C.brightRed,
  'swarm-mother': BOLD + C.brightGreen,
  turret: BOLD + C.brightYellow,
  leviathan: BOLD + C.brightMagenta
}
const PICKUP_COLOR = C.brightGreen
const RING_COLOR = C.cyan
const BORDER_COLOR = C.cyan
const DIFFICULTY_COLORS = { easy: C.brightGreen, normal: C.brightCyan, hard: C.brightRed }
// Same semantics as DIFFICULTY_COLORS, reused for the item-choice modal's
// per-type row colors (weapon/ability/plain pickup).
const ITEM_TYPE_COLORS = { weapon: C.brightYellow, ability: C.brightGreen, pickup: C.brightRed }
// Modal title per pick reason (world.js tags each item choice with why it
// was offered); level-up is the fallback for any unknown reason.
const ITEM_CHOICE_TITLES = {
  'level-up': { text: '¡SUBISTE DE NIVEL!', color: BOLD + C.brightGreen },
  'boss-kill': { text: '¡JEFE DERROTADO!', color: BOLD + C.brightMagenta }
}

function bossColor(boss) {
  return (boss && BOSS_COLORS[boss.defId]) || BOSS_COLOR
}

// Small pixel-block silhouettes in the classic Space Invaders vein — each
// boss gets its own alien/UFO shape instead of a single glyph. Only one
// boss is ever on screen at a time, so there's room for a multi-cell
// sprite without crowding the arena. Every row within a sprite must be
// the same length; a space is a transparent (unplotted) pixel.
const BOSS_SPRITES = {
  sentinel: [' ▄█▄ ', '▀███▀', '▀▄ ▄▀'],
  cutter: ['▀▄▄▄▄▄▀', ' █▀▀▀█ ', '▄▀   ▀▄'],
  'swarm-mother': ['▄▄▄███▄▄▄', '█▀▀▀▀▀▀▀█', '▀▄▀   ▀▄▀'],
  turret: ['  ▄█▄  ', ' █████ ', '▀▀ █ ▀▀'],
  leviathan: ['  ▄▄▄▄▄  ', ' █▀▀▀▀▀█ ', ' █▄▄▄▄▄█ ', '  ▀▀ ▀▀  ']
}

// The HUD lives in a fixed-width boxed panel on the left; the arena is
// centered in whatever terminal space remains to its right. Both panels
// are top-aligned to the same row and the whole (panel + gap + arena)
// block is centered as a single unit, so nothing looks pinned to a
// screen edge on a wide terminal.
const PANEL_WIDTH = 24
const PANEL_GAP = 2

// The arena is capped well below typical terminal size so weapon ranges
// (tuned in src/entities/bullet.js) are enough to cross it — a maximized
// terminal would otherwise make bullets vanish long before reaching the
// far side.
const MAX_ARENA_WIDTH = 64
const MAX_ARENA_HEIGHT = 28

function shipGlyph(angle) {
  const twoPi = Math.PI * 2
  const normalized = ((angle % twoPi) + twoPi) % twoPi
  const index = Math.round(normalized / (twoPi / 8)) % 8
  return SHIP_GLYPHS[index]
}

function pad(text, width) {
  if (text.length >= width) return text.slice(0, width)
  return text + ' '.repeat(width - text.length)
}

function center(text, width) {
  if (text.length >= width) return text.slice(0, width)
  const left = Math.floor((width - text.length) / 2)
  return ' '.repeat(left) + text + ' '.repeat(width - text.length - left)
}

// Real terminal resizes (dragging a window edge) often fire a burst of
// several 'resize' events within a few ms rather than one clean event —
// without debouncing, each one would immediately recompute layout and
// hand render() a different `top`/arena size mid-burst, which looks
// exactly like the whole board jittering up and down. Waiting this long
// after the last event in a burst before actually applying it smooths
// that out; it's imperceptible as an added delay to a human resizing a
// window.
const RESIZE_DEBOUNCE_MS = 80

class TerminalRenderer {
  constructor() {
    this.out = new tty.WriteStream(1)
    // Cached rather than read live from `this.out` on every render() call
    // — snapshotting once per actual resize (below) means a frame's
    // layout can't shift mid-render if the underlying stream's reported
    // size were to change (or be read inconsistently) between the many
    // property reads a single render() does.
    this._columns = this.out.columns
    this._rows = this.out.rows
    this._resizeTimer = null
  }

  get columns() {
    return this._columns
  }

  get rows() {
    return this._rows
  }

  arenaSize() {
    const availWidth = Math.max(10, this.columns - PANEL_WIDTH - PANEL_GAP)
    const availHeight = Math.max(5, this.rows - 2)
    return {
      width: Math.min(MAX_ARENA_WIDTH, availWidth),
      height: Math.min(MAX_ARENA_HEIGHT, availHeight)
    }
  }

  // Only one resize listener is ever needed at a time — clearing first
  // means restarting a run (loop.js re-calling this for a fresh World)
  // doesn't pile up listeners still pointing at discarded World objects.
  onResize(cb) {
    this.out.removeAllListeners('resize')
    this.out.on('resize', () => {
      clearTimeout(this._resizeTimer)
      this._resizeTimer = setTimeout(() => {
        this._columns = this.out.columns
        this._rows = this.out.rows
        cb()
      }, RESIZE_DEBOUNCE_MS)
    })
  }

  start() {
    this.out.write('\x1b[?25l\x1b[2J')
  }

  stop() {
    clearTimeout(this._resizeTimer)
    // Flush the cursor-restore sequence before destroying the stream — an
    // open bare-tty WriteStream keeps the event loop alive, so without an
    // explicit destroy the process (and the terminal) never gets control
    // back after the game exits.
    this.out.end('\x1b[?25h\x1b[2J\x1b[H', () => this.out.destroy())
  }

  // Shown while src/net/coop.js is joining the Hyperswarm lobby and
  // waiting for a peer. `status` is a short line under the animated
  // "buscando" text (e.g. connection state, a code to share, or an error
  // to show before falling back to the menu). `elapsedMs` (time since the
  // search started, tracked by loop.js) renders as a running mm:ss timer
  // so a long wait is visibly still counting instead of looking frozen —
  // there's no way to tell "slow" from "stuck" otherwise.
  renderSearching(status, elapsedMs) {
    const cols = this.columns
    const rows = this.rows
    const width = Math.min(46, Math.max(30, cols - 4))
    const inner = width - 2
    const dots = '.'.repeat(Math.floor(Date.now() / 400) % 4)

    const body = []
    const push = (text, color) => body.push({ text: pad(text, inner), color })
    const pushCentered = (text, color) => body.push({ text: center(text, inner), color })

    pushCentered('✦ RANDOMSPACE ✦', BOLD + C.brightCyan)
    push('', null)
    pushCentered('Cooperativo', BOLD + C.brightMagenta)
    pushCentered(`Buscando compañero${dots}`, C.brightCyan)
    if (typeof elapsedMs === 'number') {
      const totalSec = Math.max(0, Math.floor(elapsedMs / 1000))
      const mm = String(Math.floor(totalSec / 60)).padStart(2, '0')
      const ss = String(totalSec % 60).padStart(2, '0')
      pushCentered(`${mm}:${ss}`, DIM + C.gray)
    }
    if (status) {
      push('', null)
      pushCentered(status, BOLD + C.brightYellow)
    }
    push('', null)
    pushCentered('Q para cancelar', DIM + C.gray)

    const lines = [{ text: '┌' + '─'.repeat(inner) + '┐', color: BORDER_COLOR }]
    for (const { text, color } of body) {
      lines.push({ text: '│' + text + '│', color: color || BORDER_COLOR })
    }
    lines.push({ text: '└' + '─'.repeat(inner) + '┘', color: BORDER_COLOR })

    const top = Math.max(0, Math.floor((rows - lines.length) / 2))
    const left = Math.max(0, Math.floor((cols - width) / 2))
    const grid = new Array(rows)
    for (let r = 0; r < rows; r++) grid[r] = new Array(cols).fill(' ')
    for (let r = 0; r < lines.length && top + r < rows; r++) {
      const { text, color } = lines[r]
      for (let c = 0; c < text.length && left + c < cols; c++) {
        grid[top + r][left + c] = color ? colored(color, text[c]) : text[c]
      }
    }

    this.out.write('\x1b[H' + grid.map((row) => row.join('')).join('\r\n'))
  }

  // The "Unirse con código" text-entry screen. `typed` is
  // InputManager#textBuffer; `error` is an optional one-line validation
  // message (e.g. wrong length) shown in place of the hint.
  renderCoopJoin(typed, error) {
    const cols = this.columns
    const rows = this.rows
    const width = Math.min(46, Math.max(30, cols - 4))
    const inner = width - 2
    const cursorOn = Math.floor(Date.now() / 400) % 2 === 0

    const body = []
    const push = (text, color) => body.push({ text: pad(text, inner), color })
    const pushCentered = (text, color) => body.push({ text: center(text, inner), color })

    pushCentered('✦ RANDOMSPACE ✦', BOLD + C.brightCyan)
    push('', null)
    pushCentered('Unirse con código', BOLD + C.brightMagenta)
    push('', null)
    const shown = (typed.toUpperCase() + (cursorOn ? '_' : ' ')).padEnd(9)
    pushCentered(shown, BOLD + C.brightYellow)
    push('', null)
    if (error) {
      pushCentered(error, BOLD + C.brightRed)
    } else {
      pushCentered('Enter confirma · Backspace borra', DIM + C.gray)
    }
    pushCentered('Esc cancela', DIM + C.gray)

    const lines = [{ text: '┌' + '─'.repeat(inner) + '┐', color: BORDER_COLOR }]
    for (const { text, color } of body) {
      lines.push({ text: '│' + text + '│', color: color || BORDER_COLOR })
    }
    lines.push({ text: '└' + '─'.repeat(inner) + '┘', color: BORDER_COLOR })

    const top = Math.max(0, Math.floor((rows - lines.length) / 2))
    const left = Math.max(0, Math.floor((cols - width) / 2))
    const grid = new Array(rows)
    for (let r = 0; r < rows; r++) grid[r] = new Array(cols).fill(' ')
    for (let r = 0; r < lines.length && top + r < rows; r++) {
      const { text, color } = lines[r]
      for (let c = 0; c < text.length && left + c < cols; c++) {
        grid[top + r][left + c] = color ? colored(color, text[c]) : text[c]
      }
    }

    this.out.write('\x1b[H' + grid.map((row) => row.join('')).join('\r\n'))
  }

  renderMenu(menu) {
    const cols = this.columns
    const rows = this.rows
    const width = Math.min(50, Math.max(30, cols - 4))
    const inner = width - 2
    const blinkOn = Math.floor(Date.now() / 400) % 2 === 0

    const body = []
    const push = (text, color) => body.push({ text: pad(text, inner), color })
    const pushCentered = (text, color) => body.push({ text: center(text, inner), color })

    pushCentered('✦ RANDOMSPACE ✦', BOLD + C.brightCyan)
    pushCentered(`v${pkg.version}`, DIM + C.gray)
    push('', null)

    if (menu.screen === 'controls') {
      push(' Controles', BOLD + C.white)
      push('', null)
      push('  WASD     mover', DIM + C.gray)
      push('  Espacio  disparar', DIM + C.gray)
      push('  E        cambiar arma', DIM + C.gray)
      push('  X        habilidad', DIM + C.gray)
      push('  Q        salir', DIM + C.gray)
      push('', null)
      pushCentered('Espacio para volver', C.brightCyan)
    } else if (menu.screen === 'coop') {
      pushCentered('Cooperativo', BOLD + C.brightMagenta)
      push('', null)
      for (let i = 0; i < menu.coopItems.length; i++) {
        const item = menu.coopItems[i]
        const isSelected = i === menu.coopSelected
        const pointer = isSelected && blinkOn ? '▶ ' : '  '
        push(pointer + item.label, isSelected ? BOLD + C.brightYellow : C.white)
      }
      push('', null)
      pushCentered('W/S elegir · Espacio confirma', DIM + C.gray)
      pushCentered('A volver', DIM + C.gray)
    } else {
      for (let i = 0; i < menu.items.length; i++) {
        const item = menu.items[i]
        const isSelected = i === menu.selected
        const pointer = isSelected && blinkOn ? '▶ ' : '  '
        push(pointer + item.label, isSelected ? BOLD + C.brightYellow : C.white)
      }
      push('', null)
      const diffColor = DIFFICULTY_COLORS[menu.difficulty.id] || C.white
      pushCentered(`◀ Dificultad: ${menu.difficulty.label} ▶`, diffColor)
      push('', null)
      pushCentered('W/S mover · Espacio elegir · Q salir', DIM + C.gray)
      pushCentered('A/D cambia la dificultad', DIM + C.gray)
      push('', null)
      pushCentered('Aleph Hackathon — Pears Track', DIM + C.brightGreen)
      pushCentered('Joel Serrudo · Lautaro Aponte', DIM + C.gray)
    }

    const lines = [{ text: '┌' + '─'.repeat(inner) + '┐', color: BORDER_COLOR }]
    for (const { text, color } of body) {
      lines.push({ text: '│' + text + '│', color: color || BORDER_COLOR })
    }
    lines.push({ text: '└' + '─'.repeat(inner) + '┘', color: BORDER_COLOR })

    const top = Math.max(0, Math.floor((rows - lines.length) / 2))
    const left = Math.max(0, Math.floor((cols - width) / 2))

    const grid = new Array(rows)
    for (let r = 0; r < rows; r++) grid[r] = new Array(cols).fill(' ')

    // A sparse, slowly-twinkling starfield behind the menu box — purely
    // decorative, so a cheap position hash (not the game's seeded rng)
    // decides which cells are stars, and the current time decides which
    // of those are lit this frame. The box drawn below overwrites
    // whatever stars fall inside it.
    const now = Date.now()
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const hash = (c * 928371 + r * 6151) % 977
        if (hash >= 18) continue
        const phase = Math.floor(now / 500 + hash) % 3
        if (phase === 0) grid[r][c] = colored(DIM + C.gray, '.')
        else if (phase === 1) grid[r][c] = colored(DIM + C.white, '·')
      }
    }

    for (let r = 0; r < lines.length && top + r < rows; r++) {
      const { text, color } = lines[r]
      for (let c = 0; c < text.length && left + c < cols; c++) {
        grid[top + r][left + c] = color ? colored(color, text[c]) : text[c]
      }
    }

    this.out.write('\x1b[H' + grid.map((row) => row.join('')).join('\r\n'))
  }

  // Two-column layout matching gameplay's panel+arena composition instead
  // of a small centered popup: a boxed sidebar on the left (title, mode
  // filters that apply the instant you highlight them, and an explicit
  // "Volver al menú" row) and the ranking table itself in a double-line
  // box on the right, where the arena normally sits.
  renderRanking(menu, entries) {
    const cols = this.columns
    const rows = this.rows
    const inner = PANEL_WIDTH - 2
    const blinkOn = Math.floor(Date.now() / 400) % 2 === 0

    const sidebar = []
    const push = (text, color) => sidebar.push({ text: pad(text, inner), color })

    push(center('RANDOMSPACE', inner), BOLD + C.brightCyan)
    push(center(`v${pkg.version}`, inner), DIM + C.gray)
    push('', null)
    push('Ranking', BOLD + C.brightGreen)
    push('', null)
    for (let i = 0; i < menu.rankingItems.length; i++) {
      const item = menu.rankingItems[i]
      const isSelected = i === menu.rankingSelected
      const pointer = isSelected && blinkOn ? '▶ ' : '  '
      push(pointer + item.label, isSelected ? BOLD + C.brightYellow : C.white)
    }
    push('', null)
    push('W/S elegir', DIM + C.gray)
    push('Espacio confirma', DIM + C.gray)

    const panelLines = [{ text: '┌' + '─'.repeat(inner) + '┐', color: BORDER_COLOR }]
    for (const { text, color } of sidebar) {
      panelLines.push({ text: '│' + text + '│', color: color || BORDER_COLOR })
    }
    panelLines.push({ text: '└' + '─'.repeat(inner) + '┘', color: BORDER_COLOR })

    const boxW = Math.min(50, Math.max(30, cols - PANEL_WIDTH - PANEL_GAP - 2))
    const modeLabels = { all: 'Todos', solo: 'Solo', coop: 'Cooperativo' }
    const tableLines = []
    const tpush = (text, color) => tableLines.push({ text: pad(text, boxW), color })
    const tpushCentered = (text, color) => tableLines.push({ text: center(text, boxW), color })

    tpushCentered(`Ranking — ${modeLabels[menu.rankingMode]}`, BOLD + C.brightCyan)
    tpush('', null)
    if (entries.length === 0) {
      tpushCentered('Sin puntajes todavía', DIM + C.gray)
    } else {
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]
        const rank = String(i + 1).padStart(2, ' ')
        const tag = e.mode === 'coop' ? 'C' : 'S'
        const scoreStr = String(e.score)
        const left = `${rank}. [${tag}] ${e.name} (ola ${e.wave})`
        tpush(pad(left, boxW - scoreStr.length) + scoreStr, i < 3 ? BOLD + C.brightYellow : C.white)
      }
    }

    const boxLines = [{ text: '╔' + '═'.repeat(boxW) + '╗', color: BORDER_COLOR }]
    for (const { text, color } of tableLines) {
      boxLines.push({ text: '║' + text + '║', color: color || BORDER_COLOR })
    }
    boxLines.push({ text: '╚' + '═'.repeat(boxW) + '╝', color: BORDER_COLOR })

    const contentWidth = PANEL_WIDTH + PANEL_GAP + (boxW + 2)
    const contentHeight = Math.max(panelLines.length, boxLines.length)
    const left = Math.max(0, Math.floor((cols - contentWidth) / 2))
    const top = Math.max(0, Math.floor((rows - contentHeight) / 2))

    const grid = new Array(rows)
    for (let r = 0; r < rows; r++) grid[r] = new Array(cols).fill(' ')

    for (let r = 0; r < panelLines.length && top + r < rows; r++) {
      const { text, color } = panelLines[r]
      for (let c = 0; c < text.length && left + c < cols; c++) {
        grid[top + r][left + c] = color ? colored(color, text[c]) : text[c]
      }
    }

    const boxLeft = left + PANEL_WIDTH + PANEL_GAP
    for (let r = 0; r < boxLines.length && top + r < rows; r++) {
      const { text, color } = boxLines[r]
      for (let c = 0; c < text.length && boxLeft + c < cols; c++) {
        grid[top + r][boxLeft + c] = color ? colored(color, text[c]) : text[c]
      }
    }

    this.out.write('\x1b[H' + grid.map((row) => row.join('')).join('\r\n'))
  }

  render(world, localPlayerIndex = 0) {
    const cols = this.columns
    const rows = this.rows

    const panel = this._panelLines(world, localPlayerIndex)
    // The simulated arena (world.width/height) is capped smaller than the
    // terminal by arenaSize() — plot against those bounds, but still fill
    // a full-terminal-width grid so leftover content outside the arena is
    // blanked out every frame instead of lingering.
    const arenaW = Math.min(world.width, Math.max(1, cols - PANEL_WIDTH - PANEL_GAP))
    const arenaH = Math.min(world.height, Math.max(1, rows - 2))

    const contentWidth = PANEL_WIDTH + PANEL_GAP + (arenaW + 2)
    const contentHeight = Math.max(panel.length, arenaH + 2)
    const left = Math.max(0, Math.floor((cols - contentWidth) / 2))
    const top = Math.max(0, Math.floor((rows - contentHeight) / 2))

    const grid = new Array(rows)
    for (let r = 0; r < rows; r++) grid[r] = new Array(cols).fill(' ')

    for (let r = 0; r < panel.length && top + r < rows; r++) {
      const { text, color } = panel[r]
      for (let c = 0; c < text.length && left + c < cols; c++) {
        grid[top + r][left + c] = color ? colored(color, text[c]) : text[c]
      }
    }

    const arenaLeft = left + PANEL_WIDTH + PANEL_GAP
    const arenaTop = top

    const plot = (x, y, cell) => {
      const cx = arenaLeft + 1 + Math.max(0, Math.min(arenaW - 1, Math.round(x)))
      const cy = arenaTop + 1 + Math.max(0, Math.min(arenaH - 1, Math.round(y)))
      if (cy >= 0 && cy < rows && cx >= 0 && cx < cols) grid[cy][cx] = cell
    }

    const plotRing = (cx0, cy0, radius, cell) => {
      const steps = Math.max(8, Math.round(radius * 2))
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2
        plot(cx0 + Math.cos(a) * radius, cy0 + Math.sin(a) * radius * 0.6, cell)
      }
    }

    // Rounds the anchor once, then offsets every pixel by an integer
    // amount — rounding each cell independently would let different
    // pixels of the same sprite round to different columns as the boss
    // drifts by fractional amounts, making it visibly wobble/shear frame
    // to frame instead of moving as one rigid shape.
    const plotSprite = (cx0, cy0, sprite, color) => {
      const baseX = Math.round(cx0)
      const baseY = Math.round(cy0)
      const h = sprite.length
      const w = sprite[0].length
      const offRow = -Math.floor(h / 2)
      const offCol = -Math.floor(w / 2)
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          const ch = sprite[r][c]
          if (ch === ' ') continue
          plot(baseX + offCol + c, baseY + offRow + r, colored(color, ch))
        }
      }
    }

    // Arena frame, double-line box for a "screen within the screen" feel.
    if (arenaTop >= 0 && arenaTop < rows && arenaLeft >= 0) {
      const top_ = '╔' + '═'.repeat(arenaW) + '╗'
      for (let c = 0; c < top_.length && arenaLeft + c < cols; c++) {
        if (arenaTop < rows) grid[arenaTop][arenaLeft + c] = colored(BORDER_COLOR, top_[c])
      }
      const bottomRow = arenaTop + arenaH + 1
      if (bottomRow < rows) {
        const bot = '╚' + '═'.repeat(arenaW) + '╝'
        for (let c = 0; c < bot.length && arenaLeft + c < cols; c++) {
          grid[bottomRow][arenaLeft + c] = colored(BORDER_COLOR, bot[c])
        }
      }
      for (let y = 0; y < arenaH; y++) {
        const r = arenaTop + 1 + y
        if (r < 0 || r >= rows) continue
        if (arenaLeft < cols) grid[r][arenaLeft] = colored(BORDER_COLOR, '║')
        if (arenaLeft + arenaW + 1 < cols) {
          grid[r][arenaLeft + arenaW + 1] = colored(BORDER_COLOR, '║')
        }
      }
    }

    for (const a of world.asteroids) {
      plot(a.pos.x, a.pos.y, colored(ASTEROID_COLOR[a.tier] || C.white, a.symbol))
    }
    for (const pk of world.pickups) {
      const def = items.byId(pk.itemId)
      plot(pk.pos.x, pk.pos.y, colored(PICKUP_COLOR, def ? def.symbol : '?'))
    }
    for (const proj of world.projectiles) {
      const color = proj.owner === 'boss' ? BOSS_SHOT_COLOR : PLAYER_SHOT_COLOR
      plot(proj.pos.x, proj.pos.y, colored(color, proj.symbol))
    }

    for (const e of world.effects) {
      if (e.type === 'shockwave-ring') {
        const radius = e.maxRadius * (e.ageMs / e.ttlMs)
        plotRing(e.pos.x, e.pos.y, radius, colored(RING_COLOR, 'o'))
      } else if (e.type === 'boss-explosion') {
        // A quick burst of two expanding rings (not one, so it reads as an
        // explosion rather than a slow-moving circle like the shockwave).
        const t = e.ageMs / e.ttlMs
        const color = bossColor({ defId: e.defId })
        plotRing(e.pos.x, e.pos.y, e.maxRadius * t, colored(color, '*'))
        plotRing(e.pos.x, e.pos.y, e.maxRadius * t * 0.5, colored(BOLD + C.white, '*'))
      }
    }

    if (world.boss) {
      const sprite = BOSS_SPRITES[world.boss.defId]
      if (sprite) {
        plotSprite(world.boss.pos.x, world.boss.pos.y, sprite, bossColor(world.boss))
      } else {
        plot(world.boss.pos.x, world.boss.pos.y, colored(bossColor(world.boss), world.boss.symbol))
      }
    }

    // In co-op both ships render; the local viewer's own ship keeps the
    // usual cyan, a partner ship on another peer's screen shows magenta so
    // the two are never ambiguous.
    for (let i = 0; i < world.players.length; i++) {
      const p = world.players[i]
      const blinking = p.invulnerableMs > 0 && Math.floor(p.invulnerableMs / 100) % 2 === 0
      if (p.alive && !blinking) {
        const color = i === localPlayerIndex ? SHIP_COLOR : PARTNER_SHIP_COLOR
        plot(p.pos.x, p.pos.y, colored(color, shipGlyph(p.angle)))
      }
    }

    // Writes `msg` as a single grid cell (the rest of its cells are left
    // empty, not overwritten) so a multi-character ANSI-colored string
    // survives the per-cell `row.join('')` at the end without being torn
    // apart the way slicing an already-colored string would (see the
    // per-character coloring above for why that matters).
    const plotBanner = (rowOffset, msg, color) => {
      const row = arenaTop + 1 + rowOffset
      const col = arenaLeft + 1 + Math.max(0, Math.floor((arenaW - msg.length) / 2))
      if (row < 0 || row >= rows) return
      const wrapped = colored(color, msg)
      for (let i = 0; i < msg.length; i++) {
        const c = col + i
        if (c >= 0 && c < cols) grid[row][c] = i === 0 ? wrapped : ''
      }
    }

    if (world.bossIntroMs > 0 && world.boss) {
      const blinkFast = Math.floor(world.bossIntroMs / 250) % 2 === 0
      plotBanner(Math.floor(arenaH / 2) - 1, `¡JEFE!`, BOLD + bossColor(world.boss))
      if (blinkFast) {
        plotBanner(Math.floor(arenaH / 2) + 1, world.boss.name.toUpperCase(), bossColor(world.boss))
      }
    }

    if (world.levelUpMs > 0) {
      const blinkFast = Math.floor(world.levelUpMs / 200) % 2 === 0
      if (blinkFast) {
        plotBanner(2, `¡NIVEL ${world.experience.level}!`, BOLD + C.brightGreen)
      }
    }

    // Both the item-choice and game-over screens are boxed modals drawn
    // centered over the (frozen) arena — same blit logic, different
    // content, so it's factored out rather than duplicated per modal.
    const blitModal = (lines) => {
      const modalTop = arenaTop + 1 + Math.max(0, Math.floor((arenaH - lines.length) / 2))
      const modalWidth = lines[0].text.length
      const modalLeft = arenaLeft + 1 + Math.max(0, Math.floor((arenaW - modalWidth) / 2))
      for (let r = 0; r < lines.length && modalTop + r < rows; r++) {
        const { text, color } = lines[r]
        for (let c = 0; c < text.length && modalLeft + c < cols; c++) {
          grid[modalTop + r][modalLeft + c] = color ? colored(color, text[c]) : text[c]
        }
      }
    }

    if (world.itemChoice) blitModal(this._itemChoiceLines(world.itemChoice))
    if (world.gameOver) blitModal(this._gameOverLines(world))

    this.out.write('\x1b[H' + grid.map((row) => row.join('')).join('\r\n'))
  }

  _gameOverLines(world) {
    const width = 28
    const inner = width - 2
    const blinkOn = Math.floor(Date.now() / 400) % 2 === 0
    const choice = world.gameOverChoice

    const body = []
    const push = (text, color) => body.push({ text: pad(text, inner), color })
    const pushCentered = (text, color) => body.push({ text: center(text, inner), color })

    pushCentered('GAME OVER', BOLD + C.brightRed)
    pushCentered(`Puntaje: ${world.score}`, C.brightYellow)
    push('', null)
    if (choice) {
      for (let i = 0; i < choice.options.length; i++) {
        const opt = choice.options[i]
        const isSelected = i === choice.selected
        const pointer = isSelected && blinkOn ? '▶ ' : '  '
        push(pointer + opt.label, isSelected ? BOLD + C.brightYellow : C.white)
      }
      push('', null)
      pushCentered('W/S elegir · Espacio', DIM + C.gray)
    }

    const lines = [{ text: '┌' + '─'.repeat(inner) + '┐', color: BORDER_COLOR }]
    for (const { text, color } of body) {
      lines.push({ text: '│' + text + '│', color: color || BORDER_COLOR })
    }
    lines.push({ text: '└' + '─'.repeat(inner) + '┘', color: BORDER_COLOR })
    return lines
  }

  // A pause-and-pick modal drawn over the (frozen) arena, in the same
  // boxed style as the sidebar/menu — every ITEM_CHOICE_LEVEL_INTERVAL
  // levels in world.js.
  _itemChoiceLines(choice) {
    const width = 28
    const inner = width - 2
    const blinkOn = Math.floor(Date.now() / 400) % 2 === 0

    const body = []
    const push = (text, color) => body.push({ text: pad(text, inner), color })
    const pushCentered = (text, color) => body.push({ text: center(text, inner), color })

    const title = ITEM_CHOICE_TITLES[choice.reason] || ITEM_CHOICE_TITLES['level-up']
    pushCentered(title.text, title.color)
    pushCentered('Elegí un objeto', DIM + C.gray)
    push('', null)
    for (let i = 0; i < choice.options.length; i++) {
      const def = choice.options[i]
      const isSelected = i === choice.selected
      const pointer = isSelected && blinkOn ? '▶ ' : '  '
      const label = pad(pointer + def.name, inner - 3) + ' ' + def.symbol
      const color = isSelected ? BOLD + C.brightYellow : ITEM_TYPE_COLORS[def.type] || C.white
      push(label, color)
    }
    push('', null)
    pushCentered('W/S elegir · Enter', DIM + C.gray)

    const lines = [{ text: '┌' + '─'.repeat(inner) + '┐', color: BORDER_COLOR }]
    for (const { text, color } of body) {
      lines.push({ text: '│' + text + '│', color: color || BORDER_COLOR })
    }
    lines.push({ text: '└' + '─'.repeat(inner) + '┘', color: BORDER_COLOR })
    return lines
  }

  _panelLines(world, localPlayerIndex = 0) {
    const inner = PANEL_WIDTH - 2
    const p = world.players[localPlayerIndex] || world.player
    const weaponId = p.weaponOrder[p.currentWeaponIndex]
    const weaponDef = items.byId(weaponId)
    const ammo = weaponDef.unlimitedAmmo ? '∞' : (p.ammo[weaponId] ?? 0)
    const hearts = '♥ '.repeat(Math.max(0, p.lives)).trim() || '-'

    const rows = []
    const push = (text, color) => rows.push({ text, color })

    push(center('RANDOMSPACE', inner), BOLD + C.brightCyan)
    push(center(`v${pkg.version}`, inner), DIM + C.gray)
    push(pad('', inner), null)
    push(pad(`Vidas   ${hearts}`, inner), C.brightRed)
    if (world.players.length > 1) {
      const partner = world.players[localPlayerIndex === 0 ? 1 : 0]
      const partnerHearts = partner.alive ? '♥ '.repeat(Math.max(0, partner.lives)).trim() : '✝'
      push(pad(`Compa   ${partnerHearts || '-'}`, inner), C.brightMagenta)
    }
    push(pad(`Score   ${world.score}`, inner), C.brightYellow)
    push(pad(`Ola     ${world.wave}`, inner), C.brightCyan)
    push(pad('', inner), null)
    const xpPct = Math.max(
      0,
      Math.min(12, Math.round((experienceApi.percent(world.experience) / 100) * 12))
    )
    push(pad(`Nivel   ${world.experience.level}`, inner), C.brightGreen)
    push(pad(`[${'█'.repeat(xpPct)}${'░'.repeat(12 - xpPct)}]`, inner), C.brightGreen)
    push(pad('', inner), null)
    push(pad('Arma', inner), C.white)
    push(pad(` ${weaponDef.name}`, inner), C.brightYellow)
    push(pad(` Municion: ${ammo}`, inner), DIM + C.brightYellow)
    if (weaponDef.multishotEligible && p.upgrades.extraShots > 0) {
      push(pad(` Balas: ${1 + p.upgrades.extraShots}`, inner), DIM + C.brightYellow)
    }

    const abilityIds = [...p.abilities]
    if (abilityIds.length > 0) {
      push(pad('', inner), null)
      push(pad('Habilidad', inner), C.white)
      for (const id of abilityIds) {
        const def = items.byId(id)
        const a = def.unlimitedAmmo ? '∞' : (p.ammo[id] ?? 0)
        push(pad(` ${def.name}: ${a}`, inner), C.brightGreen)
      }
    }

    if (world.boss) {
      const pct = Math.max(0, Math.round((world.boss.hp / world.boss.maxHp) * 12))
      push(pad('', inner), null)
      push(pad(`Jefe: ${world.boss.name}`, inner), bossColor(world.boss))
      push(pad(`[${'█'.repeat(pct)}${'░'.repeat(12 - pct)}]`, inner), bossColor(world.boss))
    }

    push(pad('', inner), null)
    push(pad('Controles', inner), C.white)
    push(pad(' WASD     mover', inner), DIM + C.gray)
    push(pad(' Espacio  disparar', inner), DIM + C.gray)
    push(pad(' E        cambiar', inner), DIM + C.gray)
    push(pad(' X        habilidad', inner), DIM + C.gray)
    push(pad(' Q        salir', inner), DIM + C.gray)

    if (world.statusMessage) {
      push(pad('', inner), null)
      push(pad(world.statusMessage, inner), C.brightCyan)
    }

    const lines = [{ text: '┌' + '─'.repeat(inner) + '┐', color: BORDER_COLOR }]
    for (const { text, color } of rows) {
      lines.push({ text: '│' + text + '│', color: color || BORDER_COLOR })
    }
    lines.push({ text: '└' + '─'.repeat(inner) + '┘', color: BORDER_COLOR })
    return lines
  }
}

module.exports = { TerminalRenderer, shipGlyph }
