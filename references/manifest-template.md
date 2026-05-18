# Manifest Template

可拷贝即用的 `manifest.json` 模板，按需删字段。`pack_stage.mjs` 自动生成这些字段；本文档供你**手动写** manifest（譬如修复一个 broken deck）或**审计**自动产物时参照。

## A · 最小合法 manifest（multi-file，2 张 slide）

```json
{
  "schema": "slidestage@1.0",
  "id": "my-deck",
  "version": "1.0.0",
  "title": "My Deck",
  "subtitle": null,
  "author": null,
  "description": null,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "architecture": "multi-file",
  "dimensions": { "width": 1920, "height": 1080 },
  "totalSlides": 2,
  "slides": [
    { "index": 1, "id": "cover", "label": "Cover", "file": "slides/01-cover.html", "thumbnail": null, "notes": null },
    { "index": 2, "id": "main",  "label": "Main",  "file": "slides/02-main.html",  "thumbnail": null, "notes": null }
  ]
}
```

## B · 单页 (single-file-html) + 需要信任

```json
{
  "schema": "slidestage@1.0",
  "id": "wrapper-deck",
  "version": "1.0.0",
  "title": "Reveal.js Wrapped Deck",
  "subtitle": null,
  "author": "Your Name",
  "description": "Wrapped reveal.js presentation",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "architecture": "single-file-html",
  "dimensions": { "width": 1920, "height": 1080 },
  "totalSlides": 1,
  "slides": [
    { "index": 1, "id": "root", "label": "Reveal.js Wrapped Deck", "file": "index.html", "thumbnail": null, "notes": null }
  ],
  "compat": {
    "requires": ["same-origin-storage", "broadcast-channel", "window-open"],
    "notes": "reveal.js runtime needs storage + popup to render fragments and present from this iframe."
  },
  "provenance": {
    "sourceKind": "reveal",
    "conversionMode": "wrap",
    "sourceEntry": "index.html",
    "converter": { "name": "slidestage-pack-skill", "version": "0.1.0" }
  }
}
```

## C · 完整字段（含 assets / runtime / platform / stats）

```json
{
  "schema": "slidestage@1.0",
  "id": "fully-decorated-deck",
  "version": "1.2.0",
  "title": "Fully Decorated Deck",
  "subtitle": "All optional fields exemplified",
  "author": "Alice + Bob",
  "description": "Showcase of every optional manifest field.",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-02-15T10:30:00.000Z",
  "architecture": "multi-file",
  "dimensions": { "width": 1920, "height": 1080 },
  "totalSlides": 3,
  "slides": [
    {
      "index": 1,
      "id": "cover",
      "label": "Cover",
      "file": "slides/01-cover.html",
      "thumbnail": "thumbnails/01.png",
      "notes": "Welcome the audience; mention the 3 takeaways.",
      "duration": 90,
      "transition": "fade"
    },
    {
      "index": 2,
      "id": "data",
      "label": "Q4 Data",
      "file": "slides/02-data.html",
      "thumbnail": "thumbnails/02.png",
      "notes": "Walk through the chart left-to-right.",
      "duration": 180
    },
    {
      "index": 3,
      "id": "next",
      "label": "Next steps",
      "file": "slides/03-next.html",
      "thumbnail": "thumbnails/03.png",
      "notes": null
    }
  ],
  "fonts": [],
  "tokens": {},
  "assets": {
    "totalSize": 245312,
    "count": 5,
    "files": [
      { "path": "shared/tokens.css", "size": 1024, "type": "style" },
      { "path": "assets/cover.png",  "size": 102400, "type": "image" },
      { "path": "assets/chart.svg",  "size": 8192,  "type": "image" },
      { "path": "thumbnails/01.png", "size": 44544, "type": "image" },
      { "path": "thumbnails/02.png", "size": 89152, "type": "image" }
    ]
  },
  "runtime": {
    "presenterTools": "platform",
    "fallbackEntry": "index.html",
    "capabilities": ["keyboard-nav", "speaker-notes", "annotation-overlay", "thumbnail-preview"]
  },
  "platform": {
    "minSchemaVersion": "1.0",
    "compatibleArchitectures": ["multi-file"]
  },
  "provenance": {
    "sourceKind": "inline-deck",
    "conversionMode": "split",
    "sourceEntry": "index.html",
    "converter": { "name": "slidestage-pack-skill", "version": "0.1.0" }
  },
  "compat": {
    "requires": [],
    "notes": ""
  },
  "stats": {
    "packedAt": "2026-02-15T10:30:00.000Z",
    "packerVersion": "slidestage-pack-skill@0.1.0"
  }
}
```

## D · `offline`（mirror 后的 manifest）

仅当你跑过 `pnpm mirror` 之类的离线镜像 pass 后才写。schema 见 `format-spec.md § offline`，复杂，**不建议手写**——用 SlideStageLite 的 `pnpm mirror` 生成。

```json
{
  "offline": {
    "ready": true,
    "mirroredAt": "2026-02-15T10:35:00.000Z",
    "mirrorTool": { "name": "slidestage-mirror", "version": "0.1.0" },
    "policy": {
      "includeScripts": false,
      "includeIframes": false,
      "maxAssetBytes": 52428800,
      "maxTotalBytes": 524288000
    },
    "mirroredAssets": [
      {
        "originalUrl": "https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMa1ZL7.woff2",
        "path": "assets/_mirror/font/ab12cd34ef56.woff2",
        "contentHash": "sha256-abcdef…",
        "contentType": "font/woff2",
        "bytes": 18324,
        "fetchedAt": "2026-02-15T10:34:55.000Z",
        "referencedBy": [1, 2, 3]
      }
    ],
    "skippedUrls": [
      { "url": "https://example.com/big.mp4", "reason": "too-large", "detail": "65 MB > 50 MB limit" }
    ]
  }
}
```

## 字段一览（必填 / 可选）

| 字段 | 必填 | 类型 | 备注 |
| --- | :---: | --- | --- |
| `schema` | ✓ | `"slidestage@1.0"` | 严格相等 |
| `id` | ✓ | string | ≤128，禁 `/ \ .. NUL` 控制符 |
| `version` | ✓ | string | 自由格式 |
| `title` | ✓ | string | 自由格式 |
| `subtitle` | ✓ | string \| null | 可写 null |
| `author` | ✓ | string \| null | |
| `description` | ✓ | string \| null | |
| `createdAt` | ✓ | ISO 8601 string | |
| `updatedAt` | ✓ | ISO 8601 string | |
| `architecture` | ✓ | enum (4) | 见 [framework-detection.md](framework-detection.md) |
| `dimensions` | ✓ | `{width,height}` | 正数 |
| `totalSlides` | ✓ | int | = `slides.length` |
| `slides[]` | ✓ | array | 非空 |
| `slides[].index` | ✓ | int | 1..N |
| `slides[].id` | ✓ | string | |
| `slides[].label` | ✓ | string | |
| `slides[].file` | ✓ | string | 包内 relative path |
| `slides[].thumbnail` | ✓ | string \| null | 可写 null |
| `slides[].notes` | ✓ | string \| null | 可写 null |
| `slides[].duration` | ✗ | int (sec) | |
| `slides[].transition` | ✗ | string | |
| `fonts` | ✗ | array | 字体清单 |
| `tokens` | ✗ | object | 设计 token |
| `assets` | ✗ | object | 资源清单 |
| `runtime` | ✗ | object | 平台 hint |
| `platform` | ✗ | object | min schema / arch hints |
| `provenance` | ✗ | object | 转换溯源 |
| `compat` | ✗ | object | 信任提示 |
| `stats` | ✗ | object | packer 元数据 |
| `offline` | ✗ | object | 离线镜像审计 |
