'use strict'

const Hyperswarm = require('hyperswarm')
const FramedStream = require('framed-stream')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')

// Everyone who picks "Cooperativo" joins this same public topic — that's
// the "assigned randomly" matchmaking: nobody picks who they play with,
// Hyperswarm's DHT just connects whoever's looking for a match right now.
// No manual key/room-code exchange needed.
const LOBBY_TOPIC = crypto.hash(b4a.from('randomspace-coop-lobby-v1'))

// Host-authoritative co-op over a single P2P connection: the host runs
// the real World and is the source of truth, the guest only ever sends
// its input and renders whatever state the host last sent. This avoids
// needing a deterministic lockstep simulation (matching floating-point
// behavior, RNG draws, timing, etc. across two machines) — much simpler
// and more robust for a real-time action game with two peers.
class CoopSession {
  constructor() {
    this.swarm = new Hyperswarm()
    this.conn = null
    this.isHost = null

    this.onConnected = null // (isHost) => void
    this.onDisconnected = null // () => void
    this.onInput = null // host side: (input) => void, guest's input arrived
    this.onState = null // guest side: (worldSnapshot) => void, host's state arrived

    this.swarm.on('connection', (socket, info) => this._onConnection(socket, info))
  }

  // Joins the public lobby topic as both server and client (either side
  // can discover the other first) and resolves once at least the DHT
  // announce/lookup round has gone out. The actual pairing happens
  // asynchronously via the 'connection' handler above/onConnected.
  async findMatch() {
    const discovery = this.swarm.join(LOBBY_TOPIC, { server: true, client: true })
    await discovery.flushed()
    await this.swarm.flush()
  }

  _onConnection(socket, info) {
    // Already paired with someone — a public lobby could in principle see
    // a third peer show up mid-match; this game only ever supports two.
    if (this.conn) {
      socket.destroy()
      return
    }

    const stream = new FramedStream(socket)
    this.conn = stream

    // Deterministic, symmetric role pick: both peers compare the same two
    // public keys and land on the same answer independently, no extra
    // handshake round-trip needed to agree on who hosts.
    this.isHost = b4a.compare(this.swarm.keyPair.publicKey, info.publicKey) < 0

    stream.on('data', (buf) => this._onMessage(buf))
    stream.on('close', () => this._onClose())
    stream.on('error', () => this._onClose())
    socket.on('error', () => {}) // 'close' already follows and does cleanup

    if (this.onConnected) this.onConnected(this.isHost)
  }

  _onMessage(buf) {
    let msg
    try {
      msg = JSON.parse(b4a.toString(buf, 'utf8'))
    } catch {
      return // a malformed frame is not worth tearing down the match over
    }
    if (msg.t === 'input' && this.onInput) this.onInput(msg.input)
    else if (msg.t === 'state' && this.onState) this.onState(msg.world)
  }

  _onClose() {
    if (!this.conn) return
    this.conn = null
    if (this.onDisconnected) this.onDisconnected()
  }

  sendInput(input) {
    if (!this.conn) return
    this.conn.write(JSON.stringify({ t: 'input', input }))
  }

  sendState(world) {
    if (!this.conn) return
    this.conn.write(JSON.stringify({ t: 'state', world }))
  }

  async close() {
    if (this.conn) this.conn.destroy()
    this.conn = null
    await this.swarm.destroy()
  }
}

module.exports = { CoopSession, LOBBY_TOPIC }
