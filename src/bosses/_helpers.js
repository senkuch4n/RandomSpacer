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

// Bosses get meaner every wave that isn't cleared fast enough to stop
// the counter from climbing: every two waves adds one bullet to any fan
// and widens its total arc (capped at a full circle / hard count ceiling),
// so late-game bosses blanket far more of the arena than at wave 1.
const MAX_SPREAD_COUNT = 16

function spreadPressure(wave = 1) {
  const w = Math.max(0, wave - 1)
  return {
    extraCount: Math.floor(w / 2),
    radMul: Math.min(1 + 0.15 * w, 2)
  }
}

// A fan of `count` shots spread `spreadRad` total around the aim angle.
// Both grow with the boss's wave (see spreadPressure) on top of whatever
// the individual boss definition asked for.
function fireSpread(
  boss,
  player,
  { count = 5, spreadRad = Math.PI / 3, speed = 5, symbol = '^', damage = 1 } = {}
) {
  const pressure = spreadPressure(boss.wave)
  const fanCount = Math.min(count + pressure.extraCount, MAX_SPREAD_COUNT)
  const fanRad = Math.min(spreadRad * pressure.radMul, Math.PI * 2)
  const base = angleToPlayer(boss, player)
  const shots = []
  for (let i = 0; i < fanCount; i++) {
    const t = fanCount === 1 ? 0 : i / (fanCount - 1) - 0.5
    const angle = base + t * fanRad
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

module.exports = { angleToPlayer, fireAimed, fireSpread, spreadPressure }
