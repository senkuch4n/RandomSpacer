// Integration point for the teammate's RNG engine.
//
// Contract: a "source" is any object/function exposing ONE method that
// returns a fresh random float in [0, 1). That's the only thing the real
// engine has to provide. Everything else (int ranges, picking from an
// array, weighted rolls, chance checks) is derived here so the rest of
// the codebase never touches Math.random() or the raw engine directly.
//
// Wiring in the real engine later is a one-line change: pass its output
// as `source` to createRng(), e.g.
//   createRng({ source: () => teammateEngine.nextFloat() })
// or, if it hands you a function directly:
//   createRng({ source: teammateEngine.getRandomNumber })

'use strict'

function defaultSource() {
  return Math.random()
}

function normalizeSource(source) {
  if (typeof source === 'function') return source
  if (source && typeof source.next === 'function') return () => source.next()
  if (source && typeof source.random === 'function') return () => source.random()
  return defaultSource
}

class Rng {
  constructor(source) {
    this._source = normalizeSource(source)
  }

  // Replace the underlying engine at runtime (e.g. once the teammate's
  // module is ready, or to swap in a seeded engine for tests).
  setSource(source) {
    this._source = normalizeSource(source)
  }

  // Raw float in [0, 1)
  float() {
    return this._source()
  }

  // Integer in [min, max], inclusive on both ends.
  int(min, max) {
    return Math.floor(this.float() * (max - min + 1)) + min
  }

  // Float in [min, max)
  range(min, max) {
    return this.float() * (max - min) + min
  }

  // true with probability `p` (0..1)
  chance(p) {
    return this.float() < p
  }

  // Random element of a non-empty array
  pick(list) {
    return list[this.int(0, list.length - 1)]
  }

  // Weighted pick: entries = [{ weight, value }, ...]
  weighted(entries) {
    const total = entries.reduce((sum, e) => sum + e.weight, 0)
    let roll = this.range(0, total)
    for (const entry of entries) {
      roll -= entry.weight
      if (roll <= 0) return entry.value
    }
    return entries[entries.length - 1].value
  }

  // Random unit vector angle in radians, useful for spawn direction/velocity
  angle() {
    return this.range(0, Math.PI * 2)
  }
}

function createRng(opts = {}) {
  return new Rng(opts.source)
}

module.exports = { createRng, Rng }
