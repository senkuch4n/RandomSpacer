'use strict'

const vector = require('../engine/vector')
const shipApi = require('../entities/ship')
const asteroidApi = require('../entities/asteroid')
const { spawnPickup } = require('../entities/pickup')
const { spawnBoss } = require('../entities/boss')
const items = require('../items')
const bosses = require('../bosses')

const ROT_SPEED = Math.PI * 1.6 // rad/sec
const THRUST_ACCEL = 14
const DRAG = 0.985
const MAX_SPEED = 20
const PICKUP_INTERVAL_MS = [7000, 13000]
const ASTEROIDS_BASE_COUNT = 3

function steerToward(vel, targetAngle, maxTurn) {
  const speed = vector.length(vel)
  const current = Math.atan2(vel.y, vel.x)
  let diff = targetAngle - current
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  const turn = Math.max(-maxTurn, Math.min(maxTurn, diff))
  const next = current + turn
  return vector.fromAngle(next, speed)
}

class World {
  constructor({ rng, width, height }) {
    this.rng = rng
    this.width = width
    this.height = height

    this.player = shipApi.createShip({ x: width / 2, y: height / 2 })
    this.asteroids = []
    this.projectiles = []
    this.pickups = []
    this.effects = []
    this.boss = null

    this.wave = 1
    this.gameOver = false
    this.victory = false
    this.statusMessage = ''
    this.nextPickupInMs = this._rollPickupDelay()

    this._spawnWave()
  }

  resize(width, height) {
    this.width = width
    this.height = height
  }

  setStatus(message) {
    this.statusMessage = message
  }

  _rollPickupDelay() {
    return this.rng.range(PICKUP_INTERVAL_MS[0], PICKUP_INTERVAL_MS[1])
  }

  _spawnWave() {
    const count = ASTEROIDS_BASE_COUNT + this.wave - 1
    for (let i = 0; i < count; i++) {
      this.asteroids.push(asteroidApi.spawnAtEdge(this.rng, this.width, this.height))
    }
  }

  _spawnBoss() {
    const def = bosses.forWave(this.wave)
    this.boss = spawnBoss(def, {
      x: this.width / 2,
      y: 4,
      wave: this.wave
    })
    this.setStatus(`Jefe: ${def.name}`)
  }

  update(dtMs, input) {
    if (this.gameOver || this.victory) return

    const dt = dtMs / 1000
    this._updatePlayer(dt, dtMs, input)
    this._updateProjectiles(dt, dtMs)
    this._updateAsteroids(dt)
    this._updateBoss(dt, dtMs)
    this._updatePickups(dtMs)
    this._updateEffects(dtMs)
    this._handleCollisions()
    this._checkProgression(dtMs)

    if (!this.player.alive) this.gameOver = true
  }

  _updatePlayer(dt, dtMs, input) {
    const p = this.player

    if (input.left) p.angle -= ROT_SPEED * dt
    if (input.right) p.angle += ROT_SPEED * dt

    p.thrusting = Boolean(input.thrust)
    if (p.thrusting) {
      p.vel.x += Math.cos(p.angle) * THRUST_ACCEL * dt
      p.vel.y += Math.sin(p.angle) * THRUST_ACCEL * dt
    }

    p.vel.x *= DRAG
    p.vel.y *= DRAG
    const speed = vector.length(p.vel)
    if (speed > MAX_SPEED) {
      p.vel = vector.scale(p.vel, MAX_SPEED / speed)
    }

    p.pos = vector.wrap(vector.add(p.pos, vector.scale(p.vel, dt)), this.width, this.height)

    if (p.invulnerableMs > 0) p.invulnerableMs = Math.max(0, p.invulnerableMs - dtMs)

    for (const id in p.cooldowns) {
      if (p.cooldowns[id] > 0) p.cooldowns[id] = Math.max(0, p.cooldowns[id] - dtMs)
    }
    for (const id in p.abilityCooldowns) {
      if (p.abilityCooldowns[id] > 0) {
        p.abilityCooldowns[id] = Math.max(0, p.abilityCooldowns[id] - dtMs)
      }
    }

    if (input.fire) this._tryFireWeapon()
    if (input.cycleWeapon) shipApi.cycleWeapon(p, 1)
    if (input.activateAbility) this._tryActivateAbility()
  }

  _tryFireWeapon() {
    const p = this.player
    const weaponId = shipApi.currentWeaponId(p)
    const def = items.byId(weaponId)
    if (!def || def.type !== 'weapon') return

    const onCooldown = (p.cooldowns[weaponId] ?? 0) > 0
    const outOfAmmo = !def.unlimitedAmmo && (p.ammo[weaponId] ?? 0) <= 0
    if (onCooldown || outOfAmmo) return

    const shots = def.fire({ player: p, world: this, rng: this.rng })
    this.projectiles.push(...shots)
    p.cooldowns[weaponId] = def.cooldownMs
    if (!def.unlimitedAmmo) p.ammo[weaponId] = (p.ammo[weaponId] ?? 0) - 1
  }

  _tryActivateAbility() {
    const p = this.player
    for (const abilityId of p.abilities) {
      const def = items.byId(abilityId)
      if (!def) continue

      const onCooldown = (p.abilityCooldowns[abilityId] ?? 0) > 0
      const outOfAmmo = !def.unlimitedAmmo && (p.ammo[abilityId] ?? 0) <= 0
      if (onCooldown || outOfAmmo) continue

      const effects = def.activate({ player: p, world: this, rng: this.rng })
      if (effects) this.effects.push(...effects)
      p.abilityCooldowns[abilityId] = def.cooldownMs
      if (!def.unlimitedAmmo) p.ammo[abilityId] = (p.ammo[abilityId] ?? 0) - 1
      return
    }
  }

  _updateProjectiles(dt, dtMs) {
    for (const proj of this.projectiles) {
      proj.ageMs += dtMs

      if (proj.homing) {
        const target = this._findEntity(proj.homingTargetId, proj.homingTargetKind)
        if (target) {
          const desired = Math.atan2(target.pos.y - proj.pos.y, target.pos.x - proj.pos.x)
          proj.vel = steerToward(proj.vel, desired, proj.turnRate * dt)
        }
      }

      if (proj.boomerang) {
        proj.traveled += vector.length(proj.vel) * dt
        if (proj.traveled >= proj.maxRange) proj.returning = true
        if (proj.returning) {
          const desired = Math.atan2(this.player.pos.y - proj.pos.y, this.player.pos.x - proj.pos.x)
          proj.vel = steerToward(proj.vel, desired, 6 * dt)
        }
      }

      proj.pos = vector.wrap(
        vector.add(proj.pos, vector.scale(proj.vel, dt)),
        this.width,
        this.height
      )
    }

    this.projectiles = this.projectiles.filter((proj) => {
      if (proj.ageMs >= proj.ttlMs) return false
      if (proj.returning && vector.distance(proj.pos, this.player.pos) < 1) return false
      return true
    })
  }

  _findEntity(id, kind) {
    if (id === null) return null
    if (kind === 'boss') return this.boss && this.boss.id === id ? this.boss : null
    if (kind === 'asteroid') return this.asteroids.find((a) => a.id === id) || null
    return null
  }

  _updateAsteroids(dt) {
    for (const a of this.asteroids) {
      a.pos = vector.wrap(vector.add(a.pos, vector.scale(a.vel, dt)), this.width, this.height)
    }
  }

  _updateBoss(dt, dtMs) {
    if (!this.boss) return
    const def = bosses.byId(this.boss.defId)

    def.update({ boss: this.boss, player: this.player, world: this, rng: this.rng, dt, dtMs })

    this.boss.attackTimerMs -= dtMs
    if (this.boss.attackTimerMs <= 0) {
      this.boss.attackTimerMs = def.attackIntervalMs
      const spawned = def.attack({
        boss: this.boss,
        player: this.player,
        world: this,
        rng: this.rng
      })
      this._absorbBossSpawns(spawned || [])
    }
  }

  _absorbBossSpawns(entities) {
    for (const e of entities) {
      if (e.kind === 'projectile') this.projectiles.push(e)
      else if (e.kind === 'asteroid') this.asteroids.push(e)
    }
  }

  _updatePickups(dtMs) {
    this.nextPickupInMs -= dtMs
    if (this.nextPickupInMs <= 0) {
      this.nextPickupInMs = this._rollPickupDelay()
      const def = this.rng.pick(items.FIELD_POOL)
      this.pickups.push(
        spawnPickup(this.rng, {
          x: this.rng.range(2, this.width - 2),
          y: this.rng.range(2, this.height - 2),
          itemId: def.id
        })
      )
    }

    for (const pk of this.pickups) pk.ageMs += dtMs
    this.pickups = this.pickups.filter((pk) => pk.ageMs < pk.ttlMs)
  }

  _updateEffects(dtMs) {
    for (const e of this.effects) e.ageMs += dtMs
    this.effects = this.effects.filter((e) => e.ageMs < e.ttlMs)
  }

  _handleCollisions() {
    this._collideProjectilesWithTargets()
    this._collideShipWithHazards()
    this._collideShipWithPickups()

    this.asteroids = this.asteroids.filter((a) => a.hp > 0)
    if (this.boss && this.boss.hp <= 0) this._onBossDefeated()
  }

  _collideProjectilesWithTargets() {
    const survivors = []

    for (const proj of this.projectiles) {
      let consumed = false

      if (proj.owner === 'player') {
        for (const a of this.asteroids) {
          if (a.hp <= 0) continue
          if (vector.distance(proj.pos, a.pos) <= proj.radius + a.radius) {
            this._damageAsteroid(a, proj.damage, proj.blastRadius)
            consumed = true
            break
          }
        }
        if (
          !consumed &&
          this.boss &&
          vector.distance(proj.pos, this.boss.pos) <= proj.radius + this.boss.radius
        ) {
          this.boss.hp -= proj.damage
          if (proj.blastRadius > 0) {
            this._blastAsteroidsNear(proj.pos, proj.blastRadius, proj.damage)
          }
          consumed = true
        }
      } else if (proj.owner === 'boss') {
        if (
          this.player.invulnerableMs <= 0 &&
          vector.distance(proj.pos, this.player.pos) <= proj.radius + this.player.radius
        ) {
          shipApi.hit(this.player)
          consumed = true
        }
      }

      if (!consumed) survivors.push(proj)
    }

    this.projectiles = survivors
  }

  _damageAsteroid(asteroid, damage, blastRadius) {
    asteroid.hp -= damage
    if (asteroid.hp <= 0) this._destroyAsteroid(asteroid)
    if (blastRadius > 0) this._blastAsteroidsNear(asteroid.pos, blastRadius, damage)
  }

  _blastAsteroidsNear(pos, radius, damage) {
    for (const a of this.asteroids) {
      if (a.hp <= 0) continue
      if (vector.distance(pos, a.pos) <= radius) {
        a.hp -= damage
        if (a.hp <= 0) this._destroyAsteroid(a)
      }
    }
    if (this.boss && vector.distance(pos, this.boss.pos) <= radius) {
      this.boss.hp -= damage
    }
  }

  _destroyAsteroid(asteroid) {
    if (asteroid.hp > 0) return
    this.player.score += asteroid.tier === 'large' ? 20 : asteroid.tier === 'medium' ? 35 : 50
    const fragments = asteroidApi.split(this.rng, asteroid)
    this.asteroids.push(...fragments)
  }

  _collideShipWithHazards() {
    const p = this.player
    for (const a of this.asteroids) {
      if (a.hp <= 0) continue
      if (vector.distance(p.pos, a.pos) <= p.radius + a.radius) {
        shipApi.hit(p)
        a.hp = 0
      }
    }

    if (this.boss && vector.distance(p.pos, this.boss.pos) <= p.radius + this.boss.radius) {
      shipApi.hit(p)
    }
  }

  _collideShipWithPickups() {
    const p = this.player
    this.pickups = this.pickups.filter((pk) => {
      if (vector.distance(p.pos, pk.pos) > p.radius + pk.radius) return true

      const def = items.byId(pk.itemId)
      if (def.type === 'weapon') {
        shipApi.unlockWeapon(p, def.id)
        if (!def.unlimitedAmmo) p.ammo[def.id] = (p.ammo[def.id] ?? 0) + def.ammoPerPickup
      } else if (def.type === 'ability') {
        p.abilities.add(def.id)
        if (!def.unlimitedAmmo) p.ammo[def.id] = (p.ammo[def.id] ?? 0) + def.ammoPerPickup
      } else if (def.onPickup) {
        def.onPickup({ player: p, world: this })
      }
      p.score += 5
      return false
    })
  }

  _onBossDefeated() {
    this.player.score += 200 * this.wave
    this.setStatus(`${this.boss.name} derrotado`)
    this.boss = null
    this.wave += 1
    this._spawnWave()
  }

  _checkProgression(dtMs) {
    if (!this.boss && this.asteroids.length === 0) this._spawnBoss()
  }
}

module.exports = { World }
