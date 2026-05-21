---
name: slidestage-pack
description: 把任意 HTML 幻灯片框架（reveal.js / impress.js / lewislulu html-ppt-skill / huashu-design deck-stage / huashu-design router / plain HTML / 已有 .stage）快速打包为 `.stage` zip 容器（schema=`slidestage@1.0`），可在 SlideStageLite / SlideStagePro 直接播放。**触发词**：打包 slidestage、生成 slidestage、做成 slidestage 包、转 slidestage、deck 打包、deck 上传、上传幻灯片平台、自建幻灯片平台、reveal.js 打包、impress.js 打包、把幻灯片打包成 zip、SlideStage 上传、`.stage`、`pnpm convert`、slides packer、deck pack、pack deck、HTML deck → slidestage。**主干能力**：(1) 双轨打包（优先调 SlideStageLite 仓库的 `pnpm convert pack`，否则用 skill 自带的零依赖 `pack_stage.mjs`）；(2) 6 种框架自动识别（reveal/impress/html-ppt/huashu-deckstage/huashu-router/plain）+ passthrough；(3) byte-reproducible zip（mtime 固定 = manifest.createdAt，确保 sha256 指纹稳定）；(4) 4 种 mode（split/wrap/single/passthrough）的智能选择；(5) split 模式下保留 `<html>` / `<body>` 全部 attributes（lewislulu deck-scoped CSS 不破坏）+ 自动注入 hide-notes CSS + 含 inline `<script>` 自动写 compat.requires；(6) 6 形态 speaker-notes 抽取（aside / div / template + 3 种 sidecar 路径）；(7) 产出校验（manifest schema、路径安全、size 限额、slides 文件齐全）；(8) 可选 thumbnails、fallback index.html、offline mirror。
---

# slidestage-pack · 把 HTML 幻灯片打包为 .stage

你正在帮用户把一份 HTML 幻灯片（任意框架）打包成 `.stage` 包，供 [SlideStageLite](https://github.com/SlideStage/SlideStageLite) / SlideStagePro 播放。

## 0 · 触发时机

满足下列任一即应用本 skill：

- 用户说「打包成 slidestage / 转 slidestage / 做 .stage 包 / 上传到幻灯片平台」
- 用户已经用 reveal.js / impress.js / html-ppt-skill / huashu-design / 纯 HTML 做完一份 deck，要给别人/平台用
- 用户拿到一个 `.stage` 想重新打包（passthrough/repack）
- 用户问「怎么生成 manifest.json / slidestage@1.0 schema」

**不适用**：用户只想本地双击 HTML 看 demo（直接打开就行）；用户要做的是 PPTX/Keynote/PDF（不在本 skill 范围）。

---

## 1 · 决策树（先确认 5 件事）

```
┌─[Q1]── 用户的源是什么？
│   ├─ 目录 → 走 folder source
│   ├─ 单个 .html → 走 single-file source
│   ├─ .zip → 走 zip source
│   └─ 已有 .stage → 走 passthrough（默认）或 --repack
│
├─[Q2]── 框架是什么？（不确定就跑 detect_framework.mjs）
│   ├─ slidestage@1.0  ─→ passthrough
│   ├─ reveal.js     ─→ 默认 wrap；--mode split 可拆 <section>
│   ├─ impress.js    ─→ 默认 wrap（3D 变换在拆分模式下失效）
│   ├─ html-ppt-skill (inline-deck) ─→ 默认 split
│   ├─ huashu deck-stage (webcomponent) ─→ 默认 split
│   ├─ huashu router (window.DECK_MANIFEST) ─→ 默认 split
│   └─ plain-html    ─→ 默认 single
│
├─[Q3]── 用哪个工具？
│   ├─ 当前在 SlideStageLite 仓库 / 装了 slides-deck-convert CLI
│   │     → 用 `pnpm convert pack ...`（功能最全，含 mirror pass）
│   └─ 其他场景
│         → 用本 skill 的 `scripts/pack_stage.mjs`（零依赖，只需 node + fflate）
│
├─[Q4]── 要 thumbnails 吗？（默认否）
│   ├─ 要 → 需要 playwright (`npm i playwright`)，产出 480×270 PNG
│   └─ 不要 → 跳过，平台端可懒生成
│
└─[Q5]── 要 fallback index.html + presenter_tools.js 吗？（默认否）
    ├─ 要 → 解压后双击 index.html 也能演示（含演示工具栏）
    └─ 不要 → 平台一定能播，文件更小
```

需求模糊（用户没说框架/目标/选项）→ 用 `AskQuestion` 工具或直接问，**不要凭直觉硬选**。

---

## 2 · 主流程（5 步）

```
Task Progress:
- [ ] Step 1: 探测框架 + 确认 mode
- [ ] Step 2: 选打包工具（pnpm convert vs skill 自带）
- [ ] Step 3: 执行打包
- [ ] Step 4: 校验产出包
- [ ] Step 5: 向用户报告（路径、大小、SHA256、slides 数）
```

### Step 1 · 探测框架

```bash
node ~/.agents/skills/slidestage-pack/scripts/detect_framework.mjs <source>
# 输出 JSON：{ kind, rootHtml, hints, recommendedMode }
```

`kind` 取值：`slidestage@1.0` | `reveal` | `impress` | `inline-deck` | `webcomponent-deck` | `router-html` | `plain-html` | `ambiguous` | `empty`

### Step 2 · 选工具

**优先级**（**先 A、再 B**）：

- **A**. 当前在 SlideStageLite 仓库 → `pnpm convert pack <src> --out <out>.stage`
- **B**. 否则用 skill 自带 → `node ~/.agents/skills/slidestage-pack/scripts/pack_stage.mjs --src <src> --out <out>.stage`

判断是否在 SlideStageLite：检查 `package.json` 是否含 `"name": "slidestage-lite"`，或 `bin/convert.ts` 存在。

### Step 3 · 执行打包

#### 方案 A · `pnpm convert pack`（SlideStageLite 内）

```bash
# 自动识别 + 默认模式
pnpm convert pack ./my-deck --out ./my-deck.stage

# 显式模式（split / wrap / single / passthrough）
pnpm convert pack ./my-deck --out ./out.stage --mode wrap

# 元数据覆盖
pnpm convert pack ./my-deck --out ./out.stage \
  --title "Q4 Pitch" --author "Team" --version 1.2.0

# 产出含 Markdown 报告
pnpm convert pack ./my-deck --out ./out.stage --report ./report.md

# 离线包（把所有 https:// 资源内联进 zip）
pnpm mirror ./out.stage -o ./out.offline.stage
```

#### 方案 B · skill 自带 `pack_stage.mjs`（任意项目）

```bash
node ~/.agents/skills/slidestage-pack/scripts/pack_stage.mjs \
  --src ./my-deck \
  --out ./my-deck.stage \
  [--mode split|wrap|single|passthrough] \
  [--title "标题"] [--author "作者"] [--id "slug"] [--version 1.0.0] \
  [--width 1920] [--height 1080] \
  [--thumbnails]    # 需要 playwright
  [--fallback]      # 解压后双击 index.html 即可演讲
  [--strict]        # warnings 视为错误
  [--verbose]
```

**默认行为**：
- byte-reproducible（每文件 mtime 固定为 `manifest.createdAt`，zip 全局 mtime 同源 → `sha256(zip)` 在相同输入下稳定）
- `compat.requires` 自动从源里嗅探（含 `<script>` 的源默认要 `same-origin-storage` + `broadcast-channel` + `window-open`）
- `provenance.sourceKind/conversionMode/converter` 自动填写
- 路径安全（reject `..` / NUL / 绝对路径）

### Step 4 · 校验产出包

**每次打包后必跑**：

```bash
node ~/.agents/skills/slidestage-pack/scripts/verify_stage.mjs ./out.stage
```

检查项（任何一项失败都要修，**不能交付**）：

- [x] 可解压（合法 ZIP）
- [x] 根有 `manifest.json` 且 UTF-8 JSON
- [x] `schema === "slidestage@1.0"`
- [x] 必填字段齐全（`id`, `version`, `title`, `createdAt`, `updatedAt`, `architecture`, `dimensions`, `totalSlides`, `slides[]`）
- [x] `architecture` ∈ `{multi-file, multi-file-flat, single-file-deckstage, single-file-html}`
- [x] 每个 `slides[].file` 在 ZIP 里存在
- [x] 每个 `slides[].thumbnail`（非 null）在 ZIP 里存在
- [x] 所有路径不含 `..` / NUL / 绝对路径
- [x] 大小限额：包 ≤ 200 MB，单文件 ≤ 100 MB，单 slide HTML ≤ 5 MB，manifest ≤ 5 MB，slides ≤ 500 张
- [x] `totalSlides === slides.length`（不等会被 loader 自动修正但应主动对齐）
- [x] `slides[i].index === i + 1`（同上）
- [x] `id` 不含 `/`, `\`, `..`, NUL, 控制符；长度 ≤ 128

### Step 5 · 报告

向用户**简要**输出（不要长 markdown 文档）：

```
✅ Packed: out.stage
   Size:   123.4 KB
   SHA256: abc123…
   Slides: 12
   Source: reveal.js (split mode → 12 slides)
   Thumbnails: skipped
   Warnings: 0
📤 上传到 SlideStagePro 或拖给 SlideStageLite 即可播放
```

---

## 3 · 各框架识别 + 处理矩阵（速查）

| 框架 | 探测签名 | 默认 mode | split 拆分粒度 | 注意事项 |
| --- | --- | --- | --- | --- |
| `slidestage@1.0` | 根有 `manifest.json` 且 schema 匹配 | **passthrough** | — | 只重新打包，保证 byte-reproducible |
| `reveal.js` | `<div class="reveal">` + `<div class="slides">` + script 含 `reveal.js\|reveal.min.js` | **wrap** | 每个 top-level `<section>`（含 vertical stack） | split 模式会丢失 fragment/transition；要保真请用 wrap |
| `impress.js` | `<div id="impress">` + script 含 `impress.js` | **wrap** | 每个 `.step` | split 模式会丢失 3D 变换；强烈建议 wrap |
| `inline-deck`（html-ppt-skill） | `<section class="slide">` × N + `<div class="deck">` 或 script 含 `runtime.js` | **split** | 每个 top-level `<section class="slide">` | 拆分时移除 `runtime.js` / `fx-runtime.js` |
| `webcomponent-deck`（huashu） | 包含 `<deck-stage>` | **split** | 每个 `<deck-slide>` | 移除 `deck-stage.js` + `customElements.define` |
| `router-html`（huashu） | `window.DECK_MANIFEST = [...]` | **split** | 每个 manifest 条目对应文件 | 文件必须是 root HTML 的兄弟/子孙路径 |
| `plain-html` | 单 HTML，不匹配以上 | **single** | — | 含 `<script>` 自动写 `compat.requires` |

**注意**：reveal/impress 不在 `pnpm convert` 的原生识别里。`pnpm convert` 会 fallback 把它们当 `plain-html` → `single` 模式。要把它们识别为 reveal/impress 并显式 wrap，用 skill 自带的 `pack_stage.mjs`。

详细签名 + 拆分细节见 [references/framework-detection.md](references/framework-detection.md)。

---

## 4 · manifest 字段速查（最小合法包）

最小可播放的 manifest（自带脚本会生成更完整版）：

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

可选字段（按需）：
- `compat.requires: ["same-origin-storage"|"broadcast-channel"|"window-open"]` — 需要 loader 弹信任提示
- `compat.notes: string` — 信任提示的人类可读说明
- `provenance.{sourceKind, conversionMode, sourceEntry, converter:{name, version}}` — 转换溯源
- `assets.{totalSize, count, files[]}` — 资源清单
- `runtime.{presenterTools, fallbackEntry, capabilities[]}` — 平台 hint
- `offline.{ready, mirroredAt, mirrorTool, policy, mirroredAssets[], skippedUrls[]}` — 离线镜像审计

完整字段表见 [references/manifest-template.md](references/manifest-template.md)；格式协议规范见 [references/format-spec.md](references/format-spec.md)。

> 注：`slides[].notes` 不需要手填，打包时按 [§5 Speaker Notes 自动识别](#5--speaker-notes-自动识别生成-deck-时按需放置) 的约定从源里自动抽取。

---

## 5 · Speaker Notes 自动识别（生成 deck 时按需放置）

SlideStage 用「约定优于配置」自动识别 speaker notes 并填到 `manifest.slides[].notes`，**不需要作者手写 manifest**。打包工具（`pnpm convert pack` 和本 skill 的 `pack_stage.mjs`）会按下表的优先级查找，**找到第一个非空即停**。

### 5.1 · 四种识别位置（优先级从高到低）

| # | 位置 | 形式 | 适用场景 |
| --- | --- | --- | --- |
| 1 | `speaker-notes/<basename>.md` | zip 根的同名 sidecar | huashu-design 约定，作者偏好分离 notes |
| 2 | `notes/<basename>.md` | zip 根的同名 sidecar | 通用备选 |
| 3 | `<slide-dir>/<basename>.notes.md` | 与 slide 同目录的 `.notes.md` | 多文件 deck（router）每张 slide 一份 |
| 4 | `<aside class="notes">…</aside>` `<aside class="speaker-notes">…</aside>` `<template id="speaker-notes">…</template>` `<template id="notes">…</template>` `<div class="notes">…</div>` `<div class="speaker-notes">…</div>` | 嵌入 slide HTML 内 | reveal.js 原生约定、单 HTML deck、**lewislulu/html-ppt-skill `templates/deck.html` 默认风格** |

**`<basename>` 怎么算？**
- `single` / `wrap` / `passthrough` / `router`：basename = slide 文件的文件名去后缀（`slides/01-cover.html` → `01-cover`）
- `split-inline` / `split-reveal` / `split-impress` / `split-webcomponent`：**合成后**的 slide 文件名去后缀（`01-cover.html` → `01-cover`）。作者若想用 sidecar 触发 split 模式的 notes，需要让 sidecar 名匹配合成规则（`pad2(index)-${slugify(title)}.md`），或者直接把 notes 嵌在源 HTML 里（推荐）。

### 5.2 · 解析规则

- 编码：UTF-8 markdown，CRLF → LF 归一化
- trim 后才判定是否非空
- 上限 `MAX_NOTES_CHARS = 16384`（~16 KB UTF-8）超出截断，防止 manifest 膨胀
- 内联抽取时，HTML 标签 strip，空白折叠，所以 `<aside class="notes"><p>line 1</p><p>line 2</p></aside>` 会变成 `"line 1 line 2"`（如果想保留 markdown 排版，**用 sidecar 写 markdown**）

### 5.3 · 各 mode 的查找路径

| Mode | Sidecar 查找 entries | Inline 查找位置 | 说明 |
| --- | --- | --- | --- |
| `single` | 源 entries | 源 HTML 整体 | rootHtml 单文件 |
| `wrap` | 源 entries | 源 HTML 整体（**只取第一个 aside**） | wrap 只产出 1 张 slide，所以多个内联 aside 只能拿到第一个 |
| `split-*` | 源 entries（按合成 basename） | 合成后的 slide HTML（每张独立） | `extractInlineNotes(generatedPage) ?? findSlideNotes(entries, generatedPath)` |
| `passthrough` | — | — | manifest.slides[].notes 直接保留源文件值（**不会重新抽取**） |

### 5.4 · 给 agent 生成 deck 时的推荐姿势

```
my-deck/
├── index.html                              # reveal/impress/inline-deck/web-component/router 任一
├── slides/                                 # （router 模式）每张 slide 一个 HTML
│   ├── 01-cover.html
│   ├── 01-cover.notes.md                   # ← 推荐 #3 同目录 sidecar
│   ├── 02-content.html
│   └── 02-content.notes.md
└── speaker-notes/                          # ← 或者 #1 集中放在根目录
    ├── 01-cover.md
    └── 02-content.md
```

或者直接嵌在 HTML 里（reveal.js 风格，最少改动）：

```html
<section>
  <h1>Cover</h1>
  <p>Visual content stays here.</p>
  <aside class="notes">
Greet the audience.
Tee up the 3 takeaways.
  </aside>
</section>
```

### 5.5 · 陷阱

- **wrap 模式 + 多 aside**：reveal/impress wrap 只产出 1 张 slide，多个内联 aside 只会拿到第一个。要想每张 slide 都有 notes，用 split 模式或拆成 router。
- **split 模式 inline notes**：从 v0.2 起 `pack_stage.mjs` 会自动在每张拆出 slide 的 head 注入 `<style data-injected-by="slidestage-pack">aside.notes,aside.speaker-notes,div.notes,div.speaker-notes,template#notes,template#speaker-notes{display:none!important}</style>`，**所以观众端不会再看到 notes 块**。无需作者手动加 CSS。
- **`<div class="notes">` 嵌套元素**：notes regex 是 non-greedy，匹配最近一个 `</div>`。lewislulu 默认风格是单段平面文本，匹配 OK；如果你把多个块级元素包在 `<div class="notes">` 里，建议改用 `<aside class="notes">` 或 `<template id="speaker-notes">`，避免被截断。
- **passthrough 不会重新抽取**：repack 一个已有 `.stage` 不会回头扫源 HTML，notes 字段保留原值。要更新 notes 就改源后重 pack。
- **basename 大小写敏感**：`Speaker-Notes/Cover.md` 不匹配 `slides/cover.html`（小写 `speaker-notes/cover.md` 才行）。
- **markdown 渲染**：SlideStageLite PresenterView 当前以纯文本 + 换行展示 notes；内联抽取会丢 markdown 排版。要保留 `**bold**` 等，用 sidecar。

---

## 5.6 · lewislulu/html-ppt-skill 专项兼容性（v0.2 起）

[`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill) 是社区里最常见的 inline-deck 框架（36 themes / 31 layouts / 47 animations / 14 full-deck 模板）。从 v0.2 起 `pack_stage.mjs` 已针对它做了 4 项专属适配：

1. **`<div class="notes">` 抽取**：lewislulu `templates/deck.html` 与 `single-page/cover.html` 用 div 形式，[5.1 表格](#51--四种识别位置优先级从高到低) 已纳入。
2. **`<body class="tpl-XXX">` 保留**：lewislulu 14 个 full-deck 模板（如 `tech-sharing` 36 条 / `presenter-mode-reveal` 45 条 scoped CSS）依赖 body class 做 deck-scoped CSS。split 后每张 slide HTML 的 `<body>` 会**原样保留所有 attribute**，确保 `style.css` 中的 `.tpl-tech-sharing .slide{…}` 选择器仍然匹配。
3. **`<html lang/data-theme/data-themes/data-theme-base>` 保留**：split 后的 `<html>` 标签也会原样保留所有 attribute。
4. **隐藏 notes**：v0.2 起每张拆出 slide 的 head 自动注入 `display:none` 规则，覆盖 aside / div / template 全形式（lewislulu 的 runtime.js 在 split 模式下被剥离，没有它来 hide 这些元素）。

### 5.6.1 · split 模式下 lewislulu 仍然失效的特性（设计取舍）

`runtime.js` / `fx-runtime.js` 在 split 模式下被剥离，所以以下交互**不会工作**（这是 split 模式的固有限制，不是 bug）：

| 失效特性 | lewislulu 用途 | 解决方案 |
| --- | --- | --- |
| `T` 键切主题 | data-themes 主题轮播 | 平台层（SlideStage）的全局主题切换 |
| `S` 键 presenter mode | window.open + BroadcastChannel | 用 SlideStagePro 自带 presenter view |
| `?preview=N` URL 预览 | iframe 单页预览 | 平台层 thumbnail / overview |
| `data-fx="..."` canvas 动画 | 20 个 canvas FX | 录屏 / GIF 替代；或 `--mode wrap` 整页保留 runtime |
| `data-anim="..."` CSS 动画 | 27 个 CSS 入场动画 | **可工作**（CSS 选择器仍匹配，动画在 slide load 时触发一次） |
| highlight.js / chart.js | 代码高亮 / 图表 | inline `<script>` 被保留，CDN 可达即可工作；本地资源用 `--mirror` 离线 |

**结论**：lewislulu deck 的**视觉**在 split 模式下被完整保留（CSS / animations / 字体 / 图片），**交互级**特性需要 wrap 模式或平台层支持。

### 5.6.2 · 推荐打包姿势（lewislulu deck → .stage）

```bash
# 1. 把 lewislulu repo 中的某个 full-deck 模板（如 tech-sharing）拷到独立目录
cp -r html-ppt-skill/templates/full-decks/tech-sharing my-talk/
cp -r html-ppt-skill/assets my-talk/assets

# 2. 修正相对路径（默认是 ../../../assets/，独立目录变成 assets/）
sed -i '' 's|"\.\./\.\./\.\./assets/|"assets/|g' my-talk/index.html

# 3. 打包（默认 split，含全部 v0.2 适配）
node ~/.agents/skills/slidestage-pack/scripts/pack_stage.mjs \
  --src ./my-talk --out ./my-talk.stage

# 4. 校验
node ~/.agents/skills/slidestage-pack/scripts/verify_stage.mjs ./my-talk.stage
```

如果**严重依赖** `data-fx` canvas FX 或 T 键切主题，改用：

```bash
# wrap 模式：整页打包，runtime.js 保留，需要 platform 信任 same-origin-storage / window-open
node pack_stage.mjs --src ./my-talk --out ./my-talk.stage --mode wrap
```

---

## 5.7 · reveal.js 专项兼容性（v0.2 起）

[`hakimel/reveal.js`](https://github.com/hakimel/reveal.js) 是最主流的 HTML 演示框架。本 skill 在 **wrap** 与 **split** 两种模式下均经过 `reveal.js/demo.html`（46 sections / 24 nested verticals / 18 fragments / 20 backgrounds / 5 plugins）压测，重要适配：

1. **`.reveal > .slides` 容器用 balanced 扫描**：v0.2 之前用 non-greedy regex 在第一个 `</div></div>` 提前匹配，demo.html 漏拆 26 张 slide。现已改用 balanced tag scanner，**top-level `<section>` 全数完整识别**。
2. **`<body>` / `<html>` attribute 保留**：与 lewislulu 一致，split 后 `<body data-X>` / `<html lang=…>` 全部保留。
3. **vertical stack 保持原结构**：`<section><section>...</section><section>...</section></section>` 整个外层算 1 张 slide（manifest 是 flat 多文件，没有 parent/child 概念），内部 nested section 完整保留 → reveal.js 在 wrap 模式仍能跑 vertical 导航。
4. **label 推断**：`firstH1Text` 现在依次回退到 `<h2>` / `<h3>`（reveal.js demo 大量用 `<h2>`），split 后 33/34 张 slide 能拿到有意义的 label。
5. **多种 notes 形式**：`<aside class="notes">` / `<aside class="speaker-notes">` / `<template id="speaker-notes">` 全识别；如果作者用 lewislulu cross-style 的 `<div class="notes">` 也能识别。

### 5.7.1 · split 模式下 reveal.js 仍然失效的特性

split 把 `dist/reveal.js` 与 `dist/plugin/*` 全部剥离，所以以下**不会工作**：

| 失效特性 | 原因 | 解决方案 |
| --- | --- | --- |
| `data-markdown` | RevealMarkdown plugin 被剥 | 把 markdown 手动转成 HTML 后再 split；或用 `--mode wrap` |
| `<pre><code data-line-numbers>` step 高亮 | RevealHighlight plugin 被剥 | wrap 模式；或在源 head 引 highlight.js CDN（split 后 CDN 仍可达） |
| `data-background-iframe` / `data-auto-animate` | reveal runtime 才生效 | wrap 模式 |
| `Reveal.initialize({...})` 配置 | inline `<script>` 在 section 外，被剥 | wrap 模式 |
| Fragments（`.fragment`）入场动画 | reveal runtime 才触发 | wrap 模式（CSS 类仍在，但需 runtime 才会逐步显示） |
| Speaker notes plugin（弹窗） | RevealNotes plugin 被剥 | 平台层 PresenterView（manifest.slides[].notes 已正确写入） |

### 5.7.2 · 推荐打包姿势（reveal.js → .stage）

```bash
# 默认 wrap：保留全部 reveal 体验（推荐）
cp -r reveal.js my-talk            # 复制完整 repo（含 dist + plugin）
cp my-talk/demo.html my-talk/index.html
node pack_stage.mjs --src ./my-talk --out ./my-talk.stage
# → 约 2.7 MB（reveal dist + plugin 在内），compat: same-origin-storage + broadcast-channel + window-open

# split：每张 section 独立 HTML，更利于平台层 thumbnail / overview
node pack_stage.mjs --src ./my-talk --out ./my-talk.stage --mode split
# → 失去 fragments / transitions / data-markdown / plugins，但保留视觉结构
```

> **经验**：reveal.js deck **强烈推荐 wrap 模式**，因为 reveal 的核心价值是 fragments / auto-animate / transitions / plugins，split 会全部失效。仅在希望平台 thumbnail/缩略图独立渲染时才用 split。

---

## 6 · 常见陷阱（看到就要修）

| 现象 | 原因 | 修法 |
| --- | --- | --- |
| 同样源每次打包 sha256 都不一样 | 没固定 mtime，zip 元数据漂移 | 用本 skill 的 `pack_stage.mjs`（已固定 mtime）；或在自写代码里把 fflate 的 `mtime` 选项设为 `Date.parse(manifest.createdAt)` |
| Loader 报 `E_PATH_TRAVERSAL` | manifest 里有 `..` 或绝对路径 | 检查 `slides[].file`、`assets.files[].path`，规范化为相对路径 |
| Loader 报 `E_MISSING_SLIDE` | manifest 引用了不存在的 slide 文件 | 跑 `verify_stage.mjs` 提前发现 |
| Loader 警告 `totalSlides !== slides.length` | 拆分后忘了同步 totalSlides | 永远用 `slides.length` 当 totalSlides |
| reveal/impress 进 SlideStageLite 后空白 | 用了 split 但 runtime 没被加载 | 改 `--mode wrap`，loader 会弹信任提示让用户开 `same-origin-storage` 等 |
| `.stage` 大小超 200 MB | 打了过大资源 | 用 `pnpm mirror --max-asset-bytes` 或手动精简 assets |
| 中文/Emoji manifest.id 被拒 | 用了旧的严格 regex | PR-D1 后只禁 `/ \ .. NUL` 控制符，其他 Unicode 都合法 |
| 拆分 inline-deck 后样式丢 | head 没复制 | `pack_stage.mjs` 自动复制整段 head（移除 runtime script） |

---

## 7 · 工具脚本

> 全部脚本都在 `~/.agents/skills/slidestage-pack/scripts/`，可直接 `node <script> --help` 看用法。

| 脚本 | 用途 |
| --- | --- |
| `scripts/detect_framework.mjs` | 探测源框架，输出 JSON。**Step 1 用** |
| `scripts/pack_stage.mjs` | 自带打包脚本，零依赖（只需 node + fflate）。**Step 3 备选** |
| `scripts/verify_stage.mjs` | 校验产出包合规性。**Step 4 必跑** |

依赖安装（自带脚本走 npm 包）：

```bash
# 必需（用于 zip 读写）
npm i -g fflate
# 或在当前项目 npm i fflate

# 可选（生成 thumbnails 时）
npm i -g playwright && npx playwright install chromium
```

脚本设计目标：
- **零网络**：不下载外部资源（除非显式 `--mirror`）
- **可重现**：byte-identical 输入 → byte-identical 输出（sha256 稳定）
- **可读错误**：每个 fail 都给一句话恢复建议
- **可组合**：detect → pack → verify 三段都能单独运行 / piping

---

## 8 · 测试样本

样本在 `~/.agents/skills/slidestage-pack/tests/fixtures/`，每种框架一份最小可识别样本。可作为参考也可作为回归测试。

```bash
# 跑全部 fixture 端到端验证（detect → pack → verify）
node ~/.agents/skills/slidestage-pack/tests/run_tests.mjs
```

新增框架支持时**必须**：
1. 加 `tests/fixtures/<framework>-basic/` 样本
2. `run_tests.mjs` 自动 pick up
3. `detect_framework.mjs` 加签名
4. `pack_stage.mjs` 加 dispatcher

---

## 9 · 与 SlideStageLite 的关系

- 本 skill 产出的 `.stage` 必须能被 SlideStageLite 直接加载（loader 路径 = `src/deck/loadDeck.ts`）
- SlideStageLite 自带的 `bin/convert.ts` 是同样的契约更全的实现 —— 在 SlideStageLite 仓库内**优先用它**
- 本 skill 的 `pack_stage.mjs` 是**仓库外**的备选：可独立分发，覆盖 reveal/impress 等 SlideStageLite 暂不识别的框架
- 任何 manifest 字段变更必须先和 `SlideStageLite/docs/FILE_FORMAT.md` 对齐，再来改本 skill

---

## 10 · 不做什么（边界）

- 不接收 PPTX / Keynote / PDF 输入
- 不做服务端转换（永远是本地 CLI）
- 不渲染缩略图除非用户显式 `--thumbnails`
- 不下载外部资源除非用户显式 `--mirror`（用 SlideStageLite 的 `pnpm mirror`）
- 不修改源文件（只读取）
- 不上传到任何平台（用户自己 scp / 拖拽 / 走 CI）
