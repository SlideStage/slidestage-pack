# `.stage` Format Cheatsheet

> **Authoritative source:** The `.stage` (`slidestage@1.0`) container
> format is owned by the npm package
> [`@slidestage/spec`](https://github.com/SlideStage/SlideStageLite/tree/main/packages/spec)
> (source lives in the SlideStageLite monorepo at `packages/spec/`).
> Manifest schema (Zod), path safety, capability registry, error
> codes, size limits — all of that is defined there exactly once and
> consumed by the Lite player, the Pro server, and this pack skill.
>
> Pass `--strict-schema` to `pack_stage.mjs` (see `../SKILL.md`) to
> validate every produced manifest against the spec's Zod schema
> before writing the zip. The default (zero-dependency) path keeps the
> pack-internal `SIZE_LIMITS` / `MAX_NOTES_CHARS` literals (mirrored
> from the spec values) and only checks size + path safety.
>
> Pass `--use-core` to delegate the entire detect → split → wrap → pack
> pipeline to `@slidestage/core/converter`. With `--use-core` the
> packer behaves byte-for-byte like the Lite repo's `pnpm convert pack`
> (passthrough decks are even sha256-identical). Default mode keeps the
> 8 inline dispatchers as a zero-dep agent-skill lifeline. See the
> `--use-core` block in `../SKILL.md` for install and compat notes.

This page exists for **pack-specific** cheatsheet content the spec
README does not (and should not) cover: the on-disk layout the packer
emits, the speaker-notes lookup ladder, and a fingerprint reminder.
Everything else has moved to the spec.

---

## On-disk layout the packer produces

```
deck.stage
├── manifest.json                    # required
├── slides/                          # `slides[].file` is the source of truth — any path is fine
│   ├── 01-cover.html
│   ├── 01-cover.notes.md            # optional — co-located speaker notes (see § Speaker Notes)
│   └── 02-content.html
├── thumbnails/                      # optional, populated by --thumbnails
│   ├── 01.png
│   └── 02.png
├── shared/tokens.css                # optional shared CSS / fonts
├── assets/                          # optional media
├── assets/_mirror/<cat>/<hash>.<ext># written by SlideStageLite's `pnpm mirror` pass (not by pack)
├── speaker-notes/                   # optional — sidecar markdown by slide basename
│   └── 01-cover.md
├── notes/                           # optional — common alternative sidecar dir
│   └── 01-cover.md
├── index.html                       # optional local fallback, populated by --fallback
└── presenter_tools.js               # optional local fallback (ignored by platform)
```

Path rules (enforced by `@slidestage/spec`'s `normalizePackagePath`):

- `/` separators after normalization.
- Relative to package root, no leading `/`.
- No `..` segments.
- No NUL bytes / control chars.

The packer rejects any source that would produce a path the spec
would reject — there is no "loose" mode.

---

## Speaker Notes — convention over configuration

`slides[].notes` is a `string | null`. **Authors do not write manifest
notes by hand.** The packer (`pack_stage.mjs` here and `pnpm convert
pack` in Lite) walks this lookup ladder per slide, **first non-empty
wins**, and stops searching:

| # | Location | Format | Why |
| --- | --- | --- | --- |
| 1 | `speaker-notes/<basename>.md` | zip-root sidecar | huashu-design convention |
| 2 | `notes/<basename>.md` | zip-root sidecar | common alt |
| 3 | `<slide-dir>/<basename>.notes.md` | co-located sidecar | router / multi-file decks |
| 4 | `<aside class="(speaker-)?notes">`, `<template id="(speaker-)?notes">`, `<div class="(speaker-)?notes">` | inline inside slide HTML | reveal.js style |

`<basename>` = slide filename minus extension. For **split-mode**
slides the basename is the *synthesized* output name
(`01-cover.html` → `01-cover`), not the source `<section>` data-title.

Resolution rules (also enforced by the spec):

- UTF-8 markdown, CRLF → LF normalized.
- Trimmed before non-empty check.
- Trim to `MAX_NOTES_CHARS = 16_384` chars.
- Inline extraction strips HTML tags and collapses whitespace — to
  preserve markdown layout, use a sidecar.
- `passthrough` mode **does not re-extract**; whatever `notes` the
  original manifest carries is preserved as-is.

**Gotcha.** Split-mode generated slide HTML has no reveal / impress /
huashu runtime around it, so any inline `<aside class="notes">` would
become audience-visible chrome. Either move notes to a sidecar, or
keep them inline and add
`aside.notes, aside.speaker-notes { display: none }` to the source
head — `pack_stage.mjs` injects a `<style>` that does exactly this on
split-mode output.

---

## Fingerprint reminder

SlideStageLite keys all per-deck persistence (annotations, notes,
trust grants) by `sha256(zip bytes)`. For the packer that means:

- Fix every zip entry's mtime to `Date.parse(manifest.createdAt)`.
- Fix the global zip mtime to the same value.
- Sort entries by path before encoding.
- Do not write any timestamp-like field outside `manifest.json`.

`pack_stage.mjs` does all of this by default; `tests/run_tests.mjs`
asserts byte-reproducibility on every fixture. If you fork the packer
or invoke `fflate` directly, replicate the same recipe so a re-pack of
identical bytes keeps the user's runtime state.

---

## See also

- `../SKILL.md` — packer usage, mode dispatch table, the `--strict-schema` / `--use-core` flags.
- `framework-detection.md` — reveal / impress / html-ppt-skill / huashu-deckstage / huashu-router signatures.
- `manifest-template.md` — minimal + full manifest examples (pack output samples).
- `@slidestage/spec/README.md` (in the SlideStageLite monorepo) — the format contract itself.
