#!/usr/bin/env node
/**
 * verify_stage.mjs — Validate a .stage package against the
 * slidestage@1.0 contract. Used as the final gate before delivering a
 * packed deck.
 *
 * Usage:
 *   node verify_stage.mjs <file.stage> [--pretty]
 *
 * Exit codes:
 *   0  pass (no errors)
 *   1  fail (errors present, see stderr/JSON.errors[])
 *   2  cannot read file
 *
 * Output: JSON
 *   {
 *     "ok": boolean,
 *     "file": string,
 *     "bytes": number,
 *     "sha256": string,
 *     "manifest": {
 *       "id": string, "title": string, "schema": string,
 *       "architecture": string, "totalSlides": number,
 *       "compat": object | null, "provenance": object | null
 *     },
 *     "checks": { name: "pass" | "fail" | "warn", message: string }[],
 *     "errors": string[],
 *     "warnings": string[]
 *   }
 */

import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { exit } from 'node:process';
import { createHash } from 'node:crypto';

const LIMITS = {
  packMax: 200 * 1024 * 1024,
  decompressedMax: 1024 * 1024 * 1024,
  entryMax: 100 * 1024 * 1024,
  slideHtmlMax: 5 * 1024 * 1024,
  manifestMax: 5 * 1024 * 1024,
  totalSlidesMax: 500,
  idMaxLen: 128,
};

const ALLOWED_ARCH = new Set([
  'multi-file',
  'multi-file-flat',
  'single-file-deckstage',
  'single-file-html',
]);

const ALLOWED_CAPS = new Set([
  'same-origin-storage',
  'broadcast-channel',
  'window-open',
]);

function parseArgs(argv) {
  const out = { file: null, pretty: false, help: false };
  for (const a of argv) {
    if (a === '--pretty') out.pretty = true;
    else if (a === '-h' || a === '--help') out.help = true;
    else if (!a.startsWith('--')) out.file ??= a;
  }
  return out;
}

function usage() {
  return `verify_stage.mjs — Validate a .stage package

Usage:
  node verify_stage.mjs <file.stage> [--pretty]

Exit codes: 0 ok, 1 errors found, 2 file unreadable
`;
}

async function loadFflate() {
  try { return await import('fflate'); }
  catch {
    process.stderr.write('[verify] fflate is required. Install: npm i -g fflate\n');
    exit(2);
  }
}

function safeRelPath(p) {
  if (!p || typeof p !== 'string') return false;
  if (p.startsWith('/')) return false;
  if (p.includes('\x00')) return false;
  const parts = p.split('/');
  for (const part of parts) {
    if (part === '..' || part === '') return false;
  }
  return true;
}

function isPosInt(n) { return Number.isInteger(n) && n > 0; }
function isFiniteNum(n) { return typeof n === 'number' && Number.isFinite(n) && n > 0; }

function checkId(id, errors) {
  if (typeof id !== 'string' || id.length === 0) {
    errors.push('manifest.id is missing or not a string');
    return;
  }
  if (id.length > LIMITS.idMaxLen) errors.push(`manifest.id too long: ${id.length} > ${LIMITS.idMaxLen}`);
  if (id.includes('\x00')) errors.push('manifest.id contains NUL');
  if (id.includes('/')) errors.push('manifest.id contains "/"');
  if (id.includes('\\')) errors.push('manifest.id contains "\\\\"');
  if (id.includes('..')) errors.push('manifest.id contains ".."');
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(id)) errors.push('manifest.id contains control characters');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.file) {
    process.stdout.write(usage());
    exit(args.help ? 0 : 2);
  }
  const filePath = resolve(args.file);
  if (!existsSync(filePath)) {
    process.stderr.write(`[verify] file not found: ${filePath}\n`);
    exit(2);
  }

  const stats = await stat(filePath);
  const bytes = await readFile(filePath);
  const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sha = createHash('sha256').update(u8).digest('hex');

  const checks = [];
  const errors = [];
  const warnings = [];
  let manifestOut = null;

  function check(name, fn) {
    try {
      const result = fn();
      if (result === true || result === undefined) {
        checks.push({ name, status: 'pass', message: '' });
      } else if (result && typeof result === 'object' && result.warn) {
        checks.push({ name, status: 'warn', message: result.message });
        warnings.push(`${name}: ${result.message}`);
      } else {
        checks.push({ name, status: 'fail', message: String(result) });
        errors.push(`${name}: ${result}`);
      }
    } catch (e) {
      checks.push({ name, status: 'fail', message: e.message });
      errors.push(`${name}: ${e.message}`);
    }
  }

  check('size_limit', () => {
    if (stats.size > LIMITS.packMax) return `${stats.size} > ${LIMITS.packMax}`;
    return true;
  });

  const fflate = await loadFflate();
  let unzipped;
  try {
    unzipped = fflate.unzipSync(u8);
  } catch (e) {
    errors.push(`zip_readable: ${e.message}`);
    finish({ ok: false });
    return;
  }
  checks.push({ name: 'zip_readable', status: 'pass', message: '' });

  const entryPaths = Object.keys(unzipped).filter((p) => !p.endsWith('/'));
  let decompressedTotal = 0;
  for (const p of entryPaths) decompressedTotal += unzipped[p].byteLength;
  check('decompressed_limit', () => {
    if (decompressedTotal > LIMITS.decompressedMax) {
      return `${decompressedTotal} > ${LIMITS.decompressedMax}`;
    }
    return true;
  });

  check('manifest_present', () => {
    if (!unzipped['manifest.json']) return 'manifest.json missing from package root';
    return true;
  });
  if (errors.some((e) => e.startsWith('manifest_present'))) { finish({ ok: false }); return; }

  const manifestBytes = unzipped['manifest.json'];
  check('manifest_size', () => {
    if (manifestBytes.byteLength > LIMITS.manifestMax) {
      return `${manifestBytes.byteLength} > ${LIMITS.manifestMax}`;
    }
    return true;
  });

  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
    checks.push({ name: 'manifest_json_utf8', status: 'pass', message: '' });
  } catch (e) {
    errors.push(`manifest_json_utf8: ${e.message}`);
    finish({ ok: false });
    return;
  }

  check('schema_is_slidestage_1_0', () => {
    if (manifest.schema !== 'slidestage@1.0') return `schema is "${manifest.schema}"`;
    return true;
  });

  check('id_valid', () => {
    const localErrors = [];
    checkId(manifest.id, localErrors);
    if (localErrors.length > 0) return localErrors.join('; ');
    return true;
  });

  check('required_fields', () => {
    const required = ['id', 'version', 'title', 'createdAt', 'updatedAt', 'architecture', 'dimensions', 'totalSlides', 'slides'];
    const missing = required.filter((k) => !(k in manifest));
    if (missing.length > 0) return `missing: ${missing.join(', ')}`;
    return true;
  });

  check('architecture_known', () => {
    if (!ALLOWED_ARCH.has(manifest.architecture)) {
      return `architecture "${manifest.architecture}" not in allowed set`;
    }
    return true;
  });

  check('dimensions_valid', () => {
    const d = manifest.dimensions;
    if (!d || !isFiniteNum(d.width) || !isFiniteNum(d.height)) {
      return 'dimensions.width / dimensions.height must be positive finite numbers';
    }
    return true;
  });

  check('slides_non_empty', () => {
    if (!Array.isArray(manifest.slides) || manifest.slides.length === 0) {
      return 'slides must be a non-empty array';
    }
    return true;
  });

  check('slides_size_limit', () => {
    if (manifest.slides && manifest.slides.length > LIMITS.totalSlidesMax) {
      return `${manifest.slides.length} > ${LIMITS.totalSlidesMax}`;
    }
    return true;
  });

  check('total_slides_match', () => {
    if (manifest.totalSlides !== manifest.slides?.length) {
      return { warn: true, message: `totalSlides=${manifest.totalSlides} but slides.length=${manifest.slides?.length}` };
    }
    return true;
  });

  check('slide_indexes_sequential', () => {
    if (!manifest.slides) return true;
    for (let i = 0; i < manifest.slides.length; i += 1) {
      const expected = i + 1;
      if (manifest.slides[i].index !== expected) {
        return { warn: true, message: `slides[${i}].index=${manifest.slides[i].index} (expected ${expected})` };
      }
    }
    return true;
  });

  check('slide_files_safe_and_present', () => {
    if (!manifest.slides) return true;
    const missing = [];
    const unsafe = [];
    const oversize = [];
    for (const slide of manifest.slides) {
      if (!safeRelPath(slide.file)) { unsafe.push(slide.file); continue; }
      if (!unzipped[slide.file]) { missing.push(slide.file); continue; }
      if (unzipped[slide.file].byteLength > LIMITS.slideHtmlMax) {
        oversize.push(`${slide.file} (${unzipped[slide.file].byteLength})`);
      }
    }
    const problems = [];
    if (unsafe.length) problems.push(`unsafe paths: ${unsafe.join(', ')}`);
    if (missing.length) problems.push(`missing files: ${missing.join(', ')}`);
    if (oversize.length) problems.push(`oversize: ${oversize.join(', ')}`);
    return problems.length ? problems.join('; ') : true;
  });

  check('slide_thumbnails_present_when_set', () => {
    if (!manifest.slides) return true;
    const missing = [];
    for (const slide of manifest.slides) {
      if (slide.thumbnail && !unzipped[slide.thumbnail]) missing.push(slide.thumbnail);
    }
    return missing.length ? `missing thumbnails: ${missing.join(', ')}` : true;
  });

  check('entries_within_size_and_path', () => {
    const unsafe = [];
    const oversize = [];
    for (const p of entryPaths) {
      if (!safeRelPath(p)) unsafe.push(p);
      if (unzipped[p].byteLength > LIMITS.entryMax) {
        oversize.push(`${p} (${unzipped[p].byteLength})`);
      }
    }
    const problems = [];
    if (unsafe.length) problems.push(`unsafe entries: ${unsafe.join(', ')}`);
    if (oversize.length) problems.push(`oversize entries: ${oversize.join(', ')}`);
    return problems.length ? problems.join('; ') : true;
  });

  check('compat_requires_known', () => {
    const req = manifest.compat?.requires;
    if (!Array.isArray(req)) return true;
    const unknown = req.filter((c) => !ALLOWED_CAPS.has(c));
    if (unknown.length > 0) {
      return { warn: true, message: `unknown compat capabilities will be dropped: ${unknown.join(', ')}` };
    }
    return true;
  });

  check('assets_files_safe', () => {
    const files = manifest.assets?.files;
    if (!Array.isArray(files)) return true;
    const unsafe = files.filter((f) => !safeRelPath(f.path)).map((f) => f.path);
    return unsafe.length ? `unsafe asset paths: ${unsafe.join(', ')}` : true;
  });

  check('platform_min_schema', () => {
    const min = manifest.platform?.minSchemaVersion;
    if (min && min !== '1.0' && min !== '1') {
      return { warn: true, message: `platform.minSchemaVersion="${min}" exceeds runtime support` };
    }
    return true;
  });

  manifestOut = {
    id: manifest.id,
    title: manifest.title,
    schema: manifest.schema,
    architecture: manifest.architecture,
    totalSlides: manifest.totalSlides,
    compat: manifest.compat || null,
    provenance: manifest.provenance || null,
  };

  finish({ ok: errors.length === 0 });

  function finish({ ok }) {
    const result = {
      ok,
      file: filePath,
      bytes: stats.size,
      sha256: sha,
      manifest: manifestOut,
      checks,
      errors,
      warnings,
    };
    const indent = args.pretty ? 2 : 0;
    process.stdout.write(`${JSON.stringify(result, null, indent)}\n`);
    exit(ok ? 0 : 1);
  }
}

main().catch((e) => {
  process.stderr.write(`[verify] ${e.stack || e.message || e}\n`);
  exit(2);
});
