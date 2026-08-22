'use strict'

const vector = require('../engine/vector')
const { spawnProjectile } = require('../entities/bullet')

function angleToPlayer(boss, player) {
  return Math.atan2(player.pos.y - boss.pos.y, player.pos.x - boss.pos.x)
}

// Straight shot aimed at wherever the player currently is.
function fireAimed(boss, player, { speed = 6, symbol = 'v', damage = 1 } = {}) {
  const angle = angleToPlayer(boss, player)
  return spawnProjectile({
    pos: boss.pos,
    vel: vector.fromAngle(angle, speed),
    symbol,
    damage,
    owner: 'boss'
  })
}

// A fan of `count` shots spread `spreadRad` total around the aim angle.
function fireSpread(
  boss,
  player,
  { count = 5, spreadRad = Math.PI / 3, speed = 5, symbol = '^', damage = 1 } = {}
) {
  const base = angleToPlayer(boss, player)
  const shots = []
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1) - 0.5
    const angle = base + t * spreadRad
    shots.push(
      spawnProjectile({
        pos: boss.pos,
        vel: vector.fromAngle(angle, speed),
        symbol,
        damage,
        owner: 'boss'
      })
    )
  }
  return shots
}

module.exports = { angleToPlayer, fireAimed, fireSpread }
