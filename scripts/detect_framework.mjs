#!/usr/bin/env node
/**
 * detect_framework.mjs — Detect the HTML deck framework of a source.
 *
 * Output is JSON (single line by default, --pretty for multiline) for easy
 * parsing by the agent or by pack_stage.mjs.
 *
 * Usage:
 *   node detect_framework.mjs <source> [--pretty]
 *
 * <source> may be:
 *   • A .html / .htm file (single-page deck)
 *   • A .zip / .stage archive
 *   • A directory (recursively walked; .git / node_modules / OS noise skipped)
 *
 * Output schema:
 *   {
 *     "kind": "slidestage@1.0" | "reveal" | "impress" | "inline-deck" |
 *             "webcomponent-deck" | "router-html" | "plain-html" |
 *             "ambiguous" | "empty",
 *     "rootHtml": "index.html" | null,
 *     "recommendedMode": "passthrough" | "split" | "wrap" | "single",
 *     "hints": {
 *       "htmlFiles": string[],
 *       "manifestFound": boolean,
 *       "manifestSchema": string | null,
 *       "inlineSectionCount": number,
 *       "deckSlideCount": number,
 *       "stepCount": number,
 *       "routerEntryCount": number,
 *       "scripts": string[],
 *       "title": string | null
 *     },
 *     "warnings": string[]
 *   }
 *
 * Exit codes:
 *   0  success (any kind including "empty" / "ambiguous")
 *   2  source path missing or unreadable
 *   3  unsupported source type (not file/dir, or zip cannot be opened)
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exit } from 'node:process';

export const SKIP_SEGMENTS = new Set(['.git', 'node_modules', '.idea', '.vscode']);
export const SKIP_LEAF_RE = /^(\.DS_Store|Thumbs\.db|.*~|.*\.swp)$/;

function parseArgs(argv) {
  const out = { source: null, pretty: false };
  for (const a of argv) {
    if (a === '--pretty') out.pretty = true;
    else if (a === '-h' || a === '--help') out.help = true;
    else if (!a.startsWith('--')) out.source ??= a;
  }
  return out;
}

function usage() {
  return `detect_framework.mjs — Detect HTML deck framework

Usage:
  node detect_framework.mjs <source> [--pretty]

<source> may be:
  • .html / .htm file (single-page deck)
  • .zip / .stage archive
  • directory (recursively walked, dev/OS noise filtered)

Output: single-line JSON (--pretty for multiline).
`;
}

export function shouldSkipPath(rel) {
  const parts = rel.split('/');
  for (const part of parts) {
    if (SKIP_SEGMENTS.has(part)) return true;
  }
  const leaf = parts[parts.length - 1];
  if (SKIP_LEAF_RE.test(leaf)) return true;
  return false;
}

export async function readFolderEntries(root) {
  const entries = new Map();
  async function walk(dirPath) {
    const dirents = await readdir(dirPath, { withFileTypes: true });
    for (const dirent of dirents) {
      const abs = join(dirPath, dirent.name);
      const rel = relative(root, abs).split(/[\\/]/g).join('/');
      if (shouldSkipPath(rel)) continue;
      if (dirent.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!dirent.isFile()) continue;
      const bytes = await readFile(abs);
      entries.set(
        rel,
        new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      );
    }
  }
  await walk(root);
  return entries;
}

export async function readZipEntries(zipPath) {
  const fflate = await loadFflate();
  const bytes = await readFile(zipPath);
  const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const unzipped = fflate.unzipSync(u8);
  const out = new Map();
  for (const [path, value] of Object.entries(unzipped)) {
    if (path.endsWith('/')) continue;
    const norm = path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (shouldSkipPath(norm)) continue;
    out.set(norm, value);
  }
  return out;
}

export async function readSingleHtml(filePath) {
  const bytes = await readFile(filePath);
  return new Map([
    [
      basename(filePath),
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    ],
  ]);
}

export async function loadFflate() {
  try {
    return await import('fflate');
  } catch {
    process.stderr.write(
      '[slidestage-pack] fflate is required for zip read/write.\n' +
        '                Install: npm i -g fflate (or `npm i fflate` in the project).\n',
    );
    exit(3);
  }
}

export function decodeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

export function topLevelHtmlFiles(entries) {
  const out = [];
  for (const path of entries.keys()) {
    if (!path.includes('/') && /\.html?$/i.test(path)) out.push(path);
  }
  return out.sort();
}

export function pickRootHtml(entries) {
  const top = topLevelHtmlFiles(entries);
  if (top.length === 0) return { rootHtml: null, ambiguous: false, top };
  if (top.length === 1) return { rootHtml: top[0], ambiguous: false, top };
  const idx = top.find((p) => /^index\.html?$/i.test(p))
    ?? top.find((p) => /^deck_index\.html?$/i.test(p))
    ?? top.find((p) => /^deck\.html?$/i.test(p))
    ?? top.find((p) => /^slides?\.html?$/i.test(p))
    ?? top.find((p) => /^presentation\.html?$/i.test(p));
  if (idx) return { rootHtml: idx, ambiguous: false, top };
  return { rootHtml: null, ambiguous: true, top };
}

export function readTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  const trimmed = m[1].replace(/\s+/g, ' ').trim();
  return trimmed || null;
}

export function collectScriptSrcs(html) {
  const out = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

export function countMatches(html, re) {
  let count = 0;
  let m;
  const reg = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = reg.exec(html)) !== null) count += 1;
  return count;
}

export function parseManifestJson(bytes) {
  const text = decodeUtf8(bytes);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function extractDeckManifestEntries(html) {
  const idx = html.search(/window\.DECK_MANIFEST\s*=\s*\[/);
  if (idx === -1) return [];
  const start = html.indexOf('[', idx);
  if (start === -1) return [];
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let escape = false;
  let end = -1;
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === stringChar) { inString = false; stringChar = ''; }
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; stringChar = ch; continue; }
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return [];
  const arrayLiteral = html.slice(start, end + 1);
  const jsLike = arrayLiteral
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*\n/g, '\n')
    .replace(/'/g, '"')
    .replace(/,(\s*[\]}])/g, '$1')
    .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
  try {
    const parsed = JSON.parse(jsLike);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function classify(entries) {
  const warnings = [];
  const hints = {
    htmlFiles: [],
    manifestFound: false,
    manifestSchema: null,
    inlineSectionCount: 0,
    deckSlideCount: 0,
    stepCount: 0,
    routerEntryCount: 0,
    scripts: [],
    title: null,
  };

  if (entries.size === 0) {
    return { kind: 'empty', rootHtml: null, recommendedMode: 'single', hints, warnings };
  }

  if (entries.has('manifest.json')) {
    const manifest = parseManifestJson(entries.get('manifest.json'));
    if (manifest && typeof manifest === 'object') {
      hints.manifestFound = true;
      hints.manifestSchema = manifest.schema ?? null;
      if (manifest.schema === 'slidestage@1.0') {
        return {
          kind: 'slidestage@1.0',
          rootHtml: 'manifest.json',
          recommendedMode: 'passthrough',
          hints,
          warnings,
        };
      }
      warnings.push(
        `manifest.json found but schema is "${manifest.schema}" (expected "slidestage@1.0")`,
      );
    } else {
      warnings.push('manifest.json found but is not valid JSON');
    }
  }

  const { rootHtml, ambiguous, top } = pickRootHtml(entries);
  hints.htmlFiles = top;
  if (!rootHtml) {
    if (ambiguous) {
      return { kind: 'ambiguous', rootHtml: null, recommendedMode: 'single', hints, warnings };
    }
    return { kind: 'empty', rootHtml: null, recommendedMode: 'single', hints, warnings };
  }

  const html = decodeUtf8(entries.get(rootHtml));
  hints.title = readTitle(html);
  hints.scripts = collectScriptSrcs(html);

  const hasDeckStage = /<deck-stage[\s>]/i.test(html);
  const hasDeckManifest = /window\.DECK_MANIFEST\s*=\s*\[/i.test(html);
  const hasRevealRoot = /<div\b[^>]*\bclass\s*=\s*("[^"]*\breveal\b[^"]*"|'[^']*\breveal\b[^']*')/i.test(html)
    && /<div\b[^>]*\bclass\s*=\s*("[^"]*\bslides\b[^"]*"|'[^']*\bslides\b[^']*')/i.test(html);
  const hasRevealScript = hints.scripts.some((s) => /reveal(\.min)?\.js$/i.test(s));
  const hasImpressRoot = /<div\b[^>]*\bid\s*=\s*("impress"|'impress')/i.test(html);
  const hasImpressScript = hints.scripts.some((s) => /impress(\.min)?\.js$/i.test(s));
  const hasInlineSection = /<section\b[^>]*\bclass\s*=\s*("[^"]*\bslide\b[^"]*"|'[^']*\bslide\b[^']*')/i.test(html);
  const hasDeckWrapper = /<div\b[^>]*\bclass\s*=\s*("[^"]*\bdeck\b[^"]*"|'[^']*\bdeck\b[^']*')/i.test(html);
  const hasRuntimeScript = hints.scripts.some((s) => /runtime\.js$/i.test(s) || /fx-runtime\.js$/i.test(s));

  hints.deckSlideCount = countMatches(html, /<deck-slide\b/gi);
  hints.inlineSectionCount = countMatches(
    html,
    /<section\b[^>]*\bclass\s*=\s*("[^"]*\bslide\b[^"]*"|'[^']*\bslide\b[^']*')/gi,
  );
  hints.stepCount = countMatches(
    html,
    /<div\b[^>]*\bclass\s*=\s*("[^"]*\bstep\b[^"]*"|'[^']*\bstep\b[^']*')/gi,
  );

  if (hasDeckStage) {
    return {
      kind: 'webcomponent-deck',
      rootHtml,
      recommendedMode: 'split',
      hints,
      warnings,
    };
  }

  if (hasDeckManifest) {
    const entriesArr = extractDeckManifestEntries(html);
    hints.routerEntryCount = entriesArr.length;
    return {
      kind: 'router-html',
      rootHtml,
      recommendedMode: 'split',
      hints,
      warnings,
    };
  }

  if (hasRevealRoot || hasRevealScript) {
    return {
      kind: 'reveal',
      rootHtml,
      recommendedMode: 'wrap',
      hints,
      warnings,
    };
  }

  if (hasImpressRoot || hasImpressScript) {
    return {
      kind: 'impress',
      rootHtml,
      recommendedMode: 'wrap',
      hints,
      warnings,
    };
  }

  if (hasInlineSection && (hasDeckWrapper || hasRuntimeScript)) {
    return {
      kind: 'inline-deck',
      rootHtml,
      recommendedMode: 'split',
      hints,
      warnings,
    };
  }

  return {
    kind: 'plain-html',
    rootHtml,
    recommendedMode: 'single',
    hints,
    warnings,
  };
}

export async function loadEntries(source) {
  const stats = await stat(source);
  if (stats.isDirectory()) return readFolderEntries(source);
  if (stats.isFile()) {
    const ext = extname(source).toLowerCase();
    if (ext === '.html' || ext === '.htm') return readSingleHtml(source);
    if (ext === '.zip' || ext === '.stage') return readZipEntries(source);
    process.stderr.write(`[detect] unsupported source extension: ${ext}\n`);
    exit(3);
  }
  process.stderr.write('[detect] source is not a file or directory\n');
  exit(3);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.source) {
    process.stdout.write(usage());
    exit(args.help ? 0 : 2);
  }
  const sourcePath = resolve(args.source);
  if (!existsSync(sourcePath)) {
    process.stderr.write(`[detect] source not found: ${sourcePath}\n`);
    exit(2);
  }

  const entries = await loadEntries(sourcePath);
  const result = classify(entries);
  const indent = args.pretty ? 2 : 0;
  process.stdout.write(`${JSON.stringify(result, null, indent)}\n`);
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === resolve(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    process.stderr.write(`[detect] ${err.stack || err.message || err}\n`);
    exit(3);
  });
}
