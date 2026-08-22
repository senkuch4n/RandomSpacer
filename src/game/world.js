'use strict'

const vector = require('../engine/vector')
const shipApi = require('../entities/ship')
const asteroidApi = require('../entities/asteroid')
const { spawnPickup } = require('../entities/pickup')
const { spawnBoss } = require('../entities/boss')
const enemyGenerator = require('./enemyGenerator')
const experienceApi = require('./experience')
const difficultyApi = require('./difficulty')
const items = require('../items')
const bosses = require('../bosses')

const THRUST_ACCEL = 22
const DRAG = 0.985
const MAX_SPEED = 20
const PICKUP_INTERVAL_MS = [7000, 13000]
const BOSS_INTRO_MS = 1800 // how long the "boss appears" banner stays on screen
const BOSS_DEATH_EFFECT_MS = 700
const LEVEL_UP_BANNER_MS = 1600
const ITEM_CHOICE_LEVEL_INTERVAL = 2 // offer a pick every N levels
const ITEM_CHOICE_OPTIONS = 3

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
  constructor({ rng, width, height, difficulty }) {
    this.rng = rng
    this.width = width
    this.height = height
    this.difficulty = difficultyApi.byId(difficulty)

    this.player = shipApi.createShip({
      x: width / 2,
      y: height / 2,
      startLives: this.difficulty.startLives
    })
    this.asteroids = []
    this.projectiles = []
    this.pickups = []
    this.effects = []
    this.boss = null
    this.bossIntroMs = 0
    this.pendingEnemies = []
    this.waveElapsedMs = 0

    this.experience = experienceApi.create()
    this.levelUpMs = 0
    this.itemChoice = null
    this._queuedItemChoices = 0
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

  // Rolls a procedural wave plan and queues it; enemies pour in over time
  // as _updateEnemySpawns drains the queue. The generator scales its
  // count/tier/speed curve off `wave` alone, so difficulty is applied by
  // feeding it a biased wave number instead of touching enemyGenerator.js
  // itself — `this.wave` (used for the HUD and boss hp scaling) is
  // unaffected.
  _spawnWave() {
    const effectiveWave = Math.max(1, this.wave + this.difficulty.waveBias)
    const plan = enemyGenerator.createWavePlan({
      rng: this.rng,
      width: this.width,
      height: this.height,
      wave: effectiveWave,
      matchStart: this.wave === 1
    })
    this.pendingEnemies = plan.entries
    this.waveElapsedMs = 0
    this.setStatus(`Oleada ${this.wave}: ${plan.count} enemigos (${plan.formation})`)
  }

  _updateEnemySpawns(dtMs) {
    if (this.pendingEnemies.length === 0) return

    this.waveElapsedMs += dtMs
    while (this.pendingEnemies.length > 0 && this.pendingEnemies[0].delayMs <= this.waveElapsedMs) {
      const spec = this.pendingEnemies.shift()
      this.asteroids.push(asteroidApi.spawnAsteroid(this.rng, spec))
    }
  }

  _spawnBoss() {
    const def = bosses.forWave(this.wave, this.rng)
    this.boss = spawnBoss(def, {
      x: this.width / 2,
      y: 4,
      wave: this.wave,
      hpMultiplier: this.difficulty.bossHpMul
    })
    this.bossIntroMs = BOSS_INTRO_MS
    this.setStatus(`Jefe: ${def.name}`)
  }

  update(dtMs, input) {
    if (this.gameOver || this.victory) return

    // A pending item choice pauses the whole simulation (no enemy/
    // projectile/timer updates) until the player picks one, same as a
    // classic roguelite level-up screen.
    if (this.itemChoice) {
      this._updateItemChoice(input)
      return
    }

    const dt = dtMs / 1000
    if (this.bossIntroMs > 0) this.bossIntroMs = Math.max(0, this.bossIntroMs - dtMs)
    if (this.levelUpMs > 0) this.levelUpMs = Math.max(0, this.levelUpMs - dtMs)
    this._updatePlayer(dt, dtMs, input)
    this._updateProjectiles(dt, dtMs)
    this._updateEnemySpawns(dtMs)
    this._updateAsteroids(dt, dtMs)
    this._updateBoss(dt, dtMs)
    this._updatePickups(dtMs)
    this._updateEffects(dtMs)
    this._handleCollisions()
    this._checkProgression(dtMs)

    if (!this.player.alive) this.gameOver = true
  }

  _updatePlayer(dt, dtMs, input) {
    const p = this.player

    // Twin-stick style: WASD/arrows move the ship directly in that
    // screen direction — no separate rotate-then-thrust step. The ship
    // faces wherever it's currently moving and holds that facing (for
    // aiming/rendering) once input stops, rather than snapping back.
    let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0)
    let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0)
    p.thrusting = dx !== 0 || dy !== 0

    if (p.thrusting) {
      const len = Math.hypot(dx, dy)
      dx /= len
      dy /= len
      p.angle = Math.atan2(dy, dx)
      p.vel.x += dx * THRUST_ACCEL * dt
      p.vel.y += dy * THRUST_ACCEL * dt
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

  _updateAsteroids(dt, dtMs) {
    for (const a of this.asteroids) {
      a.pos = vector.wrap(vector.add(a.pos, vector.scale(a.vel, dt)), this.width, this.height)
      if (a.spawnGraceMs > 0) a.spawnGraceMs = Math.max(0, a.spawnGraceMs - dtMs)
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
    const levelBefore = this.experience.level
    experienceApi.grantForTier(this.experience, asteroid.tier)
    this._announceLevelUps(levelBefore)
    const fragments = asteroidApi.split(this.rng, asteroid)
    this.asteroids.push(...fragments)
  }

  _collideShipWithHazards() {
    const p = this.player
    for (const a of this.asteroids) {
      if (a.hp <= 0) continue
      // Anything that just materialized this tick (split fragments from a
      // point-blank kill, or a boss drone hatched next to a player fighting
      // up close) gets a brief grace window so it can't land a hit the
      // instant it appears, before the player could possibly react.
      if (a.spawnGraceMs > 0) continue
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
      this._applyItemToPlayer(items.byId(pk.itemId))
      p.score += 5
      return false
    })
  }

  // Shared by field pickups and level-up item choices: unlocks a weapon
  // (+ammo), grants an ability (+ammo), or runs a plain pickup's onPickup
  // effect (e.g. life.js granting an extra life).
  _applyItemToPlayer(def) {
    const p = this.player
    if (def.type === 'weapon') {
      shipApi.unlockWeapon(p, def.id)
      if (!def.unlimitedAmmo) p.ammo[def.id] = (p.ammo[def.id] ?? 0) + def.ammoPerPickup
    } else if (def.type === 'ability') {
      p.abilities.add(def.id)
      if (!def.unlimitedAmmo) p.ammo[def.id] = (p.ammo[def.id] ?? 0) + def.ammoPerPickup
    } else if (def.onPickup) {
      def.onPickup({ player: p, world: this })
    }
  }

  // Offers ITEM_CHOICE_OPTIONS unique random items from the field pool —
  // a partial Fisher-Yates shuffle so there are no duplicate options.
  _openItemChoice() {
    const pool = [...items.FIELD_POOL]
    const n = Math.min(ITEM_CHOICE_OPTIONS, pool.length)
    for (let i = 0; i < n; i++) {
      const j = this.rng.int(i, pool.length - 1)
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    this.itemChoice = {
      options: pool.slice(0, n),
      selected: 0,
      _prevUp: false,
      _prevDown: false,
      _prevConfirm: false
    }
  }

  // Edge-triggered nav/confirm, same pattern as menu.js — input.up/down/
  // fire are level-triggered (held-state) so comparing against last tick
  // is what turns them into a single move/confirm per keypress.
  _updateItemChoice(input) {
    const choice = this.itemChoice
    const upEdge = input.up && !choice._prevUp
    const downEdge = input.down && !choice._prevDown
    const confirmEdge = input.fire && !choice._prevConfirm
    choice._prevUp = input.up
    choice._prevDown = input.down
    choice._prevConfirm = input.fire

    const n = choice.options.length
    if (upEdge) choice.selected = (choice.selected - 1 + n) % n
    if (downEdge) choice.selected = (choice.selected + 1) % n

    if (confirmEdge) {
      const def = choice.options[choice.selected]
      this._applyItemToPlayer(def)
      this.setStatus(`Elegiste: ${def.name}`)
      this.itemChoice = null
      if (this._queuedItemChoices > 0) {
        this._queuedItemChoices -= 1
        this._openItemChoice()
      }
    }
  }

  _onBossDefeated() {
    this.effects.push({
      type: 'boss-explosion',
      pos: { x: this.boss.pos.x, y: this.boss.pos.y },
      ageMs: 0,
      ttlMs: BOSS_DEATH_EFFECT_MS,
      maxRadius: this.boss.radius * 2.5,
      defId: this.boss.defId
    })
    this.player.score += 200 * this.wave
    const levelBefore = this.experience.level
    experienceApi.grant(this.experience, experienceApi.BOSS_XP_PERCENT)
    this._announceLevelUps(levelBefore)
    this.setStatus(`${this.boss.name} derrotado`)
    this.boss = null
    this.wave += 1
    this._spawnWave()
  }

  // A level-up triggers a brief banner (rendered in the arena, like the
  // boss intro) on top of the persistent status-line message, since it's
  // a bigger deal than most HUD status updates. Every ITEM_CHOICE_LEVEL_
  // INTERVAL levels also opens an item choice — queued rather than shown
  // all at once if a single XP grant crossed more than one such
  // threshold (e.g. one boss kill jumping several levels at once).
  _announceLevelUps(levelBefore) {
    if (this.experience.lastLevelUps > 0) {
      this.setStatus(`¡Subiste a nivel ${this.experience.level}!`)
      this.levelUpMs = LEVEL_UP_BANNER_MS
      this.experience.lastLevelUps = 0

      const thresholdsCrossed =
        Math.floor(this.experience.level / ITEM_CHOICE_LEVEL_INTERVAL) -
        Math.floor(levelBefore / ITEM_CHOICE_LEVEL_INTERVAL)
      if (thresholdsCrossed > 0) {
        this._queuedItemChoices += thresholdsCrossed - 1
        this._openItemChoice()
      }
    }
  }

  _checkProgression(dtMs) {
    if (!this.boss && this.pendingEnemies.length === 0 && this.asteroids.length === 0) {
      this._spawnBoss()
    }
  }
}

module.exports = { World }
