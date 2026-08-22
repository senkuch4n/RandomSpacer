'use strict'

// Procedural enemy (asteroid) generation. Given a seeded rng it produces a
// full wave plan: how many enemies, where they spawn, what tier/speed/angle
// they get and at what moment they enter the arena. Same seed => same plan,
// so runs are reproducible end to end.
//
// Bosses are NOT handled here — see src/bosses/.

const { TIERS } = require('../entities/asteroid')

const BASE_COUNT = [14, 22] // enemies rolled for wave 1
const COUNT_PER_WAVE = [6, 12] // extra enemies added per wave above 1
const MAX_COUNT = 140

// ms between spawns inside the pour; shrinks as waves go up
const SPAWN_INTERVAL = [110, 380]

const FORMATIONS = ['scatter', 'cluster', 'wall', 'spiral', 'ring']

function rollCount(rng, wave) {
  const base = rng.int(BASE_COUNT[0], BASE_COUNT[1])
  const growth = rng.int(COUNT_PER_WAVE[0], COUNT_PER_WAVE[1]) * (wave - 1)
  return Math.min(MAX_COUNT, base + growth)
}

// Early waves are mostly big slow rocks; later waves mix in more small fast ones
function rollTier(rng, wave) {
  return rng.weighted([
    { weight: Math.max(1, 10 - wave), value: 'large' },
    { weight: 4 + Math.min(wave, 8), value: 'medium' },
    { weight: Math.min(wave * 2, 12), value: 'small' }
  ])
}

function rollSpeed(rng, wave) {
  return rng.range(1, 3) + Math.min(wave - 1, 8) * 0.35
}

function safeCenter(width, height) {
  return { x: width / 2, y: height / 2 }
}

// Keeps spawn points away from the player's starting spot so nothing
// pops on top of the ship right at wave start
function awayFromPlayer(rng, width, height, minDist) {
  const center = safeCenter(width, height)
  for (let i = 0; i < 20; i++) {
    const x = rng.range(0, width)
    const y = rng.range(0, height)
    if (Math.hypot(x - center.x, y - center.y) >= minDist) return { x, y }
  }
  return { x: rng.range(0, width), y: 0 }
}

function edgePoint(rng, width, height) {
  const side = rng.int(0, 3)
  if (side === 0) return { x: 0, y: rng.range(0, height) }
  if (side === 1) return { x: width, y: rng.range(0, height) }
  if (side === 2) return { x: rng.range(0, width), y: 0 }
  return { x: rng.range(0, width), y: height }
}

function inwardAngle(pos, width, height) {
  return Math.atan2(height / 2 - pos.y, width / 2 - pos.x)
}

const FORMATION_BUILDERS = {
  scatter(count, ctx) {
    const points = []
    for (let i = 0; i < count; i++) points.push(awayFromPlayer(ctx.rng, ctx.width, ctx.height, 10))
    return points.map((p) => ({ ...p, angle: null }))
  },

  cluster(count, ctx) {
    const groupCount = ctx.rng.int(
      Math.max(2, Math.floor(count / 8)),
      Math.max(4, Math.floor(count / 4))
    )
    const centers = []
    for (let g = 0; g < groupCount; g++) centers.push(edgePoint(ctx.rng, ctx.width, ctx.height))

    return Array.from({ length: count }, (_, i) => {
      const c = centers[i % groupCount]
      const spread = ctx.rng.int(3, 9)
      return {
        x: clamp(c.x + (ctx.rng.float() + ctx.rng.float() - 1) * spread, 0, ctx.width),
        y: clamp(c.y + (ctx.rng.float() + ctx.rng.float() - 1) * spread, 0, ctx.height),
        angle: null
      }
    })
  },

  wall(count, ctx) {
    const side = ctx.rng.int(0, 3)
    const horizontal = side === 2 || side === 3
    const fixed = side % 2 === 0 ? 0 : horizontal ? ctx.height : ctx.width

    return Array.from({ length: count }, () => {
      const along = ctx.rng.range(0, horizontal ? ctx.width : ctx.height)
      const jitter = ctx.rng.range(-2, 2)
      const p = horizontal ? { x: along, y: fixed + jitter } : { x: fixed + jitter, y: along }
      return { ...p, angle: inwardAngle(p, ctx.width, ctx.height) }
    })
  },

  spiral(count, ctx) {
    const origin = edgePoint(ctx.rng, ctx.width, ctx.height)
    const startAngle = ctx.rng.angle()
    const twist = ctx.rng.chance(0.5) ? 0.7 : -0.7
    const step = ctx.rng.range(2, 5)

    return Array.from({ length: count }, (_, i) => ({
      x: clamp(origin.x + Math.cos(startAngle + twist * i) * step * i, 0, ctx.width),
      y: clamp(origin.y + Math.sin(startAngle + twist * i) * step * i, 0, ctx.height),
      angle: startAngle + twist * i
    }))
  },

  ring(count, ctx) {
    const center = ctx.rng.chance(0.5)
      ? safeCenter(ctx.width, ctx.height)
      : awayFromPlayer(ctx.rng, ctx.width, ctx.height, 12)
    const radius = ctx.rng.range(
      Math.min(ctx.width, ctx.height) / 5,
      Math.min(ctx.width, ctx.height) / 2
    )

    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 + ctx.rng.range(-0.15, 0.15)
      return {
        x: clamp(center.x + Math.cos(angle) * radius, 0, ctx.width),
        y: clamp(center.y + Math.sin(angle) * radius * 0.8, 0, ctx.height),
        angle: null
      }
    })
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

// Builds the full spawn plan for one wave.
// Returns { count, formation, entries: [{ delayMs, x, y, tier, speed, angle }] }
// sorted by delayMs, ready for the world to drain over time.
function createWavePlan({ rng, width, height, wave }) {
  const count = rollCount(rng, wave)
  const formation = rng.pick(FORMATIONS)
  const intervalScale = 1 / (1 + 0.08 * (wave - 1))

  const points = FORMATION_BUILDERS[formation](count, { rng, width, height })

  let delayMs = 0
  const entries = points.map((p) => {
    delayMs += rng.range(SPAWN_INTERVAL[0], SPAWN_INTERVAL[1]) * intervalScale
    const speed = rollSpeed(rng, wave) * rng.range(0.75, 1.25)
    return {
      delayMs,
      x: p.x,
      y: p.y,
      tier: rollTier(rng, wave),
      speed,
      angle: p.angle ?? rng.angle()
    }
  })

  return { count, formation, entries }
}

module.exports = {
  TIERS,
  BASE_COUNT,
  COUNT_PER_WAVE,
  MAX_COUNT,
  FORMATIONS,
  createWavePlan
}
