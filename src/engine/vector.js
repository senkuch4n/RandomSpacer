'use strict'

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y }
}

function scale(a, s) {
  return { x: a.x * s, y: a.y * s }
}

function fromAngle(angle, magnitude = 1) {
  return { x: Math.cos(angle) * magnitude, y: Math.sin(angle) * magnitude }
}

function length(a) {
  return Math.hypot(a.x, a.y)
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function wrap(pos, width, height) {
  let { x, y } = pos
  if (x < 0) x += width
  if (x >= width) x -= width
  if (y < 0) y += height
  if (y >= height) y -= height
  return { x, y }
}

module.exports = { add, scale, fromAngle, length, distance, wrap }
