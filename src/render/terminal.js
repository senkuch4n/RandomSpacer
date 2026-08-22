'use strict'

const tty = require('bare-tty')
const items = require('../items')
const experienceApi = require('../game/experience')
const pkg = require('../../package.json')

// Top block: two info lines + separator. One more row below the arena is
// reserved for the experience bar.
const HUD_ROWS = 3
const XP_BAR_ROWS = 1
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
    const availWidth = Math.max(10, this.columns)
    const availHeight = Math.max(5, this.rows - HUD_ROWS - XP_BAR_ROWS)
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
    } else {
      for (let i = 0; i < menu.items.length; i++) {
        const item = menu.items[i]
        const isSelected = i === menu.selected
        const pointer = isSelected && blinkOn ? '▶ ' : '  '
        push(pointer + item.label, isSelected ? BOLD + C.brightYellow : C.white)
      }
      push('', null)
      pushCentered('W/S mover · Espacio elegir · Q salir', DIM + C.gray)
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

    for (let r = 0; r < lines.length && top + r < rows; r++) {
      const { text, color } = lines[r]
      for (let c = 0; c < text.length && left + c < cols; c++) {
        grid[top + r][left + c] = color ? colored(color, text[c]) : text[c]
      }
    }

    this.out.write('\x1b[H' + grid.map((row) => row.join('')).join('\r\n'))
  }

  render(world) {
    const cols = this.columns
    const totalRows = Math.max(5, this.rows - HUD_ROWS - XP_BAR_ROWS)
    // The simulated arena (world.width/height) is capped smaller than the
    // terminal by arenaSize() — plot against those bounds, but still fill
    // a full-terminal-width grid so leftover content outside the arena is
    // blanked out every frame instead of lingering.
    const arenaW = Math.min(world.width, cols)
    const arenaH = Math.min(world.height, totalRows)

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
    if (p.alive && !blinking) plot(grid, arenaW, arenaH, p.pos.x, p.pos.y, shipGlyph(p.angle))

    const lines = [this._hudLine1(world), this._hudLine2(world), '-'.repeat(cols)]
    for (const row of grid) lines.push(row.join(''))
    lines.push(this._xpBarLine(world, cols))

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

  _xpBarLine(world, cols) {
    const xp = world.experience
    const pct = Math.min(100, Math.floor(experienceApi.percent(xp)))
    const suffix = `] ${pct}% Nv:${xp.level}`
    const inner = Math.max(10, cols - 5 - suffix.length)
    const filled = Math.max(0, Math.min(inner, Math.round((pct / 100) * inner)))
    return `EXP [${'#'.repeat(filled)}${'.'.repeat(inner - filled)}${suffix}`.padEnd(cols)
  }
}

module.exports = { TerminalRenderer, shipGlyph }
