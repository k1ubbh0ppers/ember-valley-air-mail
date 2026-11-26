# Ember Valley Air Mail

[![make.fun](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/k1ubbh0ppers/ember-valley-air-mail/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/k1ubbh0ppers/ember-valley-air-mail/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)

A 3D bush-pilot mail courier game for the make.fun **best flight game** bounty.
Fly a little red-and-cream mail plane through a mountain valley at golden hour:
follow the gold rings, mind your fuel, land gently on grass strips, and get
the mail to three villages before dark. Everything is original — the valley,
the plane, the sounds — and the whole game is static files that run offline
in a desktop browser.

## The mail day (three legs)

1. **Morning Post** — Ember Field → Pinewatch, a gentle introduction.
2. **Fragile Parcel** — Pinewatch → Lakeshore with a crate of glass jars:
   keep the G-meter under 2.2 and kiss the runway.
3. **Dusk Medical Run** — Lakeshore → Ember Field at dusk, crosswind on
   final, runway lights on.

Score comes from delivery, time left, landing softness, rings flown, fuel
remaining — and keeping the fragile parcel in one piece.

## Controls

| Key | Does |
| --- | --- |
| W / S | Throttle |
| ↑ / ↓ | Pitch (pull up / push down) |
| ← / → or A / D | Bank and turn |
| Q / E | Rudder |
| F | Flaps |
| B | Brakes |
| C | Chase / cockpit camera |
| P | Pause |
| R | Restart the day |
| M | Mute |
| Mouse drag | Look around |

## Play it

```sh
node serve.ts            # serves game/ on http://localhost:8901
```

Open `http://localhost:8901` in desktop Chrome. No build step, no network
requests: every script is a file under `game/`, Three.js is vendored as
`game/vendor/three.module.min.js`, and all sound is synthesised with WebAudio.

## Hand in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` copies `game/` and `screenshots/` to `/output` and writes
`/output/dossier.json` with the vendored make.fun library.

## Layout

- `game/index.html` — canvas + HUD
- `game/src/main.js` — bootstrap, loop, screen state machine
- `game/src/config.js` — tuning, strips, legs, scoring
- `game/src/terrain.js` — seeded valley, river, villages, strips, forest
- `game/src/sky.js` — sky dome, sun, clouds, birds, day presets
- `game/src/plane.js` — aircraft mesh + flight model
- `game/src/rings.js` — navigation rings
- `game/src/missions.js` — the three legs, delivery, scoring
- `game/src/hud.js` — instruments, toasts, screens
- `game/src/camera.js` — chase / cockpit camera
- `game/src/input.js` — keyboard + mouse
- `game/src/audio.js` — synthesised engine, wind and chimes
- `game/src/shots.js` — deterministic `?shot=` scenes + autopilot
- `game/vendor/three.module.min.js` — vendored Three.js 0.170.0
- `screenshots/` — four real renders of the game
- `main.ts` — the hand-in program
- `vendor/makefun-game.ts` — the kit's library, unchanged
