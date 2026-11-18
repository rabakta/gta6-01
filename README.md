# BRISA BAY

[![make.fun](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/rabakta/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/rabakta/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01)

An open-world crime game in the spirit of GTA 6, built for the
[make.fun "Make GTA 6" bounty](https://make.fun/bounty/gta6-01). Rio Marin is
back in Brisa Bay — a sun-soaked coastal city you explore on foot and by car,
with traffic and pedestrians, cars to steal, a five-star wanted level with
police cars and a helicopter, twelve story missions, combat, shops, a safehouse
garage, a synth radio, and a HUD with a minimap.

## What's new in v5 — graphics update, less flat

- **Facades painted per storey:** every building's window grid is sized to
  its real height and width, so tall towers stop stretching six window
  rows. Windows are recessed with a frame, a glint and a sill, and about
  a third get a painted balcony.
- **Lit windows that actually glow:** each facade paints a second canvas,
  an emissive map, so its lit windows shine warm at sunset while the dark
  ones stay glass.
- **Roofs with depth:** a parapet rim around every roof edge, four roof
  colours across the skyline, and rooftop AC boxes for silhouette variety.
- **Ground detail:** a zebra crossing on every intersection, pastel
  checkerboard plaza tiles on the four central ones, kerb strips along
  every road edge, and a darker wet-sand band at the waterline.
- **Light that reads at dusk:** a hotter sun with deeper shadows, a glow
  halo behind every neon sign and the marina board, headlight and
  taillight halos on cars and bikes, and one soft pool of light on the
  road ahead of whatever Rio is driving.
- **Sky with depth:** eight soft clouds drifting high over the bay.

No gameplay system changed in v5: missions, taxi fares, packages, bikes,
buses and pedestrians all work exactly as in v4.

## What's new in v4

- **Motorbikes and city buses:** a Moto 250 that weaves between lanes and
  leans into its turns, and a slow Sol Bus that stops at bus stops. Both are
  stealable and drivable like any car.
- **Bus stops with boarding passengers:** four stops around the city, each
  with a sign, a bench and waiting peds. When a bus dwells there, the
  waiters board and the stop refills with new ones. Stops show on the
  minimap as cyan squares.
- **A crowd with jobs:** joggers on the sidewalks, walking groups that hold
  together, beachgoers who stop to watch the sea, vendors behind flower,
  taco and fruit stalls, and a street performer at the Plaza ringed by a
  watching crowd. Hats on some heads, so the crowd reads as people.
- **Birds:** two gull flocks circling the lighthouse and the pier.
- **Parked cars you can steal:** eight fixed rides around the city — sedans,
  a coupe, a van, a taxi, a Furia GT and two Motos. Walk up and press E.

## What's new in v3

- **Mission 11 — Midnight Grand Prix:** a checkpoint street race around the
  city against two rival cars, timed at 150 seconds.
- **Mission 12 — The Last Ferry:** the story finale — steal the fastest car
  in town, make the ferry terminal at the docks, then a five-star escape
  drive to the airfield.
- **Taxi fares:** a repeatable side activity. A passenger offer appears while
  free-roaming; drive up in a car and press E to pick them up, then deliver
  them before the timer runs out for cash plus a speed tip. Fares keep
  coming; the fare shows in the HUD objective line and as an amber blip on
  the minimap.
- **20 collectible packages:** hidden parcels across the city — beach, docks,
  lighthouse path, pier, alleys. Walk or drive through one to collect it;
  the count persists in the save, and all 20 pay a $5,000 bonus. They are
  deliberately not on the minimap: finding them is the game.
- **Fix:** Mission 8's casino steps sat on the casino tower itself, so they
  could never be reached. The radii now reach the tower's faces.

## Play

Serve `game/` with any static server and open it in a desktop browser:

```sh
node serve.ts
# open http://localhost:8080
```

No build step, no network request at runtime: every file the game loads sits
under `game/`, with three.js vendored as `game/vendor/three.module.min.js`.

**Controls:** WASD drive / walk · SHIFT run · E enter or steal a car / open a
shop / pick up a taxi fare · F punch · CLICK shoot · R radio · M next mission ·
P pause · mouse drag orbits the camera.

## Layout

- `main.ts` — the entrypoint: copies `game/` and `screenshots/` to `/output`
  and writes `dossier.json` with the vendored make.fun library.
- `game/index.html` — the page and the HUD.
- `game/src/` — the game, one file per system: `city`, `vehicles`, `player`,
  `pedestrians`, `combat`, `missions`, `hud`, `audio`, `save`, `shots`,
  `textures`, `pickups`, `taxi`, `collectibles`, `birds`, `config`, `utils`.
- `game/vendor/three.module.min.js` — three.js r160, vendored.
- `screenshots/` — four real renders of the game, staged with `?shot=`
  (street, chase, taxi, race).

## License

MIT. See [LICENSE](LICENSE).
