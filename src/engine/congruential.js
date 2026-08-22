'use strict'

const MULTIPLIER = 1664525
const INCREMENT = 1013904223
const MODULUS = 4294967296

function createCongruential(seed) {
  let state =
    typeof seed === 'number' && Number.isFinite(seed)
      ? Math.abs(Math.floor(seed)) % MODULUS
      : Math.floor(Math.random() * MODULUS)

  const next = () => {
    state = (MULTIPLIER * state + INCREMENT) % MODULUS
    return state / MODULUS
  }
  return next
}

module.exports = { createCongruential }
