// BRISA BAY v2 — the entrypoint make.fun runs (Node 22, standard library
// only). It hands the game in: copy game/ and screenshots/ from beside this
// file into /output and write /output/dossier.json, the summary the judge
// reads, with the vendored make.fun library. The game itself is plain
// static files a desktop browser loads offline — no build step, no network
// request.
//
// Run it locally the same way the grader does, with MAKEFUN_OUTPUT_DIR in
// place of /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The scorer's own caps (from the kit's reference/gate.json): only
// text_max_bytes shapes the bytes; the other caps refuse an entry the scorer
// would refuse — more than 4 screenshots or one over 256 KiB, more than 993
// files in game/ or 48 MiB of game files in all, or a path under game/ over
// 1000 bytes. game/ counts beside /output's own 1000-entry cap, together
// with its screenshots/ and dossier.json.
const GATE = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

const root = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Fail loudly instead of handing in an empty game.
if (!existsSync(join(root, 'game'))) throw new Error('game/ missing beside main.ts');

// Fail loudly instead of handing in more screenshots than the scorer takes.
const shots = existsSync(join(root, 'screenshots')) ? readdirSync(join(root, 'screenshots')) : [];
if (shots.length > GATE.screenshots.max) throw new Error(`too many screenshots: ${shots.length} (max ${GATE.screenshots.max})`);

mkdirSync(out, { recursive: true });
cpSync(join(root, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(root, 'screenshots'))) {
  cpSync(join(root, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

writeFileSync(join(out, 'dossier.json'), buildDossier(out, GATE));
