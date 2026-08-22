const { test } = require('brittle')
const { createCongruential } = require('../src/engine/congruential.js')
const { createRng } = require('../src/engine/rng.js')
const enemyGenerator = require('../src/game/enemyGenerator.js')
const experience = require('../src/game/experience.js')

test('congruential yields floats in [0, 1)', (t) => {
  const next = createCongruential(12345)
  for (let i = 0; i < 10000; i++) {
    const v = next()
    if (!(v >= 0 && v < 1)) {
      t.fail(`out of range at ${i}: ${v}`)
      return
    }
  }
  t.pass()
})

test('same seed reproduces the same sequence', (t) => {
  const a = createCongruential(42)
  const b = createCongruential(42)
  for (let i = 0; i < 1000; i++) {
    if (a() !== b()) {
      t.fail(`diverged at ${i}`)
      return
    }
  }
  t.pass()
})

test('different seeds produce different sequences', (t) => {
  const a = createCongruential(1)
  const b = createCongruential(2)
  let same = true
  for (let i = 0; i < 100; i++) {
    if (a() !== b()) same = false
  }
  t.absent(same)
})

test('without a seed it starts from a JS random number', (t) => {
  const a = createCongruential()
  const b = createCongruential()
  let same = true
  for (let i = 0; i < 100; i++) {
    if (a() !== b()) same = false
  }
  t.absent(same)
})

test('works as an rng source to pick items and bosses', (t) => {
  const rng = createRng({ source: createCongruential(7) })
  const items = ['bomb', 'life', 'missile']
  const bosses = ['sentinel', 'cutter', 'leviathan']

  for (let i = 0; i < 100; i++) {
    if (!items.includes(rng.pick(items))) {
      t.fail('picked unknown item')
      return
    }
    if (!bosses.includes(rng.pick(bosses))) {
      t.fail('picked unknown boss')
      return
    }
  }

  const seededAgain = createRng({ source: createCongruential(7) })
  t.is(rng.pick(items), seededAgain.pick(items))
})

const ARENA = { width: 100, height: 40 }

test('enemy generator: same seed reproduces the same wave plan', (t) => {
  const a = enemyGenerator.createWavePlan({
    rng: createRng({ source: createCongruential(99) }),
    ...ARENA,
    wave: 3
  })
  const b = enemyGenerator.createWavePlan({
    rng: createRng({ source: createCongruential(99) }),
    ...ARENA,
    wave: 3
  })

  t.alike(a, b)
})

test('enemy generator: waves are large', (t) => {
  for (let wave = 1; wave <= 10; wave++) {
    const plan = enemyGenerator.createWavePlan({
      rng: createRng({ source: createCongruential(wave * 31) }),
      ...ARENA,
      wave
    })
    if (plan.count < enemyGenerator.BASE_COUNT[0]) {
      t.fail(`wave ${wave} too small: ${plan.count}`)
      return
    }
    if (plan.entries.length !== plan.count) {
      t.fail(`wave ${wave} entries mismatch: ${plan.entries.length} != ${plan.count}`)
      return
    }
  }
  t.pass()
})

test('enemy generator: entries are valid and sorted by delay', (t) => {
  const plan = enemyGenerator.createWavePlan({
    rng: createRng({ source: createCongruential(1234) }),
    ...ARENA,
    wave: 5
  })

  let lastDelay = -1
  for (const e of plan.entries) {
    if (!(e.delayMs >= lastDelay)) {
      t.fail(`delays not ascending at ${e.delayMs} after ${lastDelay}`)
      return
    }
    lastDelay = e.delayMs
    if (!['large', 'medium', 'small'].includes(e.tier)) {
      t.fail(`unknown tier ${e.tier}`)
      return
    }
    if (
      e.x < 0 ||
      e.x > ARENA.width ||
      e.y < 0 ||
      e.y > ARENA.height ||
      !Number.isFinite(e.angle)
    ) {
      t.fail(`entry out of bounds: ${JSON.stringify(e)}`)
      return
    }
  }
  t.pass()
})

test('experience: first level costs 100, second 225 total', (t) => {
  const xp = experience.create()
  t.is(xp.level, 0)
  t.is(experience.requirement(xp), 100)

  while (xp.level < 1) experience.grantForTier(xp, 'large')
  t.is(xp.level, 1)
  t.is(experience.percent(xp) < 100, true)

  const reqLevel2 = experience.requirement(xp)
  t.is(reqLevel2, 125)
})

test('experience: tiers grant 10%, 5% and 2% of the bar', (t) => {
  const xp = experience.create()
  experience.grantForTier(xp, 'small')
  t.is(Math.round(experience.percent(xp)), 2)

  const xp2 = experience.create()
  experience.grantForTier(xp2, 'medium')
  t.is(Math.round(experience.percent(xp2)), 5)

  const xp3 = experience.create()
  experience.grantForTier(xp3, 'large')
  t.is(Math.round(experience.percent(xp3)), 10)
})

test('experience: level up carries overflow into a bigger bar', (t) => {
  const xp = experience.create()
  for (let i = 0; i < 10; i++) experience.grantForTier(xp, 'large')
  t.is(xp.level, 1)
  t.is(xp.lastLevelUps, 1)
  t.is(Math.round(experience.percent(xp)), 0)

  const before = experience.percent(xp)
  experience.grantForTier(xp, 'medium')
  experience.grantForTier(xp, 'small')
  t.is(experience.percent(xp) > before, true)
})

test('enemy generator: matchStart holds enemies back and drops them at the edges', (t) => {
  const plan = enemyGenerator.createWavePlan({
    rng: createRng({ source: createCongruential(555) }),
    ...ARENA,
    wave: 1,
    matchStart: true
  })

  t.is(plan.entries[0].delayMs >= 1000, true)

  for (const e of plan.entries) {
    const onEdge = e.x === 0 || e.x === ARENA.width || e.y === 0 || e.y === ARENA.height
    if (!onEdge) {
      t.fail(`entry not on an edge: ${JSON.stringify(e)}`)
      return
    }
  }

  let lastDelay = -1
  for (const e of plan.entries) {
    if (e.delayMs < lastDelay) {
      t.fail('delays not ascending')
      return
    }
    lastDelay = e.delayMs
  }
  t.pass()
})
