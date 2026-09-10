import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverCandidates, parseSeedInput } from './lib/discovery.mjs';
import { writeStableJson } from './lib/evidence-store.mjs';

const DEFAULT_SEED_FILE = resolve(process.cwd(), 'data/keywords/seeds.json');
const DEFAULT_OUT_DIR = resolve(process.cwd(), 'data/keywords');

export class DiscoverCliError extends Error {
  constructor(message) { super(message); this.name = 'DiscoverCliError'; this.code = 'DISCOVER_CLI'; }
}

function fail(message) { throw new DiscoverCliError(message); }

/** Parse the shared keyword CLI flags without accepting positional output paths. */
export function parseArgs(argv = []) {
  const result = { seedFile: DEFAULT_SEED_FILE, outDir: DEFAULT_OUT_DIR, fixture: undefined, dryRun: false };
  const takesValue = new Set(['--seed-file', '--out-dir', '--fixture']);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--dry-run') { result.dryRun = true; continue; }
    if (!takesValue.has(flag)) fail(`unknown argument ${JSON.stringify(flag)}`);
    const value = argv[index + 1];
    if (typeof value !== 'string' || value === '' || value.startsWith('--')) fail(`${flag} requires a value`);
    index += 1;
    if (flag === '--seed-file') result.seedFile = resolve(value);
    if (flag === '--out-dir') result.outDir = resolve(value);
    if (flag === '--fixture') result.fixture = resolve(value);
  }
  return result;
}

export async function readSeedFile(seedFile) {
  let text;
  try { text = await readFile(seedFile, 'utf8'); } catch { fail('seed file could not be read'); }
  let parsed;
  try { parsed = JSON.parse(text); } catch { fail('seed file is not valid JSON'); }
  try { return parseSeedInput(parsed); } catch (error) { fail('seed input is invalid'); }
}

/** Discover deterministic candidates and write only the human-reviewable input artifact. */
export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const seed = await readSeedFile(args.seedFile);
  const candidates = discoverCandidates(seed);
  if (!args.dryRun) await writeStableJson(resolve(args.outDir, 'candidates.json'), candidates);
  console.log(`discovered ${candidates.length} candidate(s)${args.dryRun ? ' (dry-run)' : ''}`);
  return { ...args, candidates };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`keyword discovery failed (${error?.code ?? 'DISCOVER_CLI'})`);
    process.exitCode = 1;
  });
}
