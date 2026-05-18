# `.stage` Format Cheatsheet


## 容器

- `.stage` 文件 = 标准 ZIP（PK 头）
- 包根必须有 `manifest.json`
- 路径用 `/`，不允许 `..` / 绝对路径 / NUL / 控制符
- 推荐布局：

  ```
  deck.stage
  ├── manifest.json                    # required
  ├── slides/                          # any path is fine — manifest 决定
  │   ├── 01-cover.html
  │   └── 02-content.html
  ├── thumbnails/                      # optional
  │   ├── 01.png
  │   └── 02.png
  ├── shared/tokens.css                # optional shared CSS / fonts
  ├── assets/                          # optional media
  ├── speaker-notes.json               # optional
  ├── index.html                       # optional local fallback (ignored by platform)
  └── presenter_tools.js               # optional local fallback (ignored by platform)
  ```

## Manifest 必填字段

```jsonc
{
  "schema": "slidestage@1.0",                              // 固定值
  "id": "my-deck",                                       // 见下方 id 规则
  "version": "1.0.0",                                    // 自由 string
  "title": "Deck Title",                                 // 自由 string
  "subtitle": null,                                       // string | null
  "author": null,                                         // string | null
  "description": null,                                    // string | null
  "createdAt": "2026-01-01T00:00:00.000Z",               // ISO 8601
  "updatedAt": "2026-01-01T00:00:00.000Z",               // ISO 8601
  "architecture": "multi-file",                          // 枚举见下
  "dimensions": { "width": 1920, "height": 1080 },       // 正数 finite
  "totalSlides": 2,                                       // = slides.length
  "slides": [                                             // 非空数组
    {
      "index": 1,                                         // 1..N 顺序
      "id": "cover",                                      // string
      "label": "Cover",                                   // string
      "file": "slides/01-cover.html",                     // 包内路径
      "thumbnail": null,                                  // string | null
      "notes": null                                       // string | null
    }
  ]
}
```

## `architecture` 枚举

| Value | 含义 | 文件布局 |
| --- | --- | --- |
| `multi-file` | 每页一个 HTML，统一在 `slides/` 下 | `slides/01.html`, `slides/02.html` |
| `multi-file-flat` | 每页一个 HTML，不强制 `slides/` 子目录 | `decks/talk/01.html` |
| `single-file-deckstage` | 整个 deck 是一个 HTML（含 `<deck-stage>`），但 manifest 仍按 slide 切分 | 一个 HTML，被 producer 预拆 |
| `single-file-html` | 单 HTML 当作一张 slide（wrap/single 模式产出） | `index.html` |

## `id` 规则（PR-D1 之后）

- 1 ≤ length ≤ 128 个 Unicode 字符
- 禁止：NUL、`/`、`\\`、`..`、控制符
- 允许：空格、中文、Emoji、标点、大写字母

合法示例：`"my-deck"`, `"Acme Corp — Q4 2026 Pitch (Final)"`, `"项目演示 v2"`

## 可选字段

### `compat.requires` — 触发 SlideStageLite 信任弹窗

```jsonc
"compat": {
  "requires": ["same-origin-storage", "broadcast-channel", "window-open"],
  "notes": "Runtime needs storage + popup to render faithfully"
}
```

`requires` 已知值：
- `same-origin-storage` — localStorage / IndexedDB / cookie
- `broadcast-channel` — 跨 tab 通信
- `window-open` — popup / new tab

未知值会被 loader 静默丢弃。

### `provenance` — 转换溯源

```jsonc
"provenance": {
  "sourceKind": "reveal" | "impress" | "inline-deck" | "webcomponent-deck" | "router-html" | "plain-html",
  "conversionMode": "split" | "wrap" | "single" | "passthrough",
  "sourceEntry": "index.html",
  "converter": { "name": "slidestage-pack-skill", "version": "0.1.0" }
}
```

### `assets` — 资源清单

```jsonc
"assets": {
  "totalSize": 12345,
  "count": 3,
  "files": [
    { "path": "shared/tokens.css", "size": 234, "type": "style" },
    { "path": "assets/cover.png", "size": 10240, "type": "image" }
  ]
}
```

### `runtime` — 平台提示

```jsonc
"runtime": {
  "presenterTools": "platform",            // "platform" | "embedded"
  "fallbackEntry": "index.html" | null,    // 双击演示入口
  "capabilities": ["keyboard-nav", "speaker-notes", "annotation-overlay"]
}
```

### `offline` — 离线镜像审计

完整 schema 见 `FILE_FORMAT.md § offline`。打包脚本不自动写这个字段，需要离线包请用 SlideStageLite 的 `pnpm mirror`。

## Size 限制

| 项 | 上限 |
| --- | --- |
| `.stage` 文件 | 200 MB |
| 解压总大小 | 1 GB |
| 单 entry | 100 MB |
| 单 slide HTML | 5 MB |
| `manifest.json` | 5 MB |
| `slides[]` 长度 | 500 |
| 单 slide 标注 strokes | 2,000 |
| 单 stroke points | 10,000 |

## Loader 容错（不要依赖）

下列两种 manifest 问题被 PR-D1 降级为 warning（loader 自动修正），但**打包脚本必须主动对齐**：
- `totalSlides !== slides.length` → loader 用 `slides.length`
- `slides[i].index !== i + 1` → loader 按数组顺序重编号

## 指纹（Fingerprint）

SlideStageLite 的所有 per-deck 持久化（annotation、notes、trust grants）以 `sha256(zip bytes)` 为 key。

**含义**：byte-identical zip → 同一指纹 → 用户的标注 / 信任授权能跨重打包保留。

**这要求 packer**：
- 固定所有 zip entry 的 mtime（推荐：`Date.parse(manifest.createdAt)`）
- 固定 zip global mtime（fflate 的 `zipSync(files, { mtime })`）
- 用确定性的 entry 排序（按 path 字典序）
- 不写时间戳类字段进 manifest 之外的地方
