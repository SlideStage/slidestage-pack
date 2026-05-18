#!/usr/bin/env node
/**
 * run_tests.mjs — End-to-end test runner for slidestage-pack.
 *
 * For every fixture under tests/fixtures/, this:
 *   1. Calls classify() from detect_framework.mjs → asserts kind + mode
 *   2. Calls packSlideStageFromSource() → produces .stage bytes in memory
 *   3. Writes the bytes to tests/out/ and verifies via verify_stage.mjs
 *   4. Re-packs the same source and asserts byte-reproducibility (sha256 match)
 *
 * Run:
 *   node tests/build_fixtures.mjs
 *   node tests/run_tests.mjs
 *
 * Exit code: 0 if every test passes, 1 if any failed.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync as spawnSyncProc } from 'node:child_process';

import { classify, loadEntries } from '../scripts/detect_framework.mjs';
import { packSlideStageFromSource } from '../scripts/pack_stage.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX_DIR = resolve(__dirname, 'fixtures');
const OUT_DIR = resolve(__dirname, 'out');
const VERIFY_SCRIPT = resolve(__dirname, '..', 'scripts', 'verify_stage.mjs');

const TESTS = [
  {
    name: 'reveal-basic (default → wrap)',
    src: 'reveal-basic',
    expectKind: 'reveal',
    expectMode: 'wrap',
    minSlides: 1,
    extra: (manifest) => {
      assert(manifest.architecture === 'single-file-html', 'reveal wrap should produce single-file-html');
      assert(Array.isArray(manifest.compat?.requires) && manifest.compat.requires.length > 0,
        'reveal wrap should populate compat.requires');
    },
  },
  {
    name: 'reveal-basic (--mode split)',
    src: 'reveal-basic',
    mode: 'split',
    expectKind: 'reveal',
    expectMode: 'split',
    // 2 root sections + 1 vertical-stack section (kept together as a single slide
    // since slidestage multi-file is flat, no parent/child relationship in manifest).
    minSlides: 3,
    extra: (manifest) => {
      assert(manifest.architecture === 'multi-file', 'reveal split should produce multi-file');
    },
  },
  {
    name: 'impress-basic (default → wrap)',
    src: 'impress-basic',
    expectKind: 'impress',
    expectMode: 'wrap',
    minSlides: 1,
  },
  {
    name: 'impress-basic (--mode split)',
    src: 'impress-basic',
    mode: 'split',
    expectKind: 'impress',
    expectMode: 'split',
    minSlides: 3,
  },
  {
    name: 'html-ppt-skill (default → split)',
    src: 'html-ppt-skill',
    expectKind: 'inline-deck',
    expectMode: 'split',
    minSlides: 3,
    extra: (manifest) => {
      assert(manifest.architecture === 'multi-file', 'inline-deck split should produce multi-file');
    },
  },
  {
    name: 'huashu-deckstage (default → split)',
    src: 'huashu-deckstage',
    expectKind: 'webcomponent-deck',
    expectMode: 'split',
    minSlides: 2,
  },
  {
    name: 'huashu-router (default → split)',
    src: 'huashu-router',
    expectKind: 'router-html',
    expectMode: 'split',
    minSlides: 3,
  },
  {
    name: 'plain.html (default → single)',
    src: 'plain.html',
    expectKind: 'plain-html',
    expectMode: 'single',
    minSlides: 1,
  },
  {
    name: 'slidestage-passthrough.stage (passthrough)',
    src: 'slidestage-passthrough.stage',
    expectKind: 'slidestage@1.0',
    expectMode: 'passthrough',
    minSlides: 2,
    skipIfMissing: true,
  },
];

// ──────────────────────────────────────────────────────────────────────
// Assertion helpers
// ──────────────────────────────────────────────────────────────────────

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function colorize(text, code) {
  if (!process.stdout.isTTY) return text;
  return `\u001b[${code}m${text}\u001b[0m`;
}

// ──────────────────────────────────────────────────────────────────────
// Single test
// ──────────────────────────────────────────────────────────────────────

async function runOne(t) {
  const srcPath = resolve(FIX_DIR, t.src);
  if (!existsSync(srcPath)) {
    if (t.skipIfMissing) {
      return { name: t.name, status: 'skip', message: `fixture missing (probably fflate not installed)` };
    }
    return { name: t.name, status: 'fail', message: `fixture not found: ${srcPath}` };
  }

  // 1. classify
  const entries = await loadEntries(srcPath);
  const sniff = classify(entries);
  if (sniff.kind !== t.expectKind) {
    return {
      name: t.name,
      status: 'fail',
      message: `expected kind=${t.expectKind} but got ${sniff.kind}`,
    };
  }
  if (!t.mode && sniff.recommendedMode !== t.expectMode) {
    return {
      name: t.name,
      status: 'fail',
      message: `expected default mode=${t.expectMode} but got ${sniff.recommendedMode}`,
    };
  }

  // 2. pack
  const outName = `${t.src.replace(/[\/\.]/g, '_')}__${t.mode || 'auto'}.stage`;
  const outPath = resolve(OUT_DIR, outName);
  await mkdir(OUT_DIR, { recursive: true });
  let result;
  try {
    result = await packSlideStageFromSource({
      src: srcPath,
      out: outPath,
      mode: t.mode || 'auto',
      title: null,
      author: null,
      id: null,
      version: '1.0.0',
      width: 1920,
      height: 1080,
      thumbnails: false,
      fallback: false,
      strict: false,
      verbose: false,
      prettyManifest: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  } catch (e) {
    return { name: t.name, status: 'fail', message: `pack threw: ${e.message}` };
  }
  await writeFile(outPath, result.zipBytes);

  if (result.mode !== t.expectMode) {
    return { name: t.name, status: 'fail', message: `expected mode=${t.expectMode} but pack chose ${result.mode}` };
  }
  if (result.manifest.totalSlides < t.minSlides) {
    return {
      name: t.name,
      status: 'fail',
      message: `expected ≥${t.minSlides} slides but got ${result.manifest.totalSlides}`,
    };
  }

  if (t.extra) {
    try { t.extra(result.manifest); }
    catch (e) { return { name: t.name, status: 'fail', message: e.message }; }
  }

  // 3. verify via subprocess (uses the real CLI path)
  const verify = spawnSyncProc('node', [VERIFY_SCRIPT, outPath], { encoding: 'utf-8' });
  if (verify.status !== 0) {
    return {
      name: t.name,
      status: 'fail',
      message: `verify_stage.mjs exit ${verify.status}\nstdout:\n${verify.stdout}\nstderr:\n${verify.stderr}`,
    };
  }

  // 4. byte-reproducibility
  let secondResult;
  try {
    secondResult = await packSlideStageFromSource({
      src: srcPath,
      out: outPath,
      mode: t.mode || 'auto',
      title: null,
      author: null,
      id: null,
      version: '1.0.0',
      width: 1920,
      height: 1080,
      thumbnails: false,
      fallback: false,
      strict: false,
      verbose: false,
      prettyManifest: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  } catch (e) {
    return { name: t.name, status: 'fail', message: `re-pack threw: ${e.message}` };
  }
  const sha1 = sha256(result.zipBytes);
  const sha2 = sha256(secondResult.zipBytes);
  if (sha1 !== sha2) {
    return {
      name: t.name,
      status: 'fail',
      message: `not byte-reproducible: sha256 differs (${sha1.slice(0, 12)} vs ${sha2.slice(0, 12)})`,
    };
  }

  return {
    name: t.name,
    status: 'pass',
    message: `${result.manifest.totalSlides} slides, ${result.zipBytes.byteLength} bytes, sha=${sha1.slice(0, 12)}…`,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────

async function main() {
  if (existsSync(OUT_DIR)) await rm(OUT_DIR, { recursive: true });

  if (!existsSync(FIX_DIR)) {
    process.stderr.write(
      `[run_tests] fixtures not found. Run first:\n  node ${resolve(__dirname, 'build_fixtures.mjs')}\n`,
    );
    process.exit(1);
  }

  const results = [];
  for (const t of TESTS) {
    const r = await runOne(t);
    results.push(r);
    const tag = r.status === 'pass'
      ? colorize('PASS', '32')
      : r.status === 'skip'
        ? colorize('SKIP', '33')
        : colorize('FAIL', '31');
    process.stdout.write(`${tag} ${r.name}\n`);
    if (r.message) {
      const indent = r.status === 'pass' ? '     ' : '     ';
      process.stdout.write(`${indent}${r.message}\n`);
    }
  }

  const pass = results.filter((r) => r.status === 'pass').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  const skip = results.filter((r) => r.status === 'skip').length;
  process.stdout.write(`\n${pass} passed · ${fail} failed · ${skip} skipped (${results.length} total)\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  process.stderr.write(`[run_tests] ${e.stack || e.message}\n`);
  process.exit(1);
});
