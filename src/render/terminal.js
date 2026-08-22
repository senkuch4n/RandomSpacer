'use strict'

const tty = require('bare-tty')
const items = require('../items')
const pkg = require('../../package.json')

const HUD_ROWS = 3
// Single-width Unicode arrows read as a ship's facing direction much more
// clearly than plain ASCII slashes, without needing a multi-cell sprite.
const SHIP_GLYPHS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗']

// The arena is capped well below typical terminal size so weapon ranges
// (tuned in src/entities/bullet.js) are enough to cross it — a maximized
// terminal would otherwise make bullets vanish long before reaching the
// far side.
const MAX_ARENA_WIDTH = 40
const MAX_ARENA_HEIGHT = 20

function shipGlyph(angle) {
  const twoPi = Math.PI * 2
  const normalized = ((angle % twoPi) + twoPi) % twoPi
  const index = Math.round(normalized / (twoPi / 8)) % 8
  return SHIP_GLYPHS[index]
}

function plot(grid, cols, rows, x, y, symbol) {
  const cx = Math.max(0, Math.min(cols - 1, Math.round(x)))
  const cy = Math.max(0, Math.min(rows - 1, Math.round(y)))
  grid[cy][cx] = symbol
}

function plotRing(grid, cols, rows, cx, cy, radius, symbol) {
  const steps = Math.max(8, Math.round(radius * 2))
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    plot(grid, cols, rows, cx + Math.cos(a) * radius, cy + Math.sin(a) * radius * 0.6, symbol)
  }
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
    const availHeight = Math.max(5, this.rows - HUD_ROWS)
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
    const totalRows = Math.max(5, this.rows - HUD_ROWS)
    // The simulated arena (world.width/height) is capped smaller than the
    // terminal by arenaSize() — plot against those bounds, but still fill
    // a full-terminal-width grid so leftover content outside the arena is
    // blanked out every frame instead of lingering.
    const arenaW = Math.min(world.width, cols)
    const arenaH = Math.min(world.height, totalRows)

    const grid = new Array(totalRows)
    for (let r = 0; r < totalRows; r++) grid[r] = new Array(cols).fill(' ')

    for (let x = 0; x < arenaW; x++) {
      grid[0][x] = '#'
      grid[arenaH - 1][x] = '#'
    }
    for (let y = 0; y < arenaH; y++) {
      grid[y][0] = '#'
      grid[y][arenaW - 1] = '#'
    }

    for (const a of world.asteroids) plot(grid, arenaW, arenaH, a.pos.x, a.pos.y, a.symbol)
    for (const pk of world.pickups) {
      const def = items.byId(pk.itemId)
      plot(grid, arenaW, arenaH, pk.pos.x, pk.pos.y, def ? def.symbol : '?')
    }
    for (const proj of world.projectiles) {
      plot(grid, arenaW, arenaH, proj.pos.x, proj.pos.y, proj.symbol)
    }

    for (const e of world.effects) {
      if (e.type === 'shockwave-ring') {
        const radius = e.maxRadius * (e.ageMs / e.ttlMs)
        plotRing(grid, arenaW, arenaH, e.pos.x, e.pos.y, radius, 'o')
      }
    }

    if (world.boss) {
      plot(grid, arenaW, arenaH, world.boss.pos.x, world.boss.pos.y, world.boss.symbol)
    }

    const p = world.player
    const blinking = p.invulnerableMs > 0 && Math.floor(p.invulnerableMs / 100) % 2 === 0
    if (p.alive && !blinking) plot(grid, arenaW, arenaH, p.pos.x, p.pos.y, shipGlyph(p.angle))

    const lines = [this._hudLine1(world), this._hudLine2(world), '-'.repeat(cols)]
    for (const row of grid) lines.push(row.join(''))

    if (world.gameOver) {
      const msg = ` GAME OVER — puntaje: ${world.player.score} — Q para salir `
      this._overlay(lines, HUD_ROWS, cols, arenaW, arenaH, msg)
    }

    this.out.write('\x1b[H' + lines.join('\r\n'))
  }

  _overlay(lines, hudRows, cols, arenaW, arenaH, msg) {
    const row = hudRows + Math.floor(arenaH / 2)
    const col = Math.max(0, Math.floor((arenaW - msg.length) / 2))
    const padded = msg.padStart(col + msg.length).padEnd(cols)
    lines[row] = padded.slice(0, cols)
  }

  _hudLine1(world) {
    const p = world.player
    const weaponId = p.weaponOrder[p.currentWeaponIndex]
    const weaponDef = items.byId(weaponId)
    const ammo = weaponDef.unlimitedAmmo ? '∞' : (p.ammo[weaponId] ?? 0)
    const lives = 'v'.repeat(Math.max(0, p.lives))

    let bossInfo = ''
    if (world.boss) {
      const pct = Math.max(0, Math.round((world.boss.hp / world.boss.maxHp) * 20))
      bossInfo = ` | ${world.boss.name} [${'#'.repeat(pct)}${'.'.repeat(20 - pct)}]`
    }

    return `Vidas:${lives || '-'} Score:${p.score} Ola:${world.wave} Arma:${weaponDef.name}(${ammo})${bossInfo}`
  }

  _hudLine2(world) {
    const abilities = [...world.player.abilities]
      .map((id) => {
        const def = items.byId(id)
        const ammo = def.unlimitedAmmo ? '∞' : (world.player.ammo[id] ?? 0)
        return `${def.name}(${ammo})`
      })
      .join(' ')

    const status = world.statusMessage ? ` | ${world.statusMessage}` : ''
    return `[A/D o flechas: girar] [W: impulso] [espacio: disparar] [E: cambiar arma] [X: ${abilities || 'sin habilidad'}] v${pkg.version}${status}`
  }
}

module.exports = { TerminalRenderer, shipGlyph }
