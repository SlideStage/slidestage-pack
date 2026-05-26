#!/usr/bin/env node
/**
 * pack_stage.mjs — Zero-dependency packer that turns any supported HTML
 * deck source into a byte-reproducible `.stage` zip (schema=slidestage@1.0).
 *
 * Sister to SlideStageLite's `pnpm convert pack`. Use this script when the
 * project is *outside* the SlideStageLite repo (no `bin/convert.ts`).
 *
 * Usage:
 *   node pack_stage.mjs --src <dir|html|zip|slidestage> --out <out>.stage
 *                          [--mode auto|split|wrap|single|passthrough]
 *                          [--title T] [--author A] [--id slug] [--version 1.0.0]
 *                          [--width 1920] [--height 1080]
 *                          [--thumbnails]      # requires `playwright`
 *                          [--fallback]        # write index.html + presenter_tools.js
 *                          [--strict]          # warnings → errors
 *                          [--strict-schema]   # requires `@slidestage/spec`; runs the
 *                                              # canonical Zod manifest schema + the
 *                                              # spec SIZE_LIMITS (8 fields) before
 *                                              # writing. Hard error if spec missing.
 *                          [--use-core]        # requires `@slidestage/core`; delegates
 *                                              # the entire detect → split → wrap → pack
 *                                              # pipeline to `@slidestage/core/converter`.
 *                                              # Output goes through the Lite converter
 *                                              # path so behaviour is byte-for-byte
 *                                              # identical to `pnpm convert` in the Lite
 *                                              # repo. Hard error if core missing.
 *                                              # Incompatible with --thumbnails /
 *                                              # --fallback (not yet ported to core).
 *                          [--verbose] [--pretty-manifest]
 *
 * Sources detected (see scripts/detect_framework.mjs for signatures):
 *   • slidestage@1.0   → passthrough
 *   • reveal.js      → wrap (default) | split (per <section>)
 *   • impress.js     → wrap (default) | split (per .step) — loses 3D
 *   • html-ppt-skill → split (per <section class="slide">)
 *   • huashu deck-stage → split (per <deck-slide>)
 *   • huashu router  → split (per window.DECK_MANIFEST entry)
 *   • plain-html     → single
 *
 * Byte-reproducibility:
 *   • `manifest.createdAt` is derived from the source's newest mtime
 *     (or the explicit --created-at value).
 *   • All zip entries are pinned to that mtime via fflate's `mtime` option,
 *     so sha256(zip) is stable across re-packs of byte-identical inputs.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exit } from 'node:process';
import {
  classify,
  decodeUtf8,
  extractDeckManifestEntries,
  loadEntries,
  loadFflate,
  readTitle,
} from './detect_framework.mjs';

const PACKER_NAME = 'slidestage-pack-skill';
const PACKER_VERSION = '0.2.0';

// Zero-dep fallback constants. The values mirror `@slidestage/spec`'s
// `SIZE_LIMITS` (the canonical SoT). When `--strict-schema` is passed,
// we replace these at runtime with the spec's 8-field superset
// (adds `decompressedTotalMax`, `annotationStrokesPerSlideMax`,
// `annotationPointsPerStrokeMax`). See `loadSpecOrFail()`.
const SIZE_LIMITS = {
  packMax: 200 * 1024 * 1024,
  entryMax: 100 * 1024 * 1024,
  slideHtmlMax: 5 * 1024 * 1024,
  manifestMax: 5 * 1024 * 1024,
  totalSlidesMax: 500,
};

// ──────────────────────────────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    src: null,
    out: null,
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
    useCore: false,
    verbose: false,
    prettyManifest: true,
    createdAt: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case '-h': case '--help': args.help = true; break;
      case '--src': args.src = argv[++i]; break;
      case '--out': args.out = argv[++i]; break;
      case '--mode': args.mode = argv[++i]; break;
      case '--title': args.title = argv[++i]; break;
      case '--author': args.author = argv[++i]; break;
      case '--id': args.id = argv[++i]; break;
      case '--version': args.version = argv[++i]; break;
      case '--width': args.width = Number(argv[++i]); break;
      case '--height': args.height = Number(argv[++i]); break;
      case '--thumbnails': args.thumbnails = true; break;
      case '--fallback': args.fallback = true; break;
      case '--strict': args.strict = true; break;
      case '--strict-schema': args.strictSchema = true; break;
      case '--use-core': args.useCore = true; break;
      case '--verbose': args.verbose = true; break;
      case '--no-pretty-manifest': args.prettyManifest = false; break;
      case '--created-at': args.createdAt = argv[++i]; break;
      default:
        if (a.startsWith('--')) throw new Error(`Unknown flag: ${a}`);
    }
  }
  return args;
}

function usage() {
  return `pack_stage.mjs — Pack any HTML deck into a byte-reproducible .stage

Usage:
  node pack_stage.mjs --src <dir|html|zip|slidestage> --out <out>.stage
                         [--mode auto|split|wrap|single|passthrough]
                         [--title T] [--author A] [--id slug] [--version 1.0.0]
                         [--width 1920] [--height 1080]
                         [--thumbnails] [--fallback]
                         [--strict] [--strict-schema] [--use-core]
                         [--verbose] [--created-at ISO8601]

Flags:
  --strict          Treat any warning emitted by the packer as a fatal error.
  --strict-schema   Validate the final manifest against the canonical
                    \`@slidestage/spec\` Zod schema before writing the zip,
                    AND switch size enforcement to the spec SIZE_LIMITS
                    (adds decompressedTotalMax). Requires \`@slidestage/spec\`
                    to be importable from this script's resolution context.
                    Default mode is zero-dependency and only checks the
                    5 pack-internal SIZE_LIMITS + path safety.
  --use-core        Delegate the entire detect → split → wrap → pack
                    pipeline to \`@slidestage/core/converter\` so output is
                    byte-for-byte identical to the Lite repo's
                    \`pnpm convert pack\`. Requires \`@slidestage/core\` to be
                    importable. Default mode keeps the zero-dependency
                    inline dispatch (8 internal dispatch* functions).
                    Incompatible with --thumbnails / --fallback for now
                    (those rely on pack-only post-processing that has not
                    been ported to core yet).
`;
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

function bytesFromString(s) {
  return encoder.encode(s);
}

function isoNow() { return new Date().toISOString(); }

function safeRelPath(p) {
  if (!p) return false;
  if (p.startsWith('/')) return false;
  if (p.includes('\x00')) return false;
  const parts = p.split('/');
  for (const part of parts) {
    if (part === '..' || part === '') return false;
  }
  return true;
}

function sanitizeManifestId(input) {
  const collapsed = String(input)
    .replace(/\s+/g, '-')
    .replace(/[\/\\]/g, '-')
    .replace(/\.\.+/g, '-')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '');
  return collapsed.slice(0, 128) || 'untitled-deck';
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

async function newestMtime(source) {
  const stats = await stat(source);
  return Math.floor(stats.mtimeMs);
}

function dirname2(p) {
  const parts = p.split('/');
  parts.pop();
  return parts.join('/');
}

function joinPath(base, rel) {
  const parts = base.split('/');
  parts.pop();
  for (const part of String(rel).replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return rel;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

// ──────────────────────────────────────────────────────────────────────
// Section walker (balanced tag scanner) — used by split-mode for
// reveal/impress/html-ppt-skill/deck-stage.
// ──────────────────────────────────────────────────────────────────────

function findTopLevelBlocks(html, tagName, matchAttrs) {
  // matchAttrs: optional fn(attributes_string) → boolean. If null, accept all.
  const blocks = [];
  const tag = tagName.toLowerCase();
  const openRe = new RegExp(`<${tag}\\b([^>]*)>`, 'gi');
  const closeRe = new RegExp(`</${tag}\\s*>`, 'gi');

  let depth = 0;
  let blockStart = -1;
  let blockAttrs = '';
  let i = 0;
  while (i < html.length) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const oMatch = openRe.exec(html);
    const cMatch = closeRe.exec(html);
    const oIdx = oMatch ? oMatch.index : Infinity;
    const cIdx = cMatch ? cMatch.index : Infinity;
    if (oIdx === Infinity && cIdx === Infinity) break;
    if (oIdx < cIdx) {
      if (depth === 0) {
        const attrs = oMatch[1] || '';
        if (!matchAttrs || matchAttrs(attrs)) {
          blockStart = oIdx;
          blockAttrs = attrs;
          depth = 1;
        } else {
          depth = 1;
          blockStart = -1;
        }
      } else {
        depth += 1;
      }
      i = oIdx + oMatch[0].length;
    } else {
      depth -= 1;
      if (depth === 0 && blockStart !== -1) {
        const end = cIdx + cMatch[0].length;
        blocks.push({
          start: blockStart,
          end,
          attrs: blockAttrs,
          inner: html.slice(blockStart + blockAttrs.length + tag.length + 2, cIdx),
          outer: html.slice(blockStart, end),
        });
        blockStart = -1;
        blockAttrs = '';
      }
      if (depth < 0) depth = 0;
      i = cIdx + cMatch[0].length;
    }
  }
  return blocks;
}

function hasClass(attrs, cls) {
  const re = new RegExp(`\\bclass\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');
  const m = re.exec(attrs);
  if (!m) return false;
  const list = (m[2] ?? m[3] ?? '').split(/\s+/);
  return list.includes(cls);
}

function readAttr(attrs, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');
  const m = re.exec(attrs);
  if (!m) return null;
  return m[2] ?? m[3] ?? null;
}

function firstH1Text(html) {
  // Try h1 → h2 → h3 in order (reveal.js demos heavily use <h2>/<h3>;
  // lewislulu and impress use <h1>; both work).
  for (const tag of ['h1', 'h2', 'h3']) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const m = re.exec(html);
    if (!m) continue;
    const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return null;
}

function extractHead(html) {
  const m = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html);
  return m ? m[1] : '';
}

export function extractHtmlAttrs(html) {
  const m = /<html\b([^>]*)>/i.exec(html);
  return m ? m[1].trim() : '';
}

export function extractBodyAttrs(html) {
  const m = /<body\b([^>]*)>/i.exec(html);
  return m ? m[1].trim() : '';
}

function stripRuntimeScripts(headOrHtml) {
  return headOrHtml
    .replace(/<script\b[^>]*\bsrc\s*=\s*("([^"]*runtime(\.[a-z]+)*\.js)"|'([^']*runtime(\.[a-z]+)*\.js)')[^>]*>\s*<\/script>/gi, '')
    .replace(/<script\b[^>]*\bsrc\s*=\s*("([^"]*fx-runtime\.js)"|'([^']*fx-runtime\.js)')[^>]*>\s*<\/script>/gi, '')
    .replace(/<script\b[^>]*\bsrc\s*=\s*("([^"]*deck-stage\.js)"|'([^']*deck-stage\.js)')[^>]*>\s*<\/script>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?customElements\.define\s*\(\s*['"](deck-stage|deck-slide)['"][\s\S]*?<\/script>/gi, '');
}

// Hide inline speaker-notes elements after the runtime that originally hid
// them (reveal.js / lewislulu runtime.js / huashu deck-stage) is stripped in
// split mode. Without this, source-embedded <aside class="notes"> /
// <div class="notes"> blocks become audience-visible chrome.
const HIDE_INLINE_NOTES_STYLE = '<style data-injected-by="slidestage-pack">aside.notes,aside.speaker-notes,div.notes,div.speaker-notes,template#notes,template#speaker-notes{display:none!important}</style>';

function buildSlidePage({ pageTitle, head, body, htmlAttrs, bodyAttrs }) {
  const hasCharset = /<meta\b[^>]*\bcharset\s*=/i.test(head);
  const hasTitle = /<title\b/i.test(head);
  const extraHead = [
    hasCharset ? '' : '    <meta charset="utf-8" />',
    !hasTitle && pageTitle ? `    <title>${escapeHtml(pageTitle)}</title>` : '',
  ].filter(Boolean).join('\n');
  const htmlOpen = htmlAttrs ? `<html ${htmlAttrs}>` : '<html>';
  const bodyOpen = bodyAttrs ? `<body ${bodyAttrs}>` : '<body>';
  return `<!doctype html>
${htmlOpen}
  <head>
${extraHead}
${head}
    ${HIDE_INLINE_NOTES_STYLE}
  </head>
  ${bodyOpen}
${body}
  </body>
</html>
`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  }[c]));
}

function pad2(n) { return String(n).padStart(2, '0'); }

// ──────────────────────────────────────────────────────────────────────
// Speaker notes (mirrors SlideStageLite/packages/core/src/converter/speakerNotes.ts)
//
// Convention-over-configuration — first non-empty hit wins:
//   1. `speaker-notes/<basename>.md`     (huashu-design convention)
//   2. `notes/<basename>.md`             (common alternative)
//   3. `<slide-dir><basename>.notes.md`  (co-located attachment)
//   4. `<aside class="(speaker-)?notes">…</aside>`  (reveal.js style)
//      `<template id="(speaker-)?notes">…</template>` (scripted variants)
//
// Notes are UTF-8 markdown text, CRLF→LF normalized, trimmed, capped at
// MAX_NOTES_CHARS so a runaway markdown file can't bloat the manifest.
// Inline HTML tags are stripped + whitespace collapsed.
// ──────────────────────────────────────────────────────────────────────

export const MAX_NOTES_CHARS = 16_384;

function trimNotes(raw) {
  const normalized = String(raw).replace(/\r\n/g, '\n').trim();
  if (!normalized) return null;
  return normalized.length > MAX_NOTES_CHARS
    ? normalized.slice(0, MAX_NOTES_CHARS)
    : normalized;
}

function basenameWithoutExt(filePath) {
  const last = filePath.split('/').pop() ?? filePath;
  return last.replace(/\.[^./]+$/, '');
}

function dirnameWithSlash(filePath) {
  const idx = filePath.lastIndexOf('/');
  return idx === -1 ? '' : filePath.slice(0, idx + 1);
}

export function extractInlineNotes(html) {
  if (!html) return null;
  // Order matters: <aside> first (reveal.js + lewislulu presenter-mode style),
  // then <template> (scripted variants), then <div class="notes">
  // (lewislulu deck.html / single-page/cover.html default style). The div
  // pattern is non-greedy and will match the *first* closing </div>; if a
  // notes block contains nested <div>s the match will be truncated, but
  // lewislulu's default authoring style is a single flat paragraph.
  const candidates = [
    /<aside[^>]*class\s*=\s*["'][^"']*\b(?:speaker-)?notes\b[^"']*["'][^>]*>([\s\S]*?)<\/aside>/i,
    /<template[^>]*id\s*=\s*["'](?:speaker-notes|notes)["'][^>]*>([\s\S]*?)<\/template>/i,
    /<div[^>]*class\s*=\s*["'][^"']*\b(?:speaker-)?notes\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ];
  for (const rx of candidates) {
    const match = rx.exec(html);
    if (!match) continue;
    const stripped = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const trimmed = trimNotes(stripped);
    if (trimmed) return trimmed;
  }
  return null;
}

export function findSlideNotes(entries, slideFile) {
  const base = basenameWithoutExt(slideFile);
  const dir = dirnameWithSlash(slideFile);

  const sidecarPaths = [
    `speaker-notes/${base}.md`,
    `notes/${base}.md`,
    `${dir}${base}.notes.md`,
  ];
  for (const path of sidecarPaths) {
    const bytes = entries.get(path);
    if (!bytes) continue;
    const text = trimNotes(decodeUtf8(bytes));
    if (text) return text;
  }

  const html = entries.get(slideFile);
  if (html) {
    const inline = extractInlineNotes(decodeUtf8(html));
    if (inline) return inline;
  }

  return null;
}

// ──────────────────────────────────────────────────────────────────────
// Mode dispatchers
// ──────────────────────────────────────────────────────────────────────

function dispatchPassthrough(entries) {
  const manifestBytes = entries.get('manifest.json');
  if (!manifestBytes) {
    throw new Error('[pack] passthrough requires manifest.json at the root');
  }
  let manifest;
  try {
    manifest = JSON.parse(decodeUtf8(manifestBytes));
  } catch (e) {
    throw new Error(`[pack] passthrough: manifest.json is not valid JSON (${e.message})`);
  }
  if (manifest.schema !== 'slidestage@1.0') {
    throw new Error(`[pack] passthrough: manifest schema is "${manifest.schema}", expected "slidestage@1.0"`);
  }
  const packEntries = new Map();
  for (const [path, value] of entries) {
    if (path === 'manifest.json') continue;
    packEntries.set(path, value);
  }
  return { manifest, packEntries, warnings: [], architecture: manifest.architecture };
}

function dispatchSingle(entries, rootHtml) {
  const html = decodeUtf8(entries.get(rootHtml));
  const title = readTitle(html) || firstH1Text(html);
  const hasScripts = /<script\b/i.test(html);
  const slide = {
    index: 1,
    id: 'root',
    label: title || 'Slide 1',
    file: rootHtml,
    thumbnail: null,
    notes: findSlideNotes(entries, rootHtml),
  };
  const packEntries = new Map();
  for (const [path, value] of entries) packEntries.set(path, value);
  const compat = hasScripts
    ? { requires: ['same-origin-storage', 'broadcast-channel'], notes: 'Wrapped HTML contains <script> blocks; granting these capabilities lets the embedded code run.' }
    : null;
  return {
    slides: [slide],
    packEntries,
    architecture: 'single-file-html',
    pageTitle: title || null,
    compat,
    warnings: [],
  };
}

function dispatchWrap(entries, rootHtml, sniffKind) {
  // Same as single but always with compat.requires populated and a more
  // descriptive label.
  const html = decodeUtf8(entries.get(rootHtml));
  const title = readTitle(html) || firstH1Text(html);
  const slide = {
    index: 1,
    id: 'root',
    label: title || `${sniffKind} wrapper`,
    file: rootHtml,
    thumbnail: null,
    notes: findSlideNotes(entries, rootHtml),
  };
  const packEntries = new Map();
  for (const [path, value] of entries) packEntries.set(path, value);
  const compat = {
    requires: ['same-origin-storage', 'broadcast-channel', 'window-open'],
    notes: `Original ${sniffKind} runtime is preserved inside an iframe. Trust these capabilities so the source renders faithfully.`,
  };
  return {
    slides: [slide],
    packEntries,
    architecture: 'single-file-html',
    pageTitle: title || null,
    compat,
    warnings: [],
  };
}

function dispatchSplitInline(entries, rootHtml) {
  const html = decodeUtf8(entries.get(rootHtml));
  const head = stripRuntimeScripts(extractHead(html));
  const htmlAttrs = extractHtmlAttrs(html);
  const bodyAttrs = extractBodyAttrs(html);
  const sections = findTopLevelBlocks(html, 'section', (attrs) => hasClass(attrs, 'slide'));
  const warnings = [];
  if (sections.length === 0) {
    warnings.push('[split:inline] no <section class="slide"> found');
    return { slides: [], packEntries: new Map(), warnings };
  }
  const baseDir = dirname2(rootHtml);
  const packEntries = new Map();
  for (const [path, value] of entries) {
    if (path === rootHtml) continue;
    packEntries.set(path, value);
  }
  let anyInlineScript = false;
  const slides = sections.map((sec, i) => {
    const idx = i + 1;
    const label = readAttr(sec.attrs, 'data-title') || firstH1Text(sec.inner) || `Slide ${idx}`;
    const slug = slugify(label) || `slide-${idx}`;
    const filename = `${pad2(idx)}-${slug}.html`;
    const filePath = baseDir ? `${baseDir}/${filename}` : filename;
    if (/<script\b/i.test(sec.outer)) anyInlineScript = true;
    const page = buildSlidePage({
      pageTitle: label,
      head,
      body: `    ${sec.outer}\n`,
      htmlAttrs,
      bodyAttrs,
    });
    packEntries.set(filePath, bytesFromString(page));
    return {
      index: idx,
      id: slug || `slide-${idx}`,
      label,
      file: filePath,
      thumbnail: null,
      notes: extractInlineNotes(sec.outer) ?? findSlideNotes(entries, filePath),
    };
  });
  const compat = anyInlineScript
    ? {
        requires: ['same-origin-storage'],
        notes: 'One or more split slides contain inline <script> blocks. Granting same-origin-storage lets that author code run inside the platform iframe.',
      }
    : null;
  return { slides, packEntries, warnings, compat };
}

function dispatchSplitReveal(entries, rootHtml) {
  const html = decodeUtf8(entries.get(rootHtml));
  // reveal: <div class="reveal"><div class="slides">...<section>...</section></div></div>
  // Use balanced tag scanner because non-greedy regex breaks on nested
  // <div>s inside slides (vertical stacks, code blocks, demos).
  const revealBlocks = findTopLevelBlocks(html, 'div', (attrs) => hasClass(attrs, 'reveal'));
  if (revealBlocks.length === 0) {
    return { slides: [], packEntries: new Map(), warnings: ['[split:reveal] could not locate <div class="reveal"> container'] };
  }
  const slidesBlocks = findTopLevelBlocks(revealBlocks[0].inner, 'div', (attrs) => hasClass(attrs, 'slides'));
  if (slidesBlocks.length === 0) {
    return { slides: [], packEntries: new Map(), warnings: ['[split:reveal] could not locate <div class="slides"> inside .reveal'] };
  }
  const inner = slidesBlocks[0].inner;
  const head = stripRuntimeScripts(extractHead(html));
  const htmlAttrs = extractHtmlAttrs(html);
  const bodyAttrs = extractBodyAttrs(html);
  const sections = findTopLevelBlocks(inner, 'section', null);
  if (sections.length === 0) {
    return { slides: [], packEntries: new Map(), warnings: ['[split:reveal] no <section> children inside .slides'] };
  }
  const baseDir = dirname2(rootHtml);
  const packEntries = new Map();
  for (const [path, value] of entries) {
    if (path === rootHtml) continue;
    packEntries.set(path, value);
  }
  let anyInlineScript = false;
  const slides = sections.map((sec, i) => {
    const idx = i + 1;
    const label = firstH1Text(sec.inner) || readAttr(sec.attrs, 'data-title') || `Slide ${idx}`;
    const slug = slugify(label) || `slide-${idx}`;
    const filename = `${pad2(idx)}-${slug}.html`;
    const filePath = baseDir ? `${baseDir}/${filename}` : filename;
    if (/<script\b/i.test(sec.outer)) anyInlineScript = true;
    const page = buildSlidePage({
      pageTitle: label,
      head,
      body: `    <div class="reveal"><div class="slides">${sec.outer}</div></div>\n`,
      htmlAttrs,
      bodyAttrs,
    });
    packEntries.set(filePath, bytesFromString(page));
    return {
      index: idx,
      id: slug || `slide-${idx}`,
      label,
      file: filePath,
      thumbnail: null,
      notes: extractInlineNotes(sec.outer) ?? findSlideNotes(entries, filePath),
    };
  });
  const compat = anyInlineScript
    ? {
        requires: ['same-origin-storage'],
        notes: 'One or more split slides contain inline <script> blocks. Granting same-origin-storage lets that author code run inside the platform iframe.',
      }
    : null;
  return {
    slides,
    packEntries,
    warnings: ['[split:reveal] fragments and transitions are lost in split mode; use --mode wrap to preserve them'],
    compat,
  };
}

function dispatchSplitImpress(entries, rootHtml) {
  const html = decodeUtf8(entries.get(rootHtml));
  const head = stripRuntimeScripts(extractHead(html));
  const htmlAttrs = extractHtmlAttrs(html);
  const bodyAttrs = extractBodyAttrs(html);
  // Strip the outer <div id="impress"> wrapper so step divs are top-level.
  const impressMatch = /<div\b[^>]*\bid\s*=\s*("impress"|'impress')[^>]*>([\s\S]*)<\/div>/i.exec(html);
  const scope = impressMatch ? impressMatch[2] : html;
  const steps = findTopLevelBlocks(scope, 'div', (attrs) => hasClass(attrs, 'step'));
  if (steps.length === 0) {
    return { slides: [], packEntries: new Map(), warnings: ['[split:impress] no <div class="step"> found'] };
  }
  const baseDir = dirname2(rootHtml);
  const packEntries = new Map();
  for (const [path, value] of entries) {
    if (path === rootHtml) continue;
    packEntries.set(path, value);
  }
  let anyInlineScript = false;
  const slides = steps.map((step, i) => {
    const idx = i + 1;
    const stepId = readAttr(step.attrs, 'id');
    const label = firstH1Text(step.inner) || stepId || `Step ${idx}`;
    const slug = slugify(label) || `step-${idx}`;
    const filename = `${pad2(idx)}-${slug}.html`;
    const filePath = baseDir ? `${baseDir}/${filename}` : filename;
    if (/<script\b/i.test(step.outer)) anyInlineScript = true;
    const page = buildSlidePage({
      pageTitle: label,
      head,
      body: `    <div id="impress">${step.outer}</div>\n`,
      htmlAttrs,
      bodyAttrs,
    });
    packEntries.set(filePath, bytesFromString(page));
    return {
      index: idx,
      id: stepId || slug || `step-${idx}`,
      label,
      file: filePath,
      thumbnail: null,
      notes: extractInlineNotes(step.outer) ?? findSlideNotes(entries, filePath),
    };
  });
  const compat = anyInlineScript
    ? {
        requires: ['same-origin-storage'],
        notes: 'One or more split slides contain inline <script> blocks. Granting same-origin-storage lets that author code run inside the platform iframe.',
      }
    : null;
  return {
    slides,
    packEntries,
    warnings: ['[split:impress] 3D camera transitions are lost; use --mode wrap to preserve the impress experience'],
    compat,
  };
}

function dispatchSplitWebComponent(entries, rootHtml) {
  const html = decodeUtf8(entries.get(rootHtml));
  const head = stripRuntimeScripts(extractHead(html));
  const htmlAttrs = extractHtmlAttrs(html);
  const bodyAttrs = extractBodyAttrs(html);
  const slidesBlocks = findTopLevelBlocks(html, 'deck-slide', null);
  if (slidesBlocks.length === 0) {
    return { slides: [], packEntries: new Map(), warnings: ['[split:webcomponent] no <deck-slide> found'] };
  }
  const baseDir = dirname2(rootHtml);
  const packEntries = new Map();
  for (const [path, value] of entries) {
    if (path === rootHtml) continue;
    packEntries.set(path, value);
  }
  let anyInlineScript = false;
  const slides = slidesBlocks.map((block, i) => {
    const idx = i + 1;
    const label = readAttr(block.attrs, 'data-screen-label')
      || readAttr(block.attrs, 'data-label')
      || firstH1Text(block.inner)
      || `Slide ${idx}`;
    const slug = slugify(label) || `slide-${idx}`;
    const filename = `${pad2(idx)}-${slug}.html`;
    const filePath = baseDir ? `${baseDir}/${filename}` : filename;
    if (/<script\b/i.test(block.outer)) anyInlineScript = true;
    const page = buildSlidePage({
      pageTitle: label,
      head,
      body: `    ${block.outer}\n`,
      htmlAttrs,
      bodyAttrs,
    });
    packEntries.set(filePath, bytesFromString(page));
    return {
      index: idx,
      id: slug || `slide-${idx}`,
      label,
      file: filePath,
      thumbnail: null,
      notes: extractInlineNotes(block.outer) ?? findSlideNotes(entries, filePath),
    };
  });
  const compat = anyInlineScript
    ? {
        requires: ['same-origin-storage'],
        notes: 'One or more split slides contain inline <script> blocks. Granting same-origin-storage lets that author code run inside the platform iframe.',
      }
    : null;
  return { slides, packEntries, warnings: [], compat };
}

function dispatchSplitRouter(entries, rootHtml) {
  const html = decodeUtf8(entries.get(rootHtml));
  const routerEntries = extractDeckManifestEntries(html);
  const warnings = [];
  if (routerEntries.length === 0) {
    return { slides: [], packEntries: new Map(), warnings: ['[split:router] window.DECK_MANIFEST is empty'] };
  }
  const packEntries = new Map();
  for (const [path, value] of entries) {
    if (path === rootHtml) continue;
    packEntries.set(path, value);
  }
  const slides = [];
  routerEntries.forEach((entry, i) => {
    const fileRel = entry?.file;
    if (!fileRel) {
      warnings.push(`[split:router] entry ${i + 1} missing "file"`);
      return;
    }
    const filePath = joinPath(rootHtml, fileRel);
    if (!entries.has(filePath)) {
      warnings.push(`[split:router] referenced file not found: ${filePath}`);
      return;
    }
    const label = (entry.label || '').trim() || `Slide ${slides.length + 1}`;
    const slug = slugify(label) || `slide-${slides.length + 1}`;
    slides.push({
      index: slides.length + 1,
      id: slug,
      label,
      file: filePath,
      thumbnail: null,
      notes: findSlideNotes(entries, filePath),
    });
  });
  return { slides, packEntries, warnings };
}

// ──────────────────────────────────────────────────────────────────────
// Thumbnails + Fallback (optional)
// ──────────────────────────────────────────────────────────────────────

async function generateThumbnails({ packEntries, slides, dimensions, verbose }) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('[pack] --thumbnails requires `playwright`. Install: npm i playwright && npx playwright install chromium');
  }
  const tmpDir = await mkTempDir();
  for (const [path, bytes] of packEntries) {
    const abs = `${tmpDir}/${path}`;
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
  }
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      viewport: { width: dimensions.width, height: dimensions.height },
      deviceScaleFactor: 0.5,
    });
    for (const slide of slides) {
      const page = await ctx.newPage();
      const url = `file://${tmpDir}/${slide.file}`;
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
      } catch {
        try { await page.goto(url, { waitUntil: 'load', timeout: 15000 }); } catch {}
      }
      await page.waitForTimeout(800);
      const shot = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 480, height: 270 } });
      const thumbPath = `thumbnails/${pad2(slide.index)}.png`;
      packEntries.set(thumbPath, new Uint8Array(shot));
      slide.thumbnail = thumbPath;
      await page.close();
      if (verbose) process.stderr.write(`[pack] thumbnail ${thumbPath} for slide ${slide.index}\n`);
    }
  } finally {
    await browser.close();
  }
}

async function mkTempDir() {
  const { tmpdir } = await import('node:os');
  const { mkdtemp } = await import('node:fs/promises');
  return mkdtemp(`${tmpdir()}/slidestage-pack-`);
}

function buildFallbackIndex(slides, dimensions) {
  const manifestLines = slides
    .map((s) => `    { file: "${s.file}", label: ${JSON.stringify(s.label)} }`)
    .join(',\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(slides[0]?.label || 'Deck')}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%;background:#0a0a0a;overflow:hidden;font-family:-apple-system,system-ui,sans-serif}
  #stage{position:fixed;top:50%;left:50%;transform-origin:top left;background:#fff;box-shadow:0 10px 60px rgba(0,0,0,.4)}
  iframe{width:100%;height:100%;border:0;display:block;background:#fff}
  .counter{position:fixed;bottom:20px;right:20px;background:rgba(0,0,0,.65);color:#fff;padding:6px 14px;border-radius:999px;font-size:13px;z-index:100;opacity:.7;font-variant-numeric:tabular-nums}
  .nav-zone{position:fixed;top:0;bottom:0;width:15%;cursor:pointer;z-index:50}
  .nav-zone.left{left:0}.nav-zone.right{right:0}
</style>
</head>
<body>
<div id="stage"><iframe id="frame" src="about:blank"></iframe></div>
<div class="nav-zone left" id="navL"></div>
<div class="nav-zone right" id="navR"></div>
<div class="counter" id="counter">1 / 1</div>
<script>
window.DECK_MANIFEST=[
${manifestLines}
];
window.DECK_WIDTH=${dimensions.width};
window.DECK_HEIGHT=${dimensions.height};
(function(){
  var W=window.DECK_WIDTH,H=window.DECK_HEIGHT,deck=window.DECK_MANIFEST||[];
  var stage=document.getElementById('stage'),frame=document.getElementById('frame'),counter=document.getElementById('counter');
  var current=0;
  stage.style.width=W+'px';stage.style.height=H+'px';
  function fit(){var s=Math.min(window.innerWidth/W,window.innerHeight/H);
    stage.style.transform='translate('+((window.innerWidth-W*s)/2)+'px,'+((window.innerHeight-H*s)/2)+'px) scale('+s+')';
    stage.style.top='0';stage.style.left='0';}
  function show(i){if(i<0||i>=deck.length)return;current=i;frame.src=deck[i].file;
    counter.textContent=(i+1)+' / '+deck.length;
    if(location.hash!=='#'+(i+1))history.replaceState(null,'','#'+(i+1));}
  document.addEventListener('keydown',function(e){
    if(['INPUT','TEXTAREA'].includes(e.target.tagName))return;
    switch(e.key){
      case 'ArrowRight':case ' ':case 'PageDown':e.preventDefault();show(Math.min(current+1,deck.length-1));break;
      case 'ArrowLeft':case 'PageUp':e.preventDefault();show(Math.max(current-1,0));break;
      case 'Home':show(0);break;case 'End':show(deck.length-1);break;
    }
  });
  document.getElementById('navL').onclick=function(){show(Math.max(current-1,0));};
  document.getElementById('navR').onclick=function(){show(Math.min(current+1,deck.length-1));};
  window.addEventListener('resize',fit);
  var hashMatch=location.hash.match(/^#(\\d+)$/);
  if(hashMatch)current=Math.min(parseInt(hashMatch[1],10)-1,deck.length-1);
  fit();show(current);
})();
</script>
</body>
</html>
`;
}

// ──────────────────────────────────────────────────────────────────────
// Manifest assembly
// ──────────────────────────────────────────────────────────────────────

function buildManifest({
  args, sniffKind, mode, slides, architecture, compat, dimensions,
  fallbackIncluded, packEntries, createdAtIso, title,
}) {
  const id = sanitizeManifestId(
    args.id
      || slugify(args.title || title || basename(args.src, extname(args.src)))
      || `deck-${createdAtIso.slice(0, 10)}`,
  );

  const totalAssetSize = Array.from(packEntries.entries())
    .filter(([p]) => p !== 'manifest.json')
    .reduce((sum, [, v]) => sum + v.byteLength, 0);
  const assetFiles = Array.from(packEntries.keys())
    .filter((p) => p !== 'manifest.json' && !slides.some((s) => s.file === p))
    .sort()
    .map((p) => ({ path: p, size: packEntries.get(p).byteLength, type: guessAssetType(p) }));

  const manifest = {
    schema: 'slidestage@1.0',
    id,
    version: args.version || '1.0.0',
    title: args.title || title || id,
    subtitle: null,
    author: args.author || null,
    description: null,
    createdAt: createdAtIso,
    updatedAt: createdAtIso,
    architecture,
    dimensions,
    totalSlides: slides.length,
    slides,
    fonts: [],
    tokens: {},
    assets: {
      totalSize: totalAssetSize,
      count: assetFiles.length,
      files: assetFiles,
    },
    runtime: {
      presenterTools: 'platform',
      fallbackEntry: fallbackIncluded ? 'index.html' : null,
      capabilities: ['keyboard-nav', 'speaker-notes', 'annotation-overlay'],
    },
    platform: {
      minSchemaVersion: '1.0',
      compatibleArchitectures: [architecture],
    },
    provenance: {
      sourceKind: sniffKind,
      conversionMode: mode,
      converter: {
        name: PACKER_NAME,
        version: PACKER_VERSION,
      },
    },
    stats: {
      packedAt: createdAtIso,
      packerVersion: `${PACKER_NAME}@${PACKER_VERSION}`,
    },
  };

  if (compat && compat.requires && compat.requires.length > 0) {
    manifest.compat = {
      requires: compat.requires,
      notes: compat.notes || '',
    };
  }

  return manifest;
}

function guessAssetType(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'].includes(ext)) return 'image';
  if (['woff', 'woff2', 'ttf', 'otf'].includes(ext)) return 'font';
  if (ext === 'css') return 'style';
  if (['js', 'mjs'].includes(ext)) return 'script';
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return 'audio';
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  if (ext === 'html' || ext === 'htm') return 'html';
  return 'other';
}

// ──────────────────────────────────────────────────────────────────────
// Pack
// ──────────────────────────────────────────────────────────────────────

async function packZip(manifest, packEntries) {
  const fflate = await loadFflate();
  const mtime = Date.parse(manifest.createdAt) || 0;
  const files = {};
  const sortedKeys = Array.from(packEntries.keys()).sort();
  for (const path of sortedKeys) {
    if (path === 'manifest.json') continue;
    files[path] = [coerceUint8(packEntries.get(path)), { mtime }];
  }
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  files['manifest.json'] = [encoder.encode(manifestJson), { mtime }];
  return fflate.zipSync(files, { level: 9, mtime });
}

function coerceUint8(view) {
  if (Object.getPrototypeOf(view) === Uint8Array.prototype) return view;
  return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}

// ──────────────────────────────────────────────────────────────────────
// Validation (pre-pack)
// ──────────────────────────────────────────────────────────────────────

function validateBeforePack({ slides, packEntries }) {
  const errors = [];
  if (slides.length === 0) errors.push('no slides to pack');
  if (slides.length > SIZE_LIMITS.totalSlidesMax) {
    errors.push(`too many slides: ${slides.length} > ${SIZE_LIMITS.totalSlidesMax}`);
  }
  for (const slide of slides) {
    if (!safeRelPath(slide.file)) errors.push(`unsafe slide file path: ${slide.file}`);
    if (!packEntries.has(slide.file)) errors.push(`missing slide file in pack: ${slide.file}`);
    const bytes = packEntries.get(slide.file);
    if (bytes && bytes.byteLength > SIZE_LIMITS.slideHtmlMax) {
      errors.push(`slide HTML too large: ${slide.file} (${bytes.byteLength} > ${SIZE_LIMITS.slideHtmlMax})`);
    }
  }
  for (const [path, bytes] of packEntries) {
    if (!safeRelPath(path)) errors.push(`unsafe entry path: ${path}`);
    if (bytes.byteLength > SIZE_LIMITS.entryMax) {
      errors.push(`entry too large: ${path} (${bytes.byteLength} > ${SIZE_LIMITS.entryMax})`);
    }
  }
  return errors;
}

// ──────────────────────────────────────────────────────────────────────
// Strict-schema validation (opt-in, requires `@slidestage/spec`)
// ──────────────────────────────────────────────────────────────────────

/**
 * Dynamically import the canonical `@slidestage/spec` package. Hard-fails
 * with an actionable error if the package is not resolvable from this
 * script's import path — this matches the `--strict-schema` contract
 * ("opt in, but if you opt in, we don't silently fall back").
 *
 * The package is only available on npm once Phase B.5 of the ecosystem
 * plan publishes it. Until then, `dev` environments can wire it in via
 * `pnpm link --global @slidestage/spec` from the SlideStageLite checkout
 * (`packages/spec`). See `tests/test_strict_schema.mjs` for the test
 * harness's setup notes.
 */
async function loadSpecOrFail() {
  try {
    return await import('@slidestage/spec');
  } catch (e) {
    throw new Error(
      '[pack] --strict-schema requires `@slidestage/spec` to be importable.\n'
      + '       Install: `npm i -D @slidestage/spec` (once published to npm)\n'
      + '       Dev: `pnpm link --global @slidestage/spec` from SlideStageLite/packages/spec.\n'
      + `       Underlying error: ${e?.message ?? String(e)}`,
    );
  }
}

/**
 * Run the canonical spec validator over a packed manifest + entry map.
 *
 * 1. `spec.parseManifest(manifest)` — Zod schema check. Throws on any
 *    structural defect (bad schema literal, missing required field,
 *    wrong architecture enum, illegal id, etc.).
 * 2. `spec.SIZE_LIMITS` — re-runs the 5 pack-internal size limits plus
 *    `decompressedTotalMax` (1 GB cumulative). The annotation limits
 *    (`annotationStrokesPerSlideMax`, `annotationPointsPerStrokeMax`)
 *    describe runtime annotation overlay data, which pack-time never
 *    produces, so they are not asserted here.
 * 3. `spec.MAX_NOTES_CHARS` — re-asserts the notes cap on every slide
 *    (pack already trims, but if a custom dispatcher slips through this
 *    catches it).
 *
 * Returns a list of additional warnings (currently always empty —
 * structural failure throws; this slot is reserved for future soft
 * advisories so callers can stay structurally compatible).
 */
function validateWithSpec(manifest, packEntries, spec) {
  spec.parseManifest(manifest);

  const limits = spec.SIZE_LIMITS;
  const errors = [];

  if (Array.isArray(manifest.slides) && manifest.slides.length > limits.totalSlidesMax) {
    errors.push(`too many slides: ${manifest.slides.length} > ${limits.totalSlidesMax}`);
  }

  let decompressedTotal = 0;
  for (const [path, bytes] of packEntries) {
    decompressedTotal += bytes.byteLength;
    if (bytes.byteLength > limits.entryMax) {
      errors.push(`entry too large: ${path} (${bytes.byteLength} > ${limits.entryMax})`);
    }
  }
  if (decompressedTotal > limits.decompressedTotalMax) {
    errors.push(
      `decompressed total too large: ${decompressedTotal} > ${limits.decompressedTotalMax}`,
    );
  }

  for (const slide of manifest.slides ?? []) {
    const bytes = packEntries.get(slide.file);
    if (bytes && bytes.byteLength > limits.slideHtmlMax) {
      errors.push(`slide HTML too large: ${slide.file} (${bytes.byteLength} > ${limits.slideHtmlMax})`);
    }
    if (typeof slide.notes === 'string' && slide.notes.length > spec.MAX_NOTES_CHARS) {
      errors.push(`slide notes too long: ${slide.file} (${slide.notes.length} > ${spec.MAX_NOTES_CHARS})`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`[pack] --strict-schema validation failed:\n  - ${errors.join('\n  - ')}`);
  }

  return [];
}

// ──────────────────────────────────────────────────────────────────────
// Core delegate (`--use-core`)
// ──────────────────────────────────────────────────────────────────────

/**
 * Try to lazily import `@slidestage/core/converter`. We only call this
 * inside the `--use-core` code path so the default (zero-dep) packer
 * has no static dependency on `@slidestage/core`.
 *
 * Resolution behaviour mirrors `loadSpecOrFail`: hard error with dev
 * install hints so opt-in users aren't surprised by a silent fallback
 * to the inline dispatch path (which would defeat the point of asking
 * for the canonical Lite converter behaviour).
 */
async function loadCoreOrFail() {
  try {
    return await import('@slidestage/core/converter');
  } catch (e) {
    throw new Error(
      '[pack] --use-core requires `@slidestage/core` to be importable.\n'
      + '       Install:\n'
      + '         - npm:  `npm i -D @slidestage/core@^0.1.1`\n'
      + '         - pnpm: `pnpm add -D @slidestage/core@^0.1.1`\n'
      + '       Dev (from a Lite checkout):\n'
      + '         cd ../SlideStageLite && pnpm -r build\n'
      + '         cd packages/core && pnpm pack --pack-destination /tmp\n'
      + '         cd -; npm install /tmp/slidestage-core-0.1.1.tgz --no-save\n'
      + `       Underlying error: ${e?.message ?? String(e)}`,
    );
  }
}

function formatConvertWarning(w) {
  // ConvertReport.warnings is a tagged union over kinds defined in
  // `@slidestage/core/converter/report.ts`. Render each kind to the
  // string shape pack already uses in its warnings[] channel so the
  // JSON summary and --strict gating stay consistent across paths.
  if (!w || typeof w !== 'object') return String(w ?? '');
  switch (w.kind) {
    case 'note':
      return `[core] ${w.message}`;
    case 'runtime-dropped':
      return `[core] runtime-dropped: ${w.reason}`;
    case 'fallback-mode':
      return `[core] fallback-mode: ${w.from} → ${w.to} (${w.reason})`;
    case 'router-missing-entry':
      return `[core] router missing entry: ${w.file}`;
    case 'mirror-skipped':
      return `[core] mirror skipped: ${w.url} (${w.reason})`;
    default:
      return `[core] ${JSON.stringify(w)}`;
  }
}

function modeForCore(mode) {
  // pack's 'auto' = "let sniffer pick". Core's ConvertOptions.mode is
  // optional; omitting it triggers `defaultModeBySniff[kind]` inside the
  // converter, which is exactly the semantic of pack's 'auto'.
  if (mode === 'auto' || !mode) return undefined;
  return mode;
}

/**
 * Pack a deck source by delegating to `@slidestage/core/converter`.
 *
 * Why: `@slidestage/core/converter` is the authoritative converter
 * (extracted in Phase C.1 + tested in C.2). Routing pack through it
 * lets agent skill users opt into "exactly what Lite would output" with
 * one flag, and gives Phase C.4 a real cross-validation harness without
 * us having to rewrite every dispatch* function in pack first.
 *
 * Non-goals (intentionally not supported when `--use-core` is set):
 * - `--thumbnails`: core does not own a Playwright renderer; pack's
 *   `generateThumbnails` operates on the post-dispatch packEntries map
 *   before zipping. Bolting that on top of a finished `.stage` would
 *   require unzip + rewrite + repack, which defeats the byte-equivalence
 *   point. Use the inline path or generate thumbnails in a separate
 *   step.
 * - `--fallback`: similarly pack-only post-processing
 *   (`buildFallbackIndex`).
 *
 * Both are rejected up front so users get a clear error rather than a
 * silent feature drop.
 */
async function packViaCoreDelegate(args) {
  if (args.thumbnails) {
    throw new Error(
      '[pack] --use-core is incompatible with --thumbnails (thumbnails are pack-only post-processing).',
    );
  }
  if (args.fallback) {
    throw new Error(
      '[pack] --use-core is incompatible with --fallback (fallback index is pack-only post-processing).',
    );
  }

  const core = await loadCoreOrFail();
  const sourcePath = resolve(args.src);
  if (!existsSync(sourcePath)) throw new Error(`[pack] source not found: ${sourcePath}`);

  const stats = await stat(sourcePath);
  if (stats.isDirectory()) {
    // Folder source: core has `convertFolderSource` for exactly this
    // shape. We reuse the same `readFolderEntries` from
    // detect_framework so file filtering (`.git`, `node_modules`, OS
    // noise) is identical to the inline path.
    const folderEntries = await (await import('./detect_framework.mjs')).readFolderEntries(sourcePath);
    const result = await core.convertFolderSource(
      {
        entries: folderEntries,
        name: basename(sourcePath),
        lastModified: args.createdAt ? Date.parse(args.createdAt) : Math.floor(stats.mtimeMs),
      },
      buildCoreConvertOptions(args),
    );
    return shapeCoreResult(result);
  }

  // File source (.html / .htm / .zip / .stage). Hand raw bytes to
  // core; its `normalizeSource` will unzip or wrap-single as needed.
  const rawBytes = await readFile(sourcePath);
  const bytes = new Uint8Array(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
  const result = await core.convertSource(
    {
      bytes,
      name: basename(sourcePath),
      lastModified: args.createdAt ? Date.parse(args.createdAt) : Math.floor(stats.mtimeMs),
    },
    buildCoreConvertOptions(args),
  );
  return shapeCoreResult(result);
}

function buildCoreConvertOptions(args) {
  const overrides = {};
  if (args.id) overrides.id = args.id;
  if (args.title) overrides.title = args.title;
  if (args.version) overrides.version = args.version;
  if (Number.isFinite(args.width)) overrides.width = args.width;
  if (Number.isFinite(args.height)) overrides.height = args.height;
  return {
    mode: modeForCore(args.mode),
    strict: !!args.strict,
    ...(Object.keys(overrides).length > 0 ? { manifestOverrides: overrides } : {}),
  };
}

function shapeCoreResult(result) {
  // Adapt core's ConvertResult to the shape pack's CLI / e2e harness
  // expects (manifest / zipBytes / warnings[] / mode / sniffKind).
  const warnings = (result.report?.warnings ?? []).map(formatConvertWarning);
  return {
    manifest: result.manifest,
    zipBytes: result.stage,
    warnings,
    mode: result.report?.mode ?? 'unknown',
    sniffKind: result.report?.sourceKind ?? 'unknown',
  };
}

// ──────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────

export async function packSlideStageFromSource(args) {
  // C3 opt-in: route the whole pipeline through @slidestage/core/converter
  // when the user explicitly asks via --use-core. Default path stays
  // 100% zero-dependency (preserves the agent-skill lifeline).
  if (args.useCore) {
    return packViaCoreDelegate(args);
  }

  const sourcePath = resolve(args.src);
  if (!existsSync(sourcePath)) throw new Error(`[pack] source not found: ${sourcePath}`);
  const entries = await loadEntries(sourcePath);
  const sniff = classify(entries);

  const createdAt = args.createdAt
    || new Date(Math.floor((await newestMtime(sourcePath)) / 1000) * 1000).toISOString();

  let mode = args.mode === 'auto' ? sniff.recommendedMode : args.mode;
  const warnings = [...sniff.warnings];
  const dimensions = { width: args.width, height: args.height };

  if (sniff.kind === 'empty') throw new Error('[pack] source contains no HTML and no manifest');
  if (sniff.kind === 'ambiguous') {
    throw new Error(
      '[pack] multiple top-level HTML files found and no index.html. '
      + 'Rename one to index.html or pre-zip the source with a clear root.',
    );
  }

  let dispatchResult;
  let architecture;
  let compat = null;
  let title = sniff.hints.title;

  if (sniff.kind === 'slidestage@1.0') {
    if (mode !== 'passthrough') {
      warnings.push(`[pack] source is slidestage@1.0; forcing mode=passthrough (was "${mode}")`);
      mode = 'passthrough';
    }
    const passthrough = dispatchPassthrough(entries);
    const manifest = passthrough.manifest;
    return finalize({
      manifest, packEntries: passthrough.packEntries, warnings, args, mode, sniffKind: sniff.kind,
    });
  }

  const rootHtml = sniff.rootHtml;
  if (!rootHtml) throw new Error('[pack] could not determine the root HTML file');

  if (mode === 'passthrough') {
    throw new Error('[pack] passthrough is only legal for slidestage@1.0 sources');
  }

  if (mode === 'single' || mode === 'wrap') {
    const which = mode === 'wrap' ? dispatchWrap(entries, rootHtml, sniff.kind) : dispatchSingle(entries, rootHtml);
    dispatchResult = which;
    architecture = which.architecture;
    compat = which.compat;
    title = which.pageTitle || title;
  } else if (mode === 'split') {
    let split;
    if (sniff.kind === 'inline-deck') split = dispatchSplitInline(entries, rootHtml);
    else if (sniff.kind === 'reveal') split = dispatchSplitReveal(entries, rootHtml);
    else if (sniff.kind === 'impress') split = dispatchSplitImpress(entries, rootHtml);
    else if (sniff.kind === 'webcomponent-deck') split = dispatchSplitWebComponent(entries, rootHtml);
    else if (sniff.kind === 'router-html') split = dispatchSplitRouter(entries, rootHtml);
    else {
      throw new Error(`[pack] split mode is not supported for kind "${sniff.kind}"; use --mode wrap or --mode single`);
    }
    warnings.push(...split.warnings);
    if (split.slides.length === 0) {
      warnings.push(`[pack] split produced no slides; falling back to wrap mode`);
      const wrap = dispatchWrap(entries, rootHtml, sniff.kind);
      dispatchResult = wrap;
      architecture = wrap.architecture;
      compat = wrap.compat;
      mode = 'wrap';
    } else {
      dispatchResult = split;
      architecture = 'multi-file';
      if (split.compat) compat = split.compat;
    }
  } else {
    throw new Error(`[pack] unknown mode: ${mode}`);
  }

  let { slides, packEntries } = dispatchResult;

  if (args.thumbnails) {
    await generateThumbnails({ packEntries, slides, dimensions, verbose: args.verbose });
  }

  let fallbackIncluded = false;
  if (args.fallback) {
    packEntries.set('index.html', bytesFromString(buildFallbackIndex(slides, dimensions)));
    fallbackIncluded = true;
  }

  const preErrors = validateBeforePack({ slides, packEntries });
  if (preErrors.length > 0) {
    throw new Error(`[pack] pre-pack validation failed:\n  - ${preErrors.join('\n  - ')}`);
  }

  const manifest = buildManifest({
    args,
    sniffKind: sniff.kind,
    mode,
    slides,
    architecture,
    compat,
    dimensions,
    fallbackIncluded,
    packEntries,
    createdAtIso: createdAt,
    title,
  });

  return finalize({ manifest, packEntries, warnings, args, mode, sniffKind: sniff.kind });
}

async function finalize({ manifest, packEntries, warnings, args, mode, sniffKind }) {
  if (args.strict && warnings.length > 0) {
    throw new Error(`[pack] strict mode: ${warnings.length} warning(s)\n  - ${warnings.join('\n  - ')}`);
  }

  // `--strict-schema` runs the canonical Zod manifest validator + the
  // 8-field spec SIZE_LIMITS (superset of pack's 5-field internal
  // limits). It runs BEFORE `packZip` so a structural defect is caught
  // without writing any bytes to disk.
  let packMaxLimit = SIZE_LIMITS.packMax;
  if (args.strictSchema) {
    const spec = await loadSpecOrFail();
    const extraWarnings = validateWithSpec(manifest, packEntries, spec);
    warnings.push(...extraWarnings);
    packMaxLimit = spec.SIZE_LIMITS.packMax;
  }

  const zipBytes = await packZip(manifest, packEntries);
  if (zipBytes.byteLength > packMaxLimit) {
    throw new Error(`[pack] output too large: ${zipBytes.byteLength} > ${packMaxLimit}`);
  }
  return { manifest, zipBytes, warnings, mode, sniffKind };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`[pack] ${e.message}\n\n${usage()}`);
    exit(4);
  }
  if (args.help || !args.src || !args.out) {
    process.stdout.write(usage());
    exit(args.help ? 0 : 4);
  }

  try {
    const { manifest, zipBytes, warnings, mode, sniffKind } = await packSlideStageFromSource(args);
    const outPath = resolve(args.out);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, zipBytes);

    const sha = await sha256(zipBytes);

    if (args.verbose) {
      process.stderr.write(`[pack] wrote ${outPath} (${zipBytes.byteLength} bytes)\n`);
      for (const w of warnings) process.stderr.write(`[pack] warn: ${w}\n`);
    }

    const summary = {
      out: outPath,
      bytes: zipBytes.byteLength,
      sha256: sha,
      slides: manifest.totalSlides,
      sourceKind: sniffKind,
      mode,
      warnings: warnings.length,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    exit(4);
  }
}

async function sha256(bytes) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(bytes).digest('hex');
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
  main();
}
