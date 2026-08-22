'use strict'

const tty = require('bare-tty')
const items = require('../items')

const HUD_ROWS = 3
const SHIP_GLYPHS = ['>', '\\', 'v', '/', '<', '\\', '^', '/']

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
    return { width: Math.max(10, this.columns), height: Math.max(5, this.rows - HUD_ROWS) }
  }

  onResize(cb) {
    this.out.on('resize', cb)
  }

  start() {
    this.out.write('\x1b[?25l\x1b[2J')
  }

  stop() {
    this.out.write('\x1b[?25h\x1b[2J\x1b[H')
  }

  render(world) {
    const cols = this.columns
    const arenaRows = Math.max(5, this.rows - HUD_ROWS)

    const grid = new Array(arenaRows)
    for (let r = 0; r < arenaRows; r++) grid[r] = new Array(cols).fill(' ')

    for (const a of world.asteroids) plot(grid, cols, arenaRows, a.pos.x, a.pos.y, a.symbol)
    for (const pk of world.pickups) {
      const def = items.byId(pk.itemId)
      plot(grid, cols, arenaRows, pk.pos.x, pk.pos.y, def ? def.symbol : '?')
    }
    for (const proj of world.projectiles) {
      plot(grid, cols, arenaRows, proj.pos.x, proj.pos.y, proj.symbol)
    }

    for (const e of world.effects) {
      if (e.type === 'shockwave-ring') {
        const radius = e.maxRadius * (e.ageMs / e.ttlMs)
        plotRing(grid, cols, arenaRows, e.pos.x, e.pos.y, radius, 'o')
      }
    }

    if (world.boss) {
      plot(grid, cols, arenaRows, world.boss.pos.x, world.boss.pos.y, world.boss.symbol)
    }

    const p = world.player
    const blinking = p.invulnerableMs > 0 && Math.floor(p.invulnerableMs / 100) % 2 === 0
    if (p.alive && !blinking) plot(grid, cols, arenaRows, p.pos.x, p.pos.y, shipGlyph(p.angle))

    const lines = [this._hudLine1(world), this._hudLine2(world), '-'.repeat(cols)]
    for (const row of grid) lines.push(row.join(''))

    if (world.gameOver) {
      const msg = ` GAME OVER — puntaje: ${world.player.score} — Q para salir `
      this._overlay(lines, HUD_ROWS, cols, arenaRows, msg)
    }

    this.out.write('\x1b[H' + lines.join('\r\n'))
  }

  _overlay(lines, hudRows, cols, arenaRows, msg) {
    const row = hudRows + Math.floor(arenaRows / 2)
    const col = Math.max(0, Math.floor((cols - msg.length) / 2))
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
    return `[A/D o flechas: girar] [W: impulso] [espacio: disparar] [E: cambiar arma] [X: ${abilities || 'sin habilidad'}]${status}`
  }
}

module.exports = { TerminalRenderer, shipGlyph }
