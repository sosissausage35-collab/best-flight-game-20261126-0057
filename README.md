# Langit Run — Island Ring Run

An original arcade flight game that plays offline in a desktop browser from static
files. No network requests, no libraries, no build step: open `game/index.html` from
any static server (or run `node serve.ts` and open http://localhost:8080).

## The mission

You are on the strip of a small island airfield. Take off, thread all **8 golden
rings** over the island — down the river valley, around the lake, back toward the
field — then bring the plane home and land on the runway. Rings are worth 100 points
each, a clean landing is worth 500 plus a time bonus. Watch your fuel: empty tanks
mean a glide and a forced landing.

## Controls

| Input | Action |
|---|---|
| ↑ / W | Climb (pitch up) |
| ↓ / S | Descend (pitch down) |
| ← → / A D | Bank and turn |
| SHIFT | Throttle up |
| CTRL | Throttle down |
| Mouse | Steer by pointer position; wheel = throttle |
| Click / ENTER | Start, restart |
| T | Full throttle for takeoff after an early landing |
| P / ESC | Pause |
| R | Restart |
| M | Sound on/off |

## Landing

A landing only counts when it is gentle, slow, level and lined up with the runway.
Come down too hard, too fast, off the strip or into the river and the flight is over.

## Screenshots

The four screenshots in `screenshots/` are real renders of the game running in a
headless browser, staged with `?shot=takeoff|play|approach|landed&seed=1` — the same
seed always builds the same island. The staging autopilot plays the real flight
rules forward; nothing in the frames is edited or composited.

## Files

- `game/index.html` — the page, one canvas
- `game/src/config.js` — tuning: flight model, runway, scoring
- `game/src/random.js` — seeded random source
- `game/src/terrain.js` — the island: heightfield, river, lake, rings, scenery
- `game/src/physics.js` — flight model, rings, fuel, stalls, crashes, landings
- `game/src/input.js` — keyboard and mouse
- `game/src/audio.js` — synthesized engine, wind and chimes (WebAudio, no files)
- `game/src/render.js` — pseudo-3D chase view, HUD, lit instruments, minimap, screens
- `game/src/shots.js` — the autopilot that stages the screenshot scenes
- `game/src/main.js` — boot and the game loop
- `main.ts` — the program that hands the game in (`MAKEFUN_OUTPUT_DIR=out node main.ts`)
- `vendor/makefun-game.ts` — the make.fun dossier library, unchanged from the kit

## License

MIT — see `LICENSE`.
