# RandomSpace

> Terminal Asteroids-like with rotating bosses and item pickups, deployed on Pear with peer-to-peer OTA updates.

Built for the **Pears Track** at [hackathon]. Started from [`hello-pear-bare`][hello-pear-bare], **`main` branch** (the updater runs `pear-runtime` inside a Bare worker thread, keeping P2P/update logic off the main thread while the game loop owns it).

## Play it

```sh
pear install pear://ze8mc7gygcbp7wmihyh9d66fgt6879tkb8afde3xuw4fsd8utn6o
```

Then run the installed `randomspace` binary in a real terminal (raw keyboard input needs a TTY — it won't work piped or in a non-interactive shell).

**Controls**

| Key                | Action                  |
| ------------------ | ----------------------- |
| `A`/`D` or `←`/`→` | Rotate                  |
| `W` or `↑`         | Thrust                  |
| `Space`            | Fire current weapon     |
| `E` / `Tab`        | Cycle weapon            |
| `X`                | Use ability (shockwave) |
| `Q` / `Ctrl+C`     | Quit                    |

## What it is

Classic Asteroids loop — rotate, thrust, shoot, dodge — with two systems layered on top:

- **Bosses.** Clearing a wave's asteroids spawns a boss from a 5-entry roster (`src/bosses/`), each with its own movement and attack pattern. The roster is exactly the kind of thing this track's OTA requirement is built for: add a boss module, register it, `pear stage` a new version, and every installed copy picks it up next run — no reinstall.
- **Items.** The ship starts with the default shot only. Weapons (bomb, homing missile, boomerang, burst fire) and the shockwave ability spawn as field pickups and get added to `src/items/`; a life pickup heals directly. Same OTA story as bosses — new item, new file, new release.
- **RNG.** All randomness (asteroid spawns, pickup rolls, boss selection) goes through `src/engine/rng.js`, a thin wrapper around one injectable source function. That's the seam for swapping in a teammate-provided RNG engine without touching game logic — see the file header for the exact contract.

Player starts with **2 lives**.

## Architecture

```
bin.mjs              entrypoint: boots the updater (app.js -> workers/main.js) then the game
src/engine/rng.js     injectable RNG wrapper (float/int/range/pick/weighted)
src/engine/vector.js  2D vector helpers
src/entities/         ship, asteroid, projectile, pickup, boss — plain data + factories
src/items/            weapon/ability/pickup registry — OTA-friendly, see index.js
src/bosses/           boss roster — OTA-friendly, see index.js
src/game/world.js     simulation: physics, collisions, waves, progression
src/game/loop.js      ties World to the renderer + input on a fixed tick
src/render/terminal.js  ANSI renderer (bare-tty WriteStream)
src/render/input.js     raw-mode keyboard capture (bare-tty ReadStream)
```

Updater events (`updating`, `updated`, `update-applied`, …) are routed into the in-game HUD status line instead of `console.log`, since the game owns the terminal full-screen once it starts.

## OS support / binaries built this weekend

Standalone binaries built via `bare-build --standalone` and staged for `pear install`:

- macOS — arm64, x64
- Linux — arm64, x64
- Windows — arm64, x64

## Development

```sh
npm install
npm start              # dev mode, updates disabled, needs a real terminal
```

`package.json` already has a live `upgrade` link generated with `pear touch` for this project — do not need to regenerate it unless you're forking this into a new release line.

Enable updates for local flow testing:

```sh
npm start -- --updates
```

## Scripts

- `npm start` — run in dev mode (`bare bin.mjs --no-updates`)
- `npm test` — run `brittle-bare` tests
- `npm run lint` — prettier check + lunte
- `npm run format` — format with prettier
- `npm run make` — build a standalone binary for the current host
- `npm run make:<platform>-<arch>` — build for a specific target (see OS support above); `bare-build`'s bundled cross-toolchains mean these can all run from a single macOS host

## Deploying an update (for anyone continuing this after the hackathon)

**Always rebuild the standalone binary for every release, even for pure JS/game-logic changes.** `bare-build --standalone` bakes the entire `src/` tree into the compiled binary at build time — the installed app runs from that frozen bundle, not from loose files on the drive. Staging only `src/*.js` without rebuilding produces an update that _detects_ and _applies_ successfully (you'll see the `[updater]` messages) but delivers byte-identical binary content, so nothing actually changes after the restart. This was the actual cause of an OTA "it never updates" issue during this hackathon — not a bug in Pear's updater.

1. Change game code under `src/` (e.g. add a boss to `src/bosses/index.js`) and bump `version` in `package.json`.
2. Rebuild the binary for every platform you ship: `npm run make:darwin-arm64`, `make:darwin-x64`, `make:linux-arm64`, `make:linux-x64`, `make:win32-arm64`, `make:win32-x64`.
3. Assemble `by-arch/<platform-arch>/app/<name>` as a **flat executable file** for each platform (`<name>.exe` on Windows) — do not wrap it in a same-named directory; `pear-runtime-updater`'s swap-and-restart expects `by-arch/<host>/app/<name>` to be a single file matching the installed binary 1:1. `pear build`'s CLI forces a directory input, so build this by hand instead: `mkdir -p by-arch/<arch>/app && cp out/<arch>/randomspace by-arch/<arch>/app/randomspace`.
4. `pear stage pear://ze8mc7gygcbp7wmihyh9d66fgt6879tkb8afde3xuw4fsd8utn6o .` (dry-run first) — stage `package.json`, `src/`, and the fresh `by-arch/` together.
5. Keep `pear seed pear://ze8mc7gygcbp7wmihyh9d66fgt6879tkb8afde3xuw4fsd8utn6o` running somewhere reachable — installed copies only get the update if a seeder is up.

Verified end-to-end during this hackathon: an already-running installed copy detected a staged update, downloaded it, applied it, and after a manual restart came back as a flat single-file binary (no nesting) showing the new version and the new content.

**Seed from a host with a real public IP, not a home connection behind CGNAT.** The link was first staged and seeded from a home laptop; `pear install` timed out for everyone (self, mobile data, everyone) because the ISP's router only had a private WAN IP (`192.168.x.x`, one more NAT hop from the actual public IP) — no router setting fixes that, since the block is upstream of the router entirely. Re-seeded from a small cloud VM (Oracle Cloud free tier, Ubuntu) with a real public IPv4 instead, which fixed it immediately. Two things to check on any new seed host: the OS-level firewall (Ubuntu on Oracle images ships an `iptables` `INPUT` chain that only allows port 22 by default — add an `ACCEPT` rule for inbound UDP before the trailing `REJECT`, since Hyperswarm's DHT/hole-punching needs it) and the cloud provider's own security group/list (needs an inbound rule allowing UDP, separately from the OS firewall). Also: **Pear's local corestore storage is not portable between operating systems** — copying `~/Library/Application Support/pear` (macOS) to `~/.config/pear` (Linux) fails with `Invalid device file, was made on different platform` (RocksDB ties the storage format to the OS it was created on). Moving a project to a new host on a different OS means running `pear touch` fresh there (a new link) rather than copying state across — this project's link changed once for exactly this reason.

Note: only production `dependencies` (not `devDependencies` like `bare-build`, `prettier`, `lunte`, `brittle`) should be staged — see `.gitignore` and stage from a clean `npm ci --omit=dev` copy if staging from a dir that has dev tooling installed, to avoid shipping hundreds of MB of build toolchain into the P2P drive.

## Troubleshooting

- `INVALID_URL: Invalid URL 'pear://<YOUR_KEY_HERE>'` means the `upgrade` link in `package.json` is still a placeholder. Run `pear touch` and replace it.
- On the daemon variant (not used here), updater errors go to `<storage>/updates.log` instead of stdout.
- If `pear install` reports `Not found: .../by-arch/<arch>/app/<name>`, the staged `by-arch` folder name must exactly match the lowercase `name` field in `package.json`. Keep `name` and `productName` identical (both lowercase here) — `pear build`'s `--<platform>-app` flags require the input directory to be named after `productName`, and mismatched casing between the two fields is a good way to end up with two different paths pointing at what should be the same install.
- If the installed path ever turns into a nested directory after an applied update (`<install-dir>/randomspace` becoming a folder containing another `randomspace`), the most likely cause is `by-arch/<host>/app/<name>` not being a flat file when it was staged (see "Deploying an update" above) — `pear-runtime-updater`'s swap-and-restart does a 1:1 file swap and expects both sides to be plain files. A clean `pear sidecar shutdown` + delete the install dir and `~/Library/Application Support/<name>` + fresh `pear install` always recovers a flat, current copy.
- Raw keyboard input requires a real TTY; running the binary with stdout/stdin redirected will fail with `ENOTTY`/`EINVAL` on the renderer.

<!-- Reference Links -->

[hello-pear-bare]: https://github.com/holepunchto/hello-pear-bare
