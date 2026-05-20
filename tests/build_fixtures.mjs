#!/usr/bin/env node
/**
 * build_fixtures.mjs — Regenerate every fixture under tests/fixtures/.
 *
 * Each fixture is a tiny but signature-complete sample of one framework so
 * detect_framework.mjs can classify it and pack_stage.mjs can pack it.
 *
 * Run:
 *   node tests/build_fixtures.mjs
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX_DIR = resolve(__dirname, 'fixtures');

async function write(relPath, content) {
  const abs = resolve(FIX_DIR, relPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content);
  process.stdout.write(`wrote ${relPath}\n`);
}

async function reset() {
  if (existsSync(FIX_DIR)) await rm(FIX_DIR, { recursive: true });
  await mkdir(FIX_DIR, { recursive: true });
}

// ──────────────────────────────────────────────────────────────────────
// reveal.js
// ──────────────────────────────────────────────────────────────────────

async function buildReveal() {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Reveal Basic</title>
  <link rel="stylesheet" href="reveal.css" />
</head>
<body>
  <div class="reveal">
    <div class="slides">
      <section>
        <h1>Hello</h1>
        <p>First reveal slide</p>
        <aside class="notes">Welcome the audience. Mention the three takeaways.</aside>
      </section>
      <section data-title="Second">
        <h1>Second</h1>
        <p>Second slide</p>
        <aside class="speaker-notes">Walk through the diagram left to right.</aside>
      </section>
      <section>
        <section><h1>Vertical 1</h1><p>Stacked</p></section>
        <section><h1>Vertical 2</h1><p>Below</p></section>
      </section>
    </div>
  </div>
  <script src="dist/reveal.js"></script>
  <script>Reveal.initialize({});</script>
</body>
</html>`;
  const css = `.reveal{font-family:sans-serif}aside.notes,aside.speaker-notes{display:none}`;
  const js = `// stub reveal\nwindow.Reveal={initialize:function(){}};`;
  await write('reveal-basic/index.html', html);
  await write('reveal-basic/reveal.css', css);
  await write('reveal-basic/dist/reveal.js', js);
}

// ──────────────────────────────────────────────────────────────────────
// impress.js
// ──────────────────────────────────────────────────────────────────────

async function buildImpress() {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Impress Basic</title>
  <link rel="stylesheet" href="impress.css" />
</head>
<body>
  <div id="impress">
    <div id="step-1" class="step" data-x="0" data-y="0"><h1>One</h1></div>
    <div id="step-2" class="step" data-x="1000" data-y="0"><h1>Two</h1></div>
    <div id="step-3" class="step" data-x="2000" data-y="500" data-rotate="90"><h1>Three</h1></div>
  </div>
  <script src="impress.js"></script>
  <script>impress().init();</script>
</body>
</html>`;
  const css = `.step{padding:48px}`;
  const js = `// stub impress\nwindow.impress=function(){return{init:function(){}}};`;
  await write('impress-basic/index.html', html);
  await write('impress-basic/impress.css', css);
  await write('impress-basic/impress.js', js);
}

// ──────────────────────────────────────────────────────────────────────
// html-ppt-skill (inline-deck)
// ──────────────────────────────────────────────────────────────────────

async function buildHtmlPpt() {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>HTML PPT Skill</title>
  <link rel="stylesheet" href="assets/theme.css" />
</head>
<body>
  <div class="deck" data-testid="inline-deck">
    <section class="slide" data-title="Cover"><h1>Cover</h1><p>First slide</p></section>
    <section class="slide" data-title="Two"><h1>Two</h1><p>Second slide</p></section>
    <section class="slide"><h1>Three</h1><p>Third slide</p></section>
  </div>
  <script src="assets/runtime.js"></script>
</body>
</html>`;
  const css = `.slide{display:none}.slide.is-active{display:block}`;
  const js = `(function(){var s=document.querySelectorAll('.slide');s.forEach(function(x,i){x.classList.toggle('is-active',i===0)});})();`;
  await write('html-ppt-skill/index.html', html);
  await write('html-ppt-skill/assets/theme.css', css);
  await write('html-ppt-skill/assets/runtime.js', js);
  // speaker-notes/<basename>.md sidecar — basename matches the synthesized
  // split-mode filename (`01-cover.html` → `speaker-notes/01-cover.md`).
  await write('html-ppt-skill/speaker-notes/01-cover.md',
    '# Cover\n\nGreet the audience and tee up the agenda.\n');
  await write('html-ppt-skill/speaker-notes/02-two.md',
    'Highlight the **growth** number. Pause for emphasis.\n');
}

// ──────────────────────────────────────────────────────────────────────
// huashu-design webcomponent (deck-stage)
// ──────────────────────────────────────────────────────────────────────

async function buildHuashuDeckStage() {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Huashu Deck Stage</title>
  <link rel="stylesheet" href="assets/theme.css" />
</head>
<body>
  <deck-stage data-testid="webcomponent-deck">
    <deck-slide data-screen-label="Cover"><h1>Cover</h1><p>WC slide 1</p></deck-slide>
    <deck-slide data-screen-label="Two">
      <h1>Two</h1>
      <p>WC slide 2</p>
      <template id="speaker-notes">Drive the analogy home with one concrete example.</template>
    </deck-slide>
  </deck-stage>
  <script src="assets/deck-stage.js"></script>
</body>
</html>`;
  const css = `deck-stage{display:block}deck-slide{display:none}deck-slide.is-active{display:block}`;
  const js = `
class DeckStage extends HTMLElement {
  connectedCallback() {
    var ss = this.querySelectorAll('deck-slide');
    ss.forEach(function(s,i){s.classList.toggle('is-active',i===0)});
  }
}
customElements.define('deck-stage', DeckStage);
class DeckSlide extends HTMLElement {}
customElements.define('deck-slide', DeckSlide);
`;
  await write('huashu-deckstage/index.html', html);
  await write('huashu-deckstage/assets/theme.css', css);
  await write('huashu-deckstage/assets/deck-stage.js', js);
  // notes/<basename>.md sidecar — matches the synthesized split-mode filename
  // (`01-cover.html` → `notes/01-cover.md`).
  await write('huashu-deckstage/notes/01-cover.md',
    'Open with the customer pain point before the solution.\n');
}

// ──────────────────────────────────────────────────────────────────────
// huashu-design router (window.DECK_MANIFEST)
// ──────────────────────────────────────────────────────────────────────

async function buildHuashuRouter() {
  const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Huashu Router</title>
</head>
<body>
  <main><p>Loading...</p></main>
  <script>
    window.DECK_MANIFEST = [
      { file: "slides/01-cover.html", label: "Cover" },
      { file: "slides/02-content.html", label: "Content" },
      { file: "slides/03-finale.html", label: "Finale" }
    ];
  </script>
</body>
</html>`;
  const slide = (title, body) => `<!doctype html>
<html><head><meta charset="utf-8"/><link rel="stylesheet" href="../shared/theme.css"/></head>
<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
  await write('huashu-router/deck_index.html', indexHtml);
  await write('huashu-router/shared/theme.css', `body{font-family:sans-serif}h1{font-size:96px}`);
  await write('huashu-router/slides/01-cover.html', slide('Cover', 'Router 1'));
  await write('huashu-router/slides/02-content.html', slide('Content', 'Router 2'));
  await write('huashu-router/slides/03-finale.html', slide('Finale', 'Router 3'));
  // <slide-dir>/<basename>.notes.md co-located sidecar
  await write('huashu-router/slides/01-cover.notes.md',
    'Pause for 2 seconds before clicking through. Build anticipation.\n');
  await write('huashu-router/slides/02-content.notes.md',
    'Three points. Hit each one in 30 seconds. Do not rabbit-hole.\n');
}

// ──────────────────────────────────────────────────────────────────────
// plain-html
// ──────────────────────────────────────────────────────────────────────

async function buildPlain() {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Plain Single Page</title>
  <style>body{display:grid;place-items:center;height:100vh;font-family:sans-serif}h1{font-size:96px}aside.notes{display:none}</style>
</head>
<body>
  <main><h1>Plain HTML</h1><p>No deck markup, no manifest.</p></main>
  <aside class="notes">Inline note on a plain single-file deck — extracted in single mode.</aside>
</body>
</html>`;
  await write('plain.html', html);
}

// ──────────────────────────────────────────────────────────────────────
// slidestage-passthrough (a real .stage built with fflate)
// ──────────────────────────────────────────────────────────────────────

async function buildSlideStagePassthrough() {
  let fflate;
  try { fflate = await import('fflate'); }
  catch {
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
      { index: 1, id: 'cover',   label: 'Cover',   file: 'slides/01-cover.html',   thumbnail: null, notes: null },
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
  await write('slidestage-passthrough.stage', zip);
}

// ──────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────

async function main() {
  await reset();
  await buildReveal();
  await buildImpress();
  await buildHtmlPpt();
  await buildHuashuDeckStage();
  await buildHuashuRouter();
  await buildPlain();
  await buildSlideStagePassthrough();
  process.stdout.write('\nDone.\n');
}

main().catch((e) => {
  process.stderr.write(`${e.stack || e.message}\n`);
  process.exit(1);
});
