const { test } = require('brittle')
const { createCongruential } = require('../src/engine/congruential.js')
const { createRng } = require('../src/engine/rng.js')
const enemyGenerator = require('../src/game/enemyGenerator.js')

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
