#!/usr/bin/env node
/**
 * test_strict_schema.mjs — End-to-end coverage for `pack_stage.mjs
 * --strict-schema`. Requires `@slidestage/spec` to be importable.
 *
 * Run:
 *   # dev (until spec is published to npm; see plan §3.B.5):
 *   #   cd ../SlideStageLite && pnpm --filter @slidestage/spec build
 *   #   cd ../SlideStageLite/packages/spec && pnpm pack --pack-destination /tmp
 *   #   cd <this repo> && npm install /tmp/slidestage-spec-0.1.0.tgz --no-save
 *   node tests/build_fixtures.mjs
 *   node tests/test_strict_schema.mjs
 *
 * If `@slidestage/spec` is not installed, every case is SKIP'd and the
 * runner exits 0 — strict-schema is opt-in and the rest of the pack
 * test suite must keep working with zero deps.
 *
 * Exit code: 0 if every test passes (or every test skips), 1 if any
 * failed.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { packSlideStageFromSource } from '../scripts/pack_stage.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX_DIR = resolve(__dirname, 'fixtures');
const require = createRequire(import.meta.url);

function colorize(text, code) {
  return process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function tryLoadSpec() {
  try {
    return await import('@slidestage/spec');
  } catch (e) {
    return { __missing: true, __error: e };
  }
}

/**
 * Resolve `@slidestage/spec`'s install root via `require.resolve` on
 * `package.json` (the canonical "find the package root" trick that
 * works for both file-tree workspace symlinks and a real npm install).
 * Returns null if spec is not installed.
 */
function tryFindSpecRoot() {
  try {
    return dirname(require.resolve('@slidestage/spec/package.json'));
  } catch {
    return null;
  }
}

/**
 * Load every JSON fixture under `<specRoot>/fixtures/invalid/`, pair
 * each with its sibling `<name>.meta.json` (if present), and return
 * `[{ name, manifest, meta }]`. Skipped silently if spec is not
 * installed.
 */
function loadInvalidFixtures(specRoot) {
  if (!specRoot) return [];
  const dir = join(specRoot, 'fixtures', 'invalid');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.json') || entry.endsWith('.meta.json')) continue;
    const name = entry.replace(/\.json$/, '');
    const manifest = JSON.parse(readFileSync(join(dir, entry), 'utf-8'));
    const metaPath = join(dir, `${name}.meta.json`);
    const meta = existsSync(metaPath)
      ? JSON.parse(readFileSync(metaPath, 'utf-8'))
      : { expectErrorIncludes: '', rejectsAtSpec: true };
    out.push({ name, manifest, meta });
  }
  return out;
}

function commonPackArgs(srcPath, outPath, overrides = {}) {
  return {
    src: srcPath,
    out: outPath,
    mode: 'auto',
    title: null,
    author: null,
    id: null,
    version: '1.0.0',
    width: 1920,
    height: 1080,
    thumbnails: false,
    fallback: false,
    strict: false,
    strictSchema: false,
    verbose: false,
    prettyManifest: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const FIXTURE_CASES = [
  { name: 'plain.html', src: 'plain.html' },
  { name: 'reveal-basic', src: 'reveal-basic' },
  { name: 'impress-basic', src: 'impress-basic' },
  { name: 'html-ppt-skill', src: 'html-ppt-skill' },
  { name: 'huashu-deckstage', src: 'huashu-deckstage' },
  { name: 'huashu-router', src: 'huashu-router' },
];

async function runFixturePass({ name, src }) {
  const srcPath = resolve(FIX_DIR, src);
  if (!existsSync(srcPath)) {
    return { name, status: 'skip', message: `fixture missing: ${src}` };
  }
  const outPath = resolve('/tmp', `strict-schema-${src.replace(/[\/\.]/g, '_')}.stage`);
  try {
    const result = await packSlideStageFromSource(
      commonPackArgs(srcPath, outPath, { strictSchema: true }),
    );
    return {
      name,
      status: 'pass',
      message: `${result.manifest.totalSlides} slides, ${result.zipBytes.byteLength} bytes`,
    };
  } catch (e) {
    return { name, status: 'fail', message: `--strict-schema rejected valid fixture: ${e.message}` };
  }
}

/**
 * Run a single invalid fixture: feed its `manifest` into
 * `spec.parseManifest` and assert (a) it throws, and (b) the thrown
 * error message contains the substring declared in the fixture's
 * `.meta.json` (`expectErrorIncludes`).
 */
async function runNegative({ name, manifest, meta }, spec) {
  try {
    spec.parseManifest(manifest);
  } catch (e) {
    const expected = meta.expectErrorIncludes ?? '';
    if (!expected || e.message.includes(expected)) {
      return {
        name: `negative · ${name}`,
        status: 'pass',
        message: `${meta.description ? meta.description.split('.')[0] : ''} — rejected with: ${e.message.slice(0, 80)}…`,
      };
    }
    return {
      name: `negative · ${name}`,
      status: 'fail',
      message: `rejected but message did not include "${expected}": ${e.message}`,
    };
  }
  return {
    name: `negative · ${name}`,
    status: 'fail',
    message: 'spec.parseManifest accepted a manifest that should have been rejected',
  };
}

async function main() {
  const spec = await tryLoadSpec();
  if (spec.__missing) {
    process.stdout.write(
      `${colorize('SKIP', '33')} all strict-schema cases — @slidestage/spec is not installed\n`
      + `     (${spec.__error?.message ?? 'unknown error'})\n`
      + `     dev setup: cd ../SlideStageLite/packages/spec && pnpm pack --pack-destination /tmp\n`
      + `                cd <this repo> && npm install /tmp/slidestage-spec-0.1.0.tgz --no-save\n`,
    );
    process.exit(0);
  }

  const specRoot = tryFindSpecRoot();
  const negativeFixtures = loadInvalidFixtures(specRoot);

  const results = [];

  for (const t of FIXTURE_CASES) {
    const r = await runFixturePass(t);
    results.push(r);
  }

  if (negativeFixtures.length === 0) {
    results.push({
      name: 'negative · spec fixtures discovery',
      status: 'fail',
      message: `expected spec/fixtures/invalid to contain at least 1 JSON, but found 0 at ${specRoot ?? '<spec-root-not-found>'}`,
    });
  } else {
    for (const n of negativeFixtures) {
      const r = await runNegative(n, spec);
      results.push(r);
    }
  }

  for (const r of results) {
    const tag = r.status === 'pass'
      ? colorize('PASS', '32')
      : r.status === 'skip'
        ? colorize('SKIP', '33')
        : colorize('FAIL', '31');
    process.stdout.write(`${tag} ${r.name}\n`);
    if (r.message) process.stdout.write(`     ${r.message}\n`);
  }

  const pass = results.filter((r) => r.status === 'pass').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  const skip = results.filter((r) => r.status === 'skip').length;
  process.stdout.write(`\n${pass} passed · ${fail} failed · ${skip} skipped (${results.length} total)\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  process.stderr.write(`[test_strict_schema] ${e.stack || e.message}\n`);
  process.exit(1);
});
