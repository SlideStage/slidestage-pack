#!/usr/bin/env node
/**
 * build_fixtures.mjs — Regenerate every fixture under tests/fixtures/.
 *
 * **Phase C.4 (2026-05-26)**: source fixture authoring moved into
 * `@slidestage/spec` (under `fixtures/sources/`). This script is now a
 * thin wrapper that:
 *
 *   1. Resolves the installed `@slidestage/spec` package (devDep, dev
 *      tarball, or workspace via `npm install --no-save`), then copies
 *      every entry from `fixtures/sources/` into `tests/fixtures/`
 *      verbatim. Spec owns the framework-signature contract; pack is
 *      now a consumer.
 *   2. Generates `slidestage-passthrough.stage` locally with `fflate`
 *      (spec does not ship `.stage` zip framing — that is the
 *      producer's job, and pack is the producer here).
 *
 * Run:
 *   node tests/build_fixtures.mjs
 *
 * If `@slidestage/spec` is not installed the script hard-errors with
 * dev-install instructions identical to those `pack_stage.mjs` prints
 * for `--strict-schema` / `--use-core`.
 */

import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX_DIR = resolve(__dirname, 'fixtures');
const PACK_ROOT = resolve(__dirname, '..');

async function reset() {
  if (existsSync(FIX_DIR)) await rm(FIX_DIR, { recursive: true });
  await mkdir(FIX_DIR, { recursive: true });
}

function resolveSpecSourcesDir() {
  // Try several resolver bases so the script works whether spec is
  // a regular dep, a `--no-save` tarball, or a workspace symlink.
  const bases = [
    join(PACK_ROOT, 'package.json'),
    join(__dirname, 'package.json'),
    import.meta.url,
  ];
  for (const base of bases) {
    try {
      const requireFn = createRequire(base);
      const specPackageJson = requireFn.resolve('@slidestage/spec/package.json');
      const sourcesDir = join(dirname(specPackageJson), 'fixtures', 'sources');
      if (existsSync(sourcesDir)) return sourcesDir;
    } catch {
      // try next base
    }
  }
  return null;
}

async function copySourcesFromSpec() {
  const specSourcesDir = resolveSpecSourcesDir();
  if (!specSourcesDir) {
    const lines = [
      '',
      '[build_fixtures] FATAL: @slidestage/spec is not installed (or its fixtures/sources/ directory is missing).',
      '',
      "  Pack's fixture authoring SoT was moved into spec in Phase C.4. To regenerate fixtures you need spec installed.",
      '',
      '  Install options:',
      '    1) npm:   npm install -D @slidestage/spec',
      '    2) pnpm:  pnpm add -D @slidestage/spec',
      '    3) Dev tarball (until spec is on the public npm registry):',
      '         cd ../SlideStageLite && pnpm --filter @slidestage/spec build',
      '         cd packages/spec && pnpm pack --pack-destination /tmp',
      '         cd ../../../slidestage-pack && npm install /tmp/slidestage-spec-0.1.0.tgz --no-save',
      '',
      '    Then re-run:  node tests/build_fixtures.mjs',
      '',
    ];
    process.stderr.write(lines.join('\n'));
    process.exit(4);
  }
  const entries = await readdir(specSourcesDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = join(specSourcesDir, entry.name);
    const dst = join(FIX_DIR, entry.name);
    if (entry.isDirectory()) {
      await cp(src, dst, { recursive: true });
    } else {
      await mkdir(dirname(dst), { recursive: true });
      await cp(src, dst);
    }
  }
  const allFiles = await walkFiles(FIX_DIR);
  for (const abs of allFiles) {
    process.stdout.write(`copied ${relative(FIX_DIR, abs)}\n`);
  }
  process.stdout.write(`\n[build_fixtures] sourced ${allFiles.length} files from ${specSourcesDir}\n`);
}

async function walkFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else if (entry.isFile()) out.push(abs);
    }
  }
  return out.sort();
}

// ──────────────────────────────────────────────────────────────────────
// slidestage-passthrough (a real .stage built with fflate)
//
// Pack stays the SoT for `.stage` zip framing — spec only ships
// pre-conversion sources, not packed zips, since the zip recipe
// (entry mtime fixed to manifest.createdAt for byte-reproducibility)
// is producer-specific.
// ──────────────────────────────────────────────────────────────────────

async function buildSlideStagePassthrough() {
  let fflate;
  try {
    fflate = await import('fflate');
  } catch {
    process.stderr.write('[build_fixtures] fflate not installed — skipping slidestage-passthrough.stage\n');
    process.stderr.write('                  Install: npm i fflate (in this skill folder or globally)\n');
    return;
  }
  const encoder = new TextEncoder();
  const mtime = Date.parse('2026-01-01T00:00:00.000Z');
  const manifest = {
    schema: 'slidestage@1.0',
    id: 'passthrough-fixture',
    version: '1.0.0',
    title: 'Passthrough Fixture',
    subtitle: null,
    author: 'slidestage-pack-skill',
    description: 'Tiny existing .stage used to test passthrough mode.',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    architecture: 'multi-file',
    dimensions: { width: 1920, height: 1080 },
    totalSlides: 2,
    slides: [
      { index: 1, id: 'cover', label: 'Cover', file: 'slides/01-cover.html', thumbnail: null, notes: null },
      { index: 2, id: 'content', label: 'Content', file: 'slides/02-content.html', thumbnail: null, notes: null },
    ],
  };
  const slideHtml = (h1, p) => `<!doctype html>
<html><head><meta charset="utf-8"/></head>
<body><main><h1>${h1}</h1><p>${p}</p></main></body></html>`;
  const files = {
    'manifest.json': [encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`), { mtime }],
    'slides/01-cover.html': [encoder.encode(slideHtml('Cover', 'Passthrough fixture slide 1')), { mtime }],
    'slides/02-content.html': [encoder.encode(slideHtml('Content', 'Passthrough fixture slide 2')), { mtime }],
  };
  const zip = fflate.zipSync(files, { level: 9, mtime });
  const outPath = join(FIX_DIR, 'slidestage-passthrough.stage');
  await writeFile(outPath, zip);
  process.stdout.write(`generated ${relative(FIX_DIR, outPath)} (${zip.length} bytes)\n`);
}

// ──────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────

async function main() {
  await reset();
  await copySourcesFromSpec();
  await buildSlideStagePassthrough();
  process.stdout.write('\nDone.\n');
}

main().catch((e) => {
  process.stderr.write(`${e.stack || e.message}\n`);
  process.exit(1);
});
