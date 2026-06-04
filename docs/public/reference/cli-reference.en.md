# slidestage-pack CLI Reference

`slidestage-pack` converts HTML decks, HTML files, zips, or existing `.stage` files into verified `.stage` packages.

Recommended flow:

```text
detect -> pack -> verify
```

## detect

```bash
node scripts/detect_framework.mjs <source>
```

Returns the detected `kind`, root HTML, hints, and recommended mode.

## pack

```bash
node scripts/pack_stage.mjs \
  --src ./my-deck \
  --out ./my-deck.stage
```

Common options:

| Option | Purpose |
| --- | --- |
| `--src` | Source folder, HTML, zip, or `.stage`. |
| `--out` | Output `.stage` path. |
| `--mode` | `split`, `wrap`, `single`, or `passthrough`. |
| `--title` | Override manifest title. |
| `--author` | Set manifest author. |
| `--id` | Override manifest id. |
| `--version` | Override manifest version. |
| `--thumbnails` | Generate thumbnails with Playwright. |
| `--fallback` | Add local fallback playback files. |
| `--strict` | Treat warnings as errors. |
| `--strict-schema` | Validate with `@slidestage/spec`. |
| `--use-core` | Delegate to `@slidestage/core/converter`. |

## verify

```bash
node scripts/verify_stage.mjs ./my-deck.stage
```

Verification checks archive structure, manifest fields, paths, slide files, size limits, and slide ordering.

## Modes

- `split`: one HTML file per slide.
- `wrap`: preserve source runtime.
- `single`: plain HTML as one slide.
- `passthrough`: validate/re-emit existing `.stage`.

Use automatic mode unless you know the tradeoff.

## Reporting

After packing, report output path, size, SHA-256, slide count, source kind, mode, and warnings.
