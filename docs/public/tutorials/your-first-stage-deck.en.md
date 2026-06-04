# Create Your First `.stage` Deck

This tutorial packages a minimal HTML deck into a `.stage` file and verifies it for SlideStage Lite or Pro.

## Prerequisites

- Node.js 20 or newer.
- `slidestage-pack` scripts.
- An HTML deck folder.

## 1. Create a sample deck

Create `my-deck/index.html` with a `<div class="deck">` and one or more `<section class="slide">` elements.

Speaker notes can use `<aside class="notes">`.

## 2. Detect the framework

```bash
node scripts/detect_framework.mjs my-deck
```

For an inline deck, the result should include:

```json
{
  "kind": "inline-deck",
  "recommendedMode": "split"
}
```

## 3. Pack

```bash
node scripts/pack_stage.mjs --src my-deck --out my-deck.stage
```

The packer writes `manifest.json`, slide HTML files, assets, notes, and deterministic zip metadata.

## 4. Verify

```bash
node scripts/verify_stage.mjs my-deck.stage
```

Verification checks the zip, manifest, slide files, paths, sizes, and slide indexes.

## 5. Play or upload

Open the file in SlideStage Lite or upload it to SlideStage Pro.

For reveal.js or impress.js, prefer `wrap` mode unless you explicitly want static split slides.
