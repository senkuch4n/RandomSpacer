'use strict'

const tty = require('bare-tty')
const items = require('../items')
const pkg = require('../../package.json')

// Single-width Unicode arrows read as a ship's facing direction much more
// clearly than plain ASCII slashes, without needing a multi-cell sprite.
const SHIP_GLYPHS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗']

// HUD lives in a fixed-width left column; the arena is centered in
// whatever terminal space remains to its right.
const SIDEBAR_WIDTH = 22
const SIDEBAR_GAP = 2

// The arena is capped well below typical terminal size so weapon ranges
// (tuned in src/entities/bullet.js) are enough to cross it — a maximized
// terminal would otherwise make bullets vanish long before reaching the
// far side.
const MAX_ARENA_WIDTH = 50
const MAX_ARENA_HEIGHT = 24

function shipGlyph(angle) {
  const twoPi = Math.PI * 2
  const normalized = ((angle % twoPi) + twoPi) % twoPi
  const index = Math.round(normalized / (twoPi / 8)) % 8
  return SHIP_GLYPHS[index]
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
    const availWidth = Math.max(10, this.columns - SIDEBAR_WIDTH - SIDEBAR_GAP)
    const availHeight = Math.max(5, this.rows)
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
    const innerWidth = Math.max(1, cols - SIDEBAR_WIDTH - SIDEBAR_GAP)
    // The simulated arena (world.width/height) is capped smaller than the
    // available space by arenaSize() — plot against those bounds, but
    // still fill the full terminal so leftover content is blanked out
    // every frame instead of lingering, and center the arena in the
    // space to the right of the sidebar.
    const arenaW = Math.min(world.width, innerWidth)
    const arenaH = Math.min(world.height, rows)
    const offsetX = SIDEBAR_WIDTH + SIDEBAR_GAP + Math.max(0, Math.floor((innerWidth - arenaW) / 2))
    const offsetY = Math.max(0, Math.floor((rows - arenaH) / 2))

    const grid = new Array(rows)
    for (let r = 0; r < rows; r++) grid[r] = new Array(cols).fill(' ')

    const plot = (x, y, symbol) => {
      const cx = offsetX + Math.max(0, Math.min(arenaW - 1, Math.round(x)))
      const cy = offsetY + Math.max(0, Math.min(arenaH - 1, Math.round(y)))
      if (cy >= 0 && cy < rows && cx >= 0 && cx < cols) grid[cy][cx] = symbol
    }

    const plotRing = (cx0, cy0, radius, symbol) => {
      const steps = Math.max(8, Math.round(radius * 2))
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2
        plot(cx0 + Math.cos(a) * radius, cy0 + Math.sin(a) * radius * 0.6, symbol)
      }
    }

    for (let x = 0; x < arenaW; x++) {
      plot(x, 0, '~')
      plot(x, arenaH - 1, '~')
    }
    for (let y = 0; y < arenaH; y++) {
      plot(0, y, '~')
      plot(arenaW - 1, y, '~')
    }

    for (const a of world.asteroids) plot(a.pos.x, a.pos.y, a.symbol)
    for (const pk of world.pickups) {
      const def = items.byId(pk.itemId)
      plot(pk.pos.x, pk.pos.y, def ? def.symbol : '?')
    }
    for (const proj of world.projectiles) plot(proj.pos.x, proj.pos.y, proj.symbol)

    for (const e of world.effects) {
      if (e.type === 'shockwave-ring') {
        const radius = e.maxRadius * (e.ageMs / e.ttlMs)
        plotRing(e.pos.x, e.pos.y, radius, 'o')
      }
    }

    if (world.boss) plot(world.boss.pos.x, world.boss.pos.y, world.boss.symbol)

    const p = world.player
    const blinking = p.invulnerableMs > 0 && Math.floor(p.invulnerableMs / 100) % 2 === 0
    if (p.alive && !blinking) plot(p.pos.x, p.pos.y, shipGlyph(p.angle))

    const sidebar = this._sidebarLines(world)
    for (let r = 0; r < rows; r++) {
      const text = (sidebar[r] || '').slice(0, SIDEBAR_WIDTH)
      for (let c = 0; c < text.length; c++) grid[r][c] = text[c]
    }

    if (world.gameOver) {
      const msg = ` GAME OVER — puntaje: ${world.player.score} — Q para salir `
      this._overlay(grid, cols, offsetX, offsetY, arenaW, arenaH, msg)
    }

    this.out.write('\x1b[H' + grid.map((row) => row.join('')).join('\r\n'))
  }

  _overlay(grid, cols, offsetX, offsetY, arenaW, arenaH, msg) {
    const row = offsetY + Math.floor(arenaH / 2)
    if (row < 0 || row >= grid.length) return
    const col = offsetX + Math.max(0, Math.floor((arenaW - msg.length) / 2))
    for (let i = 0; i < msg.length; i++) {
      const c = col + i
      if (c >= 0 && c < cols) grid[row][c] = msg[i]
    }
  }

  _sidebarLines(world) {
    const p = world.player
    const weaponId = p.weaponOrder[p.currentWeaponIndex]
    const weaponDef = items.byId(weaponId)
    const ammo = weaponDef.unlimitedAmmo ? '∞' : (p.ammo[weaponId] ?? 0)
    const lives = 'v'.repeat(Math.max(0, p.lives)) || '-'

    const lines = [
      'RandomSpace',
      `v${pkg.version}`,
      '',
      `Vidas:  ${lives}`,
      `Score:  ${p.score}`,
      `Ola:    ${world.wave}`,
      '',
      'Arma:',
      ` ${weaponDef.name}`,
      ` Municion: ${ammo}`
    ]

    const abilityLines = [...p.abilities].map((id) => {
      const def = items.byId(id)
      const a = def.unlimitedAmmo ? '∞' : (p.ammo[id] ?? 0)
      return `${def.name}: ${a}`
    })
    if (abilityLines.length > 0) {
      lines.push('', 'Habilidad:')
      for (const l of abilityLines) lines.push(` ${l}`)
    }

    if (world.boss) {
      const pct = Math.max(0, Math.round((world.boss.hp / world.boss.maxHp) * 10))
      lines.push('', `Jefe: ${world.boss.name}`, `[${'#'.repeat(pct)}${'.'.repeat(10 - pct)}]`)
    }

    lines.push(
      '',
      'Controles:',
      'WASD  mover',
      'Espacio  disparar',
      'E  cambiar arma',
      'X  habilidad',
      'Q  salir'
    )

    if (world.statusMessage) lines.push('', world.statusMessage)

    return lines
  }
}

module.exports = { TerminalRenderer, shipGlyph }
