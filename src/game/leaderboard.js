'use strict'

// Local, P2P-gossiped leaderboard — there's no central server to host a
// global ranking on, so each install keeps its own JSON file, and every
// co-op connection (see src/net/coop.js) exchanges + merges entries with
// whoever it just connected to. Over time, as more players co-op with
// each other, scores propagate between installs the same way the rest of
// this game reaches players (P2P, no server) — it just takes people
// actually playing together to spread, rather than being instantly
// global.
const path = require('bare-path')
const fs = require('bare-fs')

const MAX_ENTRIES = 20
const FILE_NAME = 'leaderboard.json'

function filePath(dir) {
  return path.join(dir, FILE_NAME)
}

function load(dir) {
  try {
    const raw = fs.readFileSync(filePath(dir), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return [] // missing file / first run / corrupt JSON — start empty
  }
}

function save(dir, entries) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(filePath(dir), JSON.stringify(entries))
  } catch (err) {
    // A leaderboard write failing (e.g. read-only storage) shouldn't take
    // the game down with it.
    console.error('[leaderboard:error]', err)
  }
}

// Sorted desc by score, deduped by identity so merging entries synced
// from a peer (or re-saving the same list) never double-counts the same
// run, capped to MAX_ENTRIES.
function merge(entries, incoming) {
  const seen = new Set()
  const deduped = []
  for (const e of [...entries, ...incoming]) {
    if (!e || typeof e.score !== 'number' || !e.name) continue
    const key = `${e.name}|${e.score}|${e.mode}|${e.date}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(e)
  }
  deduped.sort((a, b) => b.score - a.score)
  return deduped.slice(0, MAX_ENTRIES)
}

function addEntry(dir, entry) {
  const updated = merge(load(dir), [entry])
  save(dir, updated)
  return updated
}

function mergeIncoming(dir, incoming) {
  const updated = merge(load(dir), incoming)
  save(dir, updated)
  return updated
}

function topEntries(entries, mode = 'all', limit = 8) {
  return entries.filter((e) => mode === 'all' || e.mode === mode).slice(0, limit)
}

module.exports = { MAX_ENTRIES, load, save, merge, addEntry, mergeIncoming, topEntries }
