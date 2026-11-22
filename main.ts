// Token Radar — the program's entrypoint. Node 22, standard library only.
//
// It takes the sealed snapshot (the grader mounts it at /input/snapshot.json),
// scores the board through the model in lib/model.ts, and writes the entry:
//
//   board.json      the ranked board: 200 rows, the whole watchlist covered
//   data.js         the dashboard's dataset, written beside the page
//   dashboard/      a copy of this repository's dashboard/
//   screenshots/    a copy of this repository's screenshots/
//   dossier.json    the judge's dossier, built by vendor/makefun-board.ts
//
// When run outside the grader, MAKEFUN_OUTPUT_DIR takes the place of /output:
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
//
// Deterministic: the same snapshot bytes always produce the same output bytes.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot, validateModel } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

// The scorer's limits, mirrored here so a bad run fails loudly instead of
// handing in an output the gate would refuse. The text cap shapes the dossier;
// the other caps refuse.
const DOSSIER_TEXT_BYTES = 65_536;
const SCREENSHOT_LIMIT = { max: 4, max_bytes: 524_288 };
const DASHBOARD_LIMIT = { max_files: 400, max_bytes: 4_194_304 };

// A file name the gate accepts: letters, digits and . _ -, 1 to 128 characters,
// starting with a letter, digit or underscore.
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Print a message to stderr and exit non-zero. */
function die(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

/** Read `--name value` or `--name=value` from argv, or `fallback` when absent. */
function readFlag(name: string, fallback: string): string {
  const argv = process.argv;
  const separate = argv.indexOf(`--${name}`);
  if (separate >= 0 && separate + 1 < argv.length) return argv[separate + 1]!;
  const glued = argv.find((arg) => arg.startsWith(`--${name}=`));
  return glued === undefined ? fallback : glued.slice(name.length + 3);
}

// --- locate the input -------------------------------------------------------

const inputArg = readFlag('input', '/input');
const inputPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputPath)) {
  die(`no snapshot at ${inputPath}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outputDir = readFlag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

// --- score the board --------------------------------------------------------

const snapshot = parseSnapshot(readFileSync(inputPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const refused = boardIssue(board, snapshot);
if (refused !== null) die(`the model wrote a board the gate refuses: ${refused}`);

// The backtest runs on the same snapshot the board was scored from, and it
// prints to stdout only: it changes no output file, so the board, the data
// and the dossier stay exactly as the model wrote them.
const validation = validateModel(snapshot);

// --- write the outputs ------------------------------------------------------

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outputDir, 'data.js'), dataScript(radar));

/**
 * Copy a directory's regular files into `dest`, skipping dot-names and refusing
 * names the gate would not take. Returns the names copied, in directory order.
 */
function copyPlainFiles(from: string, dest: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(dest, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    if (!SAFE_NAME.test(name)) {
      die(`${dest}/${name}: a file's name is letters, digits and . _ -, 1 to 128 characters`);
    }
    copyFileSync(source, join(dest, name));
    copied.push(name);
  }
  return copied;
}

const dashboardFiles = copyPlainFiles(join(repoRoot, 'dashboard'), join(outputDir, 'dashboard'));
if (dashboardFiles.length === 0) die('dashboard/ is empty: the page is part of the entry');
const screenshotFiles = copyPlainFiles(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'));
if (screenshotFiles.length < 3) {
  const plural = screenshotFiles.length === 1 ? '' : 's';
  die(`screenshots/ holds ${screenshotFiles.length} image${plural}: hand in 3, the board, a detail view and a filtered view`);
}

// The dossier goes last: the scorer rebuilds it from this output and compares bytes.
writeFileSync(
  join(outputDir, 'dossier.json'),
  buildDossier(outputDir, {
    text_max_bytes: DOSSIER_TEXT_BYTES,
    screenshots: SCREENSHOT_LIMIT,
    dashboard: DASHBOARD_LIMIT,
  }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.extended_size} extended, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(outputDir, 'board.json')}, ${join(outputDir, 'data.js')}, ${join(outputDir, 'dashboard')} (${dashboardFiles.length} files), ${join(outputDir, 'screenshots')} (${screenshotFiles.length} images) and ${join(outputDir, 'dossier.json')}\n` +
    `token radar: model validation, leave-one-out on ${validation.live_protocols} live protocols\n` +
    `token radar:   log-RMSE ${validation.log_rmse.toFixed(2)}, Spearman ${validation.spearman.toFixed(2)}, median |log error| ${validation.median_abs_log_error.toFixed(2)}, worst |log error| ${validation.worst_abs_log_error.toFixed(2)}\n` +
    `token radar:   a log-RMSE near 2 means a typical value is off by roughly an order of magnitude: the model ranks launches, it does not price them\n`,
);
