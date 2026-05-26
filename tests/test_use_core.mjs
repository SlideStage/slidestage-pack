#!/usr/bin/env node
/**
 * test_use_core.mjs — End-to-end test for slidestage-pack's `--use-core`
 * delegate path (Phase C.3 of the ecosystem improvement plan).
 *
 * Goals
 * -----
 * 1. Prove the `--use-core` flag works on every fixture (reveal / impress /
 *    inline-deck / webcomponent / router / plain-html / passthrough).
 * 2. Show that the delegate path is byte-reproducible on its own
 *    (re-pack ⇒ identical sha256).
 * 3. Cross-validate against the inline path: same fixture / same args
 *    yields **semantically equivalent** manifests (same sniff kind, mode,
 *    total slides, architecture, label set, compat requires set) — not
 *    necessarily byte-identical zips, because the two implementations
 *    inject different `data-injected-by` markers, sort entries in
 *    different orders, etc. Byte-level equivalence belongs to C4 (the
 *    dedicated cross-validate harness).
 *
 * Skip behaviour
 * --------------
 * If `@slidestage/core` is not installed (the default for a fresh
 * agent-skill checkout), every test is skipped and the script exits 0.
 * To run the test locally:
 *
 *   cd ../SlideStageLite && pnpm -r build
 *   cd packages/spec && pnpm pack --pack-destination /tmp
 *   cd ../core && pnpm pack --pack-destination /tmp
 *   cd ../../../slidestage-pack
 *   npm install /tmp/slidestage-spec-0.1.0.tgz /tmp/slidestage-core-0.1.1.tgz --no-save
 *   node tests/build_fixtures.mjs && node tests/test_use_core.mjs
 *
 * Exit code: 0 if every test passes or skips, 1 if any failed.
 */

import { createRequire } from 'node:module';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { packSlideStageFromSource } from '../scripts/pack_stage.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX_DIR = resolve(__dirname, 'fixtures');
const OUT_DIR = resolve(__dirname, 'out-use-core');

// ──────────────────────────────────────────────────────────────────────
// Capability probe — skip the whole suite when core is unreachable.
// ──────────────────────────────────────────────────────────────────────

function tryFindCorePackageRoot() {
  const requireFromHere = createRequire(import.meta.url);
  try {
    const pkgJsonPath = requireFromHere.resolve('@slidestage/core/package.json');
    return dirname(pkgJsonPath);
  } catch {
    return null;
  }
}

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

function deepEqualLabelSet(a, b) {
  if (a.length !== b.length) return false;
  const aSorted = [...a].sort();
  const bSorted = [...b].sort();
  return aSorted.every((label, idx) => label === bSorted[idx]);
}

function deepEqualCapabilitySet(a, b) {
  const aArr = Array.isArray(a) ? [...a].sort() : [];
  const bArr = Array.isArray(b) ? [...b].sort() : [];
  if (aArr.length !== bArr.length) return false;
  return aArr.every((cap, idx) => cap === bArr[idx]);
}

// ──────────────────────────────────────────────────────────────────────
// Test cases
// ──────────────────────────────────────────────────────────────────────

const TESTS = [
  // For each fixture: declare the sniff kind / mode / minimum slide count
  // the delegate path must match. The cross-validate step compares the
  // delegate result against the inline path's result for the same fixture.
  {
    name: 'reveal-basic (default → wrap, via core)',
    src: 'reveal-basic',
    mode: 'auto',
    expectKind: 'reveal',
    expectMode: 'wrap',
    minSlides: 1,
  },
  {
    name: 'reveal-basic (--mode split, via core)',
    src: 'reveal-basic',
    mode: 'split',
    expectKind: 'reveal',
    expectMode: 'split',
    minSlides: 3,
  },
  {
    name: 'impress-basic (default → wrap, via core)',
    src: 'impress-basic',
    mode: 'auto',
    expectKind: 'impress',
    expectMode: 'wrap',
    minSlides: 1,
  },
  {
    name: 'impress-basic (--mode split, via core)',
    src: 'impress-basic',
    mode: 'split',
    expectKind: 'impress',
    expectMode: 'split',
    minSlides: 3,
  },
  {
    name: 'huashu-deckstage (default → split, via core)',
    src: 'huashu-deckstage',
    mode: 'auto',
    expectKind: 'webcomponent-deck',
    expectMode: 'split',
    minSlides: 2,
  },
  {
    name: 'huashu-router (default → split, via core)',
    src: 'huashu-router',
    mode: 'auto',
    expectKind: 'router-html',
    expectMode: 'split',
    minSlides: 3,
  },
  {
    name: 'plain.html (default → single, via core)',
    src: 'plain.html',
    mode: 'auto',
    expectKind: 'plain-html',
    expectMode: 'single',
    minSlides: 1,
  },
  {
    name: 'slidestage-passthrough.stage (passthrough, via core)',
    src: 'slidestage-passthrough.stage',
    mode: 'auto',
    expectKind: 'slidestage@1.0',
    expectMode: 'passthrough',
    minSlides: 2,
    skipIfMissing: true,
  },
];

const COMMON_ARGS = {
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
};

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

  // 1. Delegate path
  let delegateResult;
  try {
    delegateResult = await packSlideStageFromSource({
      ...COMMON_ARGS,
      src: srcPath,
      out: resolve(OUT_DIR, `${t.src.replace(/[\/\.]/g, '_')}__${t.mode}.stage`),
      mode: t.mode,
      useCore: true,
    });
  } catch (e) {
    return { name: t.name, status: 'fail', message: `delegate pack threw: ${e.message}` };
  }

  if (delegateResult.sniffKind !== t.expectKind) {
    return {
      name: t.name,
      status: 'fail',
      message: `delegate sniffKind=${delegateResult.sniffKind} (expected ${t.expectKind})`,
    };
  }
  if (delegateResult.mode !== t.expectMode) {
    return {
      name: t.name,
      status: 'fail',
      message: `delegate mode=${delegateResult.mode} (expected ${t.expectMode})`,
    };
  }
  if (delegateResult.manifest.totalSlides < t.minSlides) {
    return {
      name: t.name,
      status: 'fail',
      message: `delegate produced ${delegateResult.manifest.totalSlides} slides (expected ≥ ${t.minSlides})`,
    };
  }

  // 2. Inline (default) path for cross-validation
  let inlineResult;
  try {
    inlineResult = await packSlideStageFromSource({
      ...COMMON_ARGS,
      src: srcPath,
      out: resolve(OUT_DIR, `${t.src.replace(/[\/\.]/g, '_')}__${t.mode}__inline.stage`),
      mode: t.mode,
      useCore: false,
    });
  } catch (e) {
    return { name: t.name, status: 'fail', message: `inline pack threw: ${e.message}` };
  }

  // 3. Semantic equivalence checks. Byte-level equivalence is out of
  //    scope here (and arguably out of scope for the whole project —
  //    pack and core inject different `data-injected-by` markers, sort
  //    entries differently, etc.). We assert the contract surface
  //    instead.
  try {
    assert(
      delegateResult.sniffKind === inlineResult.sniffKind,
      `sniffKind mismatch: delegate=${delegateResult.sniffKind} vs inline=${inlineResult.sniffKind}`,
    );
    assert(
      delegateResult.mode === inlineResult.mode,
      `mode mismatch: delegate=${delegateResult.mode} vs inline=${inlineResult.mode}`,
    );
    assert(
      delegateResult.manifest.architecture === inlineResult.manifest.architecture,
      `architecture mismatch: delegate=${delegateResult.manifest.architecture} vs inline=${inlineResult.manifest.architecture}`,
    );
    assert(
      delegateResult.manifest.totalSlides === inlineResult.manifest.totalSlides,
      `totalSlides mismatch: delegate=${delegateResult.manifest.totalSlides} vs inline=${inlineResult.manifest.totalSlides}`,
    );

    const dLabels = delegateResult.manifest.slides.map((s) => s.label);
    const iLabels = inlineResult.manifest.slides.map((s) => s.label);
    assert(
      deepEqualLabelSet(dLabels, iLabels),
      `slide label set differs:\n  delegate: ${JSON.stringify(dLabels)}\n  inline:   ${JSON.stringify(iLabels)}`,
    );

    const dCaps = delegateResult.manifest.compat?.requires ?? [];
    const iCaps = inlineResult.manifest.compat?.requires ?? [];
    assert(
      deepEqualCapabilitySet(dCaps, iCaps),
      `compat.requires set differs:\n  delegate: ${JSON.stringify(dCaps)}\n  inline:   ${JSON.stringify(iCaps)}`,
    );

    if (delegateResult.sniffKind !== 'slidestage@1.0') {
      const provKind = delegateResult.manifest.provenance?.sourceKind;
      assert(
        provKind === delegateResult.sniffKind,
        `delegate provenance.sourceKind=${provKind} (expected ${delegateResult.sniffKind})`,
      );
    }
  } catch (e) {
    return { name: t.name, status: 'fail', message: e.message };
  }

  // 4. Byte-reproducibility on the delegate path itself.
  let secondDelegate;
  try {
    secondDelegate = await packSlideStageFromSource({
      ...COMMON_ARGS,
      src: srcPath,
      out: resolve(OUT_DIR, `${t.src.replace(/[\/\.]/g, '_')}__${t.mode}__second.stage`),
      mode: t.mode,
      useCore: true,
    });
  } catch (e) {
    return { name: t.name, status: 'fail', message: `delegate re-pack threw: ${e.message}` };
  }
  const sha1 = sha256(delegateResult.zipBytes);
  const sha2 = sha256(secondDelegate.zipBytes);
  if (sha1 !== sha2) {
    return {
      name: t.name,
      status: 'fail',
      message: `delegate path not byte-reproducible: sha256 ${sha1.slice(0, 12)}… vs ${sha2.slice(0, 12)}…`,
    };
  }

  return {
    name: t.name,
    status: 'pass',
    message: `${delegateResult.manifest.totalSlides} slides, ${delegateResult.zipBytes.byteLength} bytes, sha=${sha1.slice(0, 12)}… (inline=${inlineResult.zipBytes.byteLength}B)`,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Conflict tests (--use-core + --thumbnails / --fallback should hard-fail)
// ──────────────────────────────────────────────────────────────────────

async function runConflict(flagName, mutateArgs) {
  const srcPath = resolve(FIX_DIR, 'plain.html');
  try {
    await packSlideStageFromSource({
      ...COMMON_ARGS,
      src: srcPath,
      out: resolve(OUT_DIR, `conflict-${flagName}.stage`),
      mode: 'auto',
      useCore: true,
      ...mutateArgs,
    });
  } catch (e) {
    if (/incompatible with --/.test(e.message)) {
      return { name: `--use-core + --${flagName} → hard error`, status: 'pass', message: e.message.slice(0, 90) };
    }
    return { name: `--use-core + --${flagName} → hard error`, status: 'fail', message: `wrong error: ${e.message}` };
  }
  return { name: `--use-core + --${flagName} → hard error`, status: 'fail', message: 'expected an error but pack succeeded' };
}

// ──────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────

async function main() {
  const coreRoot = tryFindCorePackageRoot();
  if (!coreRoot) {
    process.stdout.write(
      colorize('SKIP', '33')
      + ' @slidestage/core is not installed; skipping the entire --use-core test suite.\n'
      + '     See tests/test_use_core.mjs header for setup instructions.\n',
    );
    process.exit(0);
  }
  process.stdout.write(`[test_use_core] core root: ${coreRoot}\n`);

  if (existsSync(OUT_DIR)) await rm(OUT_DIR, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  if (!existsSync(FIX_DIR)) {
    process.stderr.write(
      `[test_use_core] fixtures not found. Run first:\n  node ${resolve(__dirname, 'build_fixtures.mjs')}\n`,
    );
    process.exit(1);
  }

  const results = [];
  for (const t of TESTS) {
    const r = await runOne(t);
    results.push(r);
  }

  results.push(await runConflict('thumbnails', { thumbnails: true }));
  results.push(await runConflict('fallback', { fallback: true }));

  for (const r of results) {
    const tag = r.status === 'pass'
      ? colorize('PASS', '32')
      : r.status === 'skip'
        ? colorize('SKIP', '33')
        : colorize('FAIL', '31');
    process.stdout.write(`${tag} ${r.name}\n`);
    if (r.message) {
      const indent = '     ';
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
  process.stderr.write(`[test_use_core] ${e.stack || e.message}\n`);
  process.exit(1);
});
