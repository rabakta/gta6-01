# BRISA BAY

[![make.fun](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/rabakta/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/rabakta/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01)

An open-world crime game in the spirit of GTA 6, built for the
[make.fun "Make GTA 6" bounty](https://make.fun/bounty/gta6-01). Rio Marin is
back in Brisa Bay — a sun-soaked coastal city you explore on foot and by car,
with traffic and pedestrians, cars to steal, a five-star wanted level with
police cars and a helicopter, eight story missions, combat, shops, a safehouse
garage, a synth radio, and a HUD with a minimap.

## Play

Serve `game/` with any static server and open it in a desktop browser:

```sh
node serve.ts
# open http://localhost:8080
```

No build step, no network request at runtime: every file the game loads sits
under `game/`, with three.js vendored as `game/vendor/three.module.min.js`.

**Controls:** WASD drive / walk · SHIFT run · E enter or steal a car · F punch ·
CLICK shoot · R radio · M next mission · P pause · mouse drag orbits the camera.

## Layout

- `main.ts` — the entrypoint: copies `game/` and `screenshots/` to `/output`
  and writes `dossier.json` with the vendored make.fun library.
- `game/index.html` — the page and the HUD.
- `game/src/` — the game, one file per system: `city`, `vehicles`, `player`,
  `pedestrians`, `combat`, `missions`, `hud`, `audio`, `save`, `shots`,
  `textures`, `config`, `utils`.
- `game/vendor/three.module.min.js` — three.js r160, vendored.
- `screenshots/` — four real renders of the game, staged with `?shot=`.

## License

MIT. See [LICENSE](LICENSE).
