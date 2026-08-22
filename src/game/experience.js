'use strict'

const TIER_XP_PERCENT = {
  large: 10,
  medium: 5,
  small: 2
}

const BOSS_XP_PERCENT = 20

const BASE_REQUIREMENT = 100
const REQUIREMENT_STEP = 25

function create() {
  return {
    level: 0,
    exp: 0,
    lastLevelUps: 0
  }
}

function requirement(progress) {
  return BASE_REQUIREMENT + REQUIREMENT_STEP * progress.level
}

function grant(progress, percentOfRequirement) {
  progress.exp += (requirement(progress) * percentOfRequirement) / 100
  while (progress.exp >= requirement(progress)) {
    progress.exp -= requirement(progress)
    progress.level += 1
    progress.lastLevelUps += 1
  }
}

function grantForTier(progress, tier) {
  grant(progress, TIER_XP_PERCENT[tier] ?? 0)
}

function percent(progress) {
  return Math.min(100, (progress.exp / requirement(progress)) * 100)
}

module.exports = {
  TIER_XP_PERCENT,
  BOSS_XP_PERCENT,
  BASE_REQUIREMENT,
  REQUIREMENT_STEP,
  create,
  grant,
  grantForTier,
  requirement,
  percent
}
