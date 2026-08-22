# RandomSpace

> Terminal Asteroids-like with rotating bosses and item pickups, deployed on Pear with peer-to-peer OTA updates.

Built for the **Pears Track** at [hackathon]. Started from [`hello-pear-bare`][hello-pear-bare], **`main` branch** (the updater runs `pear-runtime` inside a Bare worker thread, keeping P2P/update logic off the main thread while the game loop owns it).

## Play it

```sh
pear install pear://ns4nnrou5xqxp431ih68ibmbwrj9ahtrpc3he3s3xd5nhycotapy
```

Then run the installed `randomspace` binary in a real terminal (raw keyboard input needs a TTY — it won't work piped or in a non-interactive shell).

**Controls**

| Key | Action |
| --- | --- |
| `A`/`D` or `←`/`→` | Rotate |
| `W` or `↑` | Thrust |
| `Space` | Fire current weapon |
| `E` / `Tab` | Cycle weapon |
| `X` | Use ability (shockwave) |
| `Q` / `Ctrl+C` | Quit |

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

1. Change game code under `src/` (e.g. add a boss to `src/bosses/index.js`).
2. `npm run make:<platform>-<arch>` only if native/runtime deps changed — pure JS/game-logic changes don't need a binary rebuild, they ship straight through staging.
3. `pear stage pear://ns4nnrou5xqxp431ih68ibmbwrj9ahtrpc3he3s3xd5nhycotapy .` (dry-run first).
4. Keep `pear seed pear://ns4nnrou5xqxp431ih68ibmbwrj9ahtrpc3he3s3xd5nhycotapy` running somewhere reachable — installed copies only get the update if a seeder is up.

Note: only production `dependencies` (not `devDependencies` like `bare-build`, `prettier`, `lunte`, `brittle`) should be staged — see `.gitignore` and stage from a clean `npm ci --omit=dev` copy if staging from a dir that has dev tooling installed, to avoid shipping hundreds of MB of build toolchain into the P2P drive.

## Troubleshooting

- `INVALID_URL: Invalid URL 'pear://<YOUR_KEY_HERE>'` means the `upgrade` link in `package.json` is still a placeholder. Run `pear touch` and replace it.
- On the daemon variant (not used here), updater errors go to `<storage>/updates.log` instead of stdout.
- If `pear install` reports `Not found: .../by-arch/<arch>/app/<name>`, the staged `by-arch` folder name must exactly match the lowercase `name` field in `package.json`, not `productName`.
- Raw keyboard input requires a real TTY; running the binary with stdout/stdin redirected will fail with `ENOTTY`/`EINVAL` on the renderer.

<!-- Reference Links -->

[hello-pear-bare]: https://github.com/holepunchto/hello-pear-bare
