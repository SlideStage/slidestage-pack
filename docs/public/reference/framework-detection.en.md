# HTML Deck Framework Detection

`slidestage-pack` detects the source deck before choosing a packaging mode. Detection order matters: the first matching rule wins.

## Detection order

1. `slidestage@1.0`
2. `webcomponent-deck`
3. `router-html`
4. `reveal`
5. `impress`
6. `inline-deck`
7. `plain-html`

## `slidestage@1.0`

Matches a root `manifest.json` with `schema === "slidestage@1.0"`.

Recommended mode: `passthrough`.

## `webcomponent-deck`

Matches `<deck-stage>`.

Recommended mode: `split`.

Common source: huashu-design Web Component decks.

## `router-html`

Matches `window.DECK_MANIFEST = [...]`.

Recommended mode: `split`.

Every manifest entry points to a slide HTML file inside the package root.

## `reveal`

Matches a `.reveal > .slides` container or a reveal.js script.

Recommended mode: `wrap`.

Use `split` only when you accept losing reveal runtime features.

## `impress`

Matches `#impress` or an impress.js script.

Recommended mode: `wrap`.

`split` loses 3D camera behavior and step transforms.

## `inline-deck`

Matches a `.deck` container with `.slide` sections, or common slide runtime scripts.

Recommended mode: `split`.

Each top-level slide section becomes one output slide.

## `plain-html`

Matches a single HTML entry that does not fit any other framework.

Recommended mode: `single`.

If scripts are present, the manifest should declare required capabilities.

## Root HTML lookup

When multiple top-level HTML files exist, the detector prefers names such as `index.html`, `deck.html`, `slides.html`, and `presentation.html`.

If no root can be chosen, the source is `ambiguous` and needs user input.
