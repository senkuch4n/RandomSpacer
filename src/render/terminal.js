'use strict'

const tty = require('bare-tty')
const items = require('../items')
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
const ASTEROID_COLOR = { large: C.white, medium: C.gray, small: DIM + C.gray }
const PLAYER_SHOT_COLOR = C.brightYellow
const BOSS_SHOT_COLOR = C.brightRed
const BOSS_COLOR = BOLD + C.brightMagenta
const PICKUP_COLOR = C.brightGreen
const RING_COLOR = C.cyan
const BORDER_COLOR = C.cyan

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

class TerminalRenderer {
  constructor() {
    this.out = new tty.WriteStream(1)
  }

  get columns() {
    return this.out.columns
  }

  get rows() {
    return this.out.rows
  }

  arenaSize() {
    const availWidth = Math.max(10, this.columns - PANEL_WIDTH - PANEL_GAP)
    const availHeight = Math.max(5, this.rows - 2)
    return {
      width: Math.min(MAX_ARENA_WIDTH, availWidth),
      height: Math.min(MAX_ARENA_HEIGHT, availHeight)
    }
  }

  onResize(cb) {
    this.out.on('resize', cb)
  }

  start() {
    this.out.write('\x1b[?25l\x1b[2J')
  }

  stop() {
    // Flush the cursor-restore sequence before destroying the stream — an
    // open bare-tty WriteStream keeps the event loop alive, so without an
    // explicit destroy the process (and the terminal) never gets control
    // back after the game exits.
    this.out.end('\x1b[?25h\x1b[2J\x1b[H', () => this.out.destroy())
  }

  render(world) {
    const cols = this.columns
    const rows = this.rows

    const panel = this._panelLines(world)
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
      }
    }

    if (world.boss) plot(world.boss.pos.x, world.boss.pos.y, colored(BOSS_COLOR, world.boss.symbol))

    const p = world.player
    const blinking = p.invulnerableMs > 0 && Math.floor(p.invulnerableMs / 100) % 2 === 0
    if (p.alive && !blinking) plot(p.pos.x, p.pos.y, colored(SHIP_COLOR, shipGlyph(p.angle)))

    if (world.gameOver) {
      const msg = ` GAME OVER — puntaje: ${world.player.score} — Q para salir `
      const row = arenaTop + 1 + Math.floor(arenaH / 2)
      const col = arenaLeft + 1 + Math.max(0, Math.floor((arenaW - msg.length) / 2))
      if (row >= 0 && row < rows) {
        const colored_ = colored(BOLD + C.brightRed, msg)
        for (let i = 0; i < msg.length; i++) {
          const c = col + i
          if (c >= 0 && c < cols) grid[row][c] = i === 0 ? colored_ : ''
        }
      }
    }

    this.out.write('\x1b[H' + grid.map((row) => row.join('')).join('\r\n'))
  }

  _panelLines(world) {
    const inner = PANEL_WIDTH - 2
    const p = world.player
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
    push(pad(`Score   ${p.score}`, inner), C.brightYellow)
    push(pad(`Ola     ${world.wave}`, inner), C.brightCyan)
    push(pad('', inner), null)
    push(pad('Arma', inner), C.white)
    push(pad(` ${weaponDef.name}`, inner), C.brightYellow)
    push(pad(` Municion: ${ammo}`, inner), DIM + C.brightYellow)

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
      push(pad(`Jefe: ${world.boss.name}`, inner), BOLD + C.brightMagenta)
      push(pad(`[${'█'.repeat(pct)}${'░'.repeat(12 - pct)}]`, inner), C.brightRed)
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
