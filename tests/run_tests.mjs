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

async function loadFflate() {
  try { return await import('fflate'); } catch { return null; }
}

async function readSlideFromStage(stageBytes, slideFile) {
  const fflate = await loadFflate();
  if (!fflate) throw new Error('fflate not installed; cannot read stage zip');
  const u = fflate.unzipSync(stageBytes);
  const bytes = u[slideFile];
  if (!bytes) throw new Error(`slide ${slideFile} missing from stage`);
  return new TextDecoder('utf-8').decode(bytes);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX_DIR = resolve(__dirname, 'fixtures');
const OUT_DIR = resolve(__dirname, 'out');
const VERIFY_SCRIPT = resolve(__dirname, '..', 'scripts', 'verify_stage.mjs');

// Helper: assert manifest.slides[i].notes for each expected entry. Each
// expectation is either:
//   • a string → notes must start with that substring (trimmed contains)
//   • null     → notes must be null
//   • undefined→ skip (don't check that slide)
function assertNotes(manifest, expectations) {
  expectations.forEach((expected, i) => {
    if (expected === undefined) return;
    const actual = manifest.slides[i]?.notes ?? null;
    if (expected === null) {
      assert(actual === null,
        `slides[${i}].notes expected null, got ${JSON.stringify(actual)}`);
    } else {
      assert(typeof actual === 'string' && actual.includes(expected),
        `slides[${i}].notes expected to include ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  });
}

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
      // Wrap mode keeps the whole reveal HTML; inline note extraction grabs
      // the FIRST <aside class="notes"> it finds (slide 1's note).
      assertNotes(manifest, ['Welcome the audience']);
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
    extra: (manifest, ctx) => {
      assert(manifest.architecture === 'multi-file', 'reveal split should produce multi-file');
      assert(manifest.slides.length === 3,
        `reveal split should produce exactly 3 slides (regression for balanced scanner), got ${manifest.slides.length}`);
      // Split mode: inline notes inside each generated slide HTML.
      // slide 1 = <aside class="notes">; slide 2 = <aside class="speaker-notes">;
      // slide 3 = vertical stack with no notes.
      assertNotes(manifest, [
        'Welcome the audience',
        'Walk through the diagram',
        null,
      ]);
      // <html lang="en" data-deck="reveal-basic"> + <body class="reveal-host"> preserved
      const cover = ctx.firstSlideHtml;
      assert(/data-deck="reveal-basic"/.test(cover),
        `<html data-deck=reveal-basic> not preserved in split slide:\n${cover.slice(0, 400)}`);
      assert(/class="reveal-host"/.test(cover),
        `<body class="reveal-host"> not preserved in split slide:\n${cover.slice(0, 400)}`);
      // .reveal > .slides wrapper kept so reveal.css can still scope
      assert(/<div class="reveal"><div class="slides">/.test(cover),
        `.reveal > .slides wrapper not preserved in split slide:\n${cover.slice(0, 400)}`);
    },
  },
  {
    name: 'impress-basic (default → wrap)',
    src: 'impress-basic',
    expectKind: 'impress',
    expectMode: 'wrap',
    minSlides: 1,
    extra: (manifest) => {
      // No notes anywhere in the impress fixture.
      assertNotes(manifest, [null]);
    },
  },
  {
    name: 'impress-basic (--mode split)',
    src: 'impress-basic',
    mode: 'split',
    expectKind: 'impress',
    expectMode: 'split',
    minSlides: 3,
    extra: (manifest) => {
      assertNotes(manifest, [null, null, null]);
    },
  },
  {
    name: 'html-ppt-skill (default → split)',
    src: 'html-ppt-skill',
    expectKind: 'inline-deck',
    expectMode: 'split',
    minSlides: 3,
    extra: (manifest) => {
      assert(manifest.architecture === 'multi-file', 'inline-deck split should produce multi-file');
      // speaker-notes/<basename>.md sidecar by synthesized filename.
      assertNotes(manifest, [
        'Greet the audience',
        'Highlight the **growth**',
        null,
      ]);
    },
  },
  {
    name: 'lewislulu-html-ppt (split: div.notes + body class + html attrs + compat)',
    src: 'lewislulu-html-ppt',
    expectKind: 'inline-deck',
    expectMode: 'split',
    minSlides: 3,
    extra: (manifest, ctx) => {
      assert(manifest.architecture === 'multi-file', 'inline-deck split should produce multi-file');
      // 1. <div class="notes"> + <aside class="notes"> both extracted
      assertNotes(manifest, [
        '这是 div class="notes" 形式',
        '这是 aside class="notes" 形式',
        null,
      ]);
      // 2. compat.requires populated because slide 3 has inline <script>
      assert(Array.isArray(manifest.compat?.requires)
        && manifest.compat.requires.includes('same-origin-storage'),
        `expected compat.requires to include same-origin-storage, got ${JSON.stringify(manifest.compat)}`);
      // 3. <body class="tpl-lewislulu"> and <html data-themes …> attrs preserved in split slides
      const cover = ctx.firstSlideHtml;
      assert(/class="tpl-lewislulu"/.test(cover),
        `<body class="tpl-lewislulu"> not preserved in split slide:\n${cover.slice(0, 400)}`);
      assert(/data-themes="tokyo-night,dracula,nord"/.test(cover),
        `<html data-themes="..."> not preserved in split slide:\n${cover.slice(0, 400)}`);
      assert(/data-injected-by="slidestage-pack"/.test(cover),
        `injected hide-notes <style> not present in split slide head:\n${cover.slice(0, 400)}`);
    },
  },
  {
    name: 'huashu-deckstage (default → split)',
    src: 'huashu-deckstage',
    expectKind: 'webcomponent-deck',
    expectMode: 'split',
    minSlides: 2,
    extra: (manifest) => {
      // slide 1 from notes/01-cover.md sidecar; slide 2 from inline <template id="speaker-notes">.
      assertNotes(manifest, [
        'Open with the customer pain point',
        'Drive the analogy home',
      ]);
    },
  },
  {
    name: 'huashu-router (default → split)',
    src: 'huashu-router',
    expectKind: 'router-html',
    expectMode: 'split',
    minSlides: 3,
    extra: (manifest) => {
      // <slide-dir>/<basename>.notes.md co-located sidecar.
      assertNotes(manifest, [
        'Pause for 2 seconds',
        'Three points',
        null,
      ]);
    },
  },
  {
    name: 'plain.html (default → single)',
    src: 'plain.html',
    expectKind: 'plain-html',
    expectMode: 'single',
    minSlides: 1,
    extra: (manifest) => {
      // Single-file source → readSingleHtml loads only the .html; inline
      // <aside class="notes"> still extracts.
      assertNotes(manifest, ['Inline note on a plain single-file deck']);
    },
  },
  {
    name: 'slidestage-passthrough.stage (passthrough)',
    src: 'slidestage-passthrough.stage',
    expectKind: 'slidestage@1.0',
    expectMode: 'passthrough',
    minSlides: 2,
    skipIfMissing: true,
    extra: (manifest) => {
      // Passthrough preserves the source manifest verbatim, which carries
      // notes: null in the fixture.
      assertNotes(manifest, [null, null]);
    },
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
    let firstSlideHtml = '';
    try {
      const firstFile = result.manifest.slides?.[0]?.file;
      if (firstFile) firstSlideHtml = await readSlideFromStage(result.zipBytes, firstFile);
    } catch (e) {
      return { name: t.name, status: 'fail', message: `cannot read first slide: ${e.message}` };
    }
    try { t.extra(result.manifest, { firstSlideHtml }); }
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
