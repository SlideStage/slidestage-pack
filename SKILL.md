---
name: slidestage-pack
description: 把任意 HTML 幻灯片框架（reveal.js / impress.js / html-ppt-skill / huashu-design deck-stage / huashu-design router / plain HTML / 已有 .stage）快速打包为 `.stage` zip 容器（schema=`slidestage@1.0`），可在 SlideStageLite / SlideStagePro 直接播放。**触发词**：打包 slidestage、生成 slidestage、做成 slidestage 包、转 slidestage、deck 打包、deck 上传、上传幻灯片平台、自建幻灯片平台、reveal.js 打包、impress.js 打包、把幻灯片打包成 zip、SlideStage 上传、`.stage`、`pnpm convert`、slides packer、deck pack、pack deck、HTML deck → slidestage。**主干能力**：(1) 双轨打包（优先调 SlideStageLite 仓库的 `pnpm convert pack`，否则用 skill 自带的零依赖 `pack_stage.mjs`）；(2) 6 种框架自动识别（reveal/impress/html-ppt/huashu-deckstage/huashu-router/plain）+ passthrough；(3) byte-reproducible zip（mtime 固定 = manifest.createdAt，确保 sha256 指纹稳定）；(4) 4 种 mode（split/wrap/single/passthrough）的智能选择；(5) 产出校验（manifest schema、路径安全、size 限额、slides 文件齐全）；(6) 可选 thumbnails、speaker-notes 提取、fallback index.html、offline mirror。
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

---

## 5 · 常见陷阱（看到就要修）

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

## 6 · 工具脚本

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

## 7 · 测试样本

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

## 8 · 与 SlideStageLite 的关系

- 本 skill 产出的 `.stage` 必须能被 SlideStageLite 直接加载（loader 路径 = `src/deck/loadDeck.ts`）
- SlideStageLite 自带的 `bin/convert.ts` 是同样的契约更全的实现 —— 在 SlideStageLite 仓库内**优先用它**
- 本 skill 的 `pack_stage.mjs` 是**仓库外**的备选：可独立分发，覆盖 reveal/impress 等 SlideStageLite 暂不识别的框架
- 任何 manifest 字段变更必须先和 `SlideStageLite/docs/FILE_FORMAT.md` 对齐，再来改本 skill

---

## 9 · 不做什么（边界）

- 不接收 PPTX / Keynote / PDF 输入
- 不做服务端转换（永远是本地 CLI）
- 不渲染缩略图除非用户显式 `--thumbnails`
- 不下载外部资源除非用户显式 `--mirror`（用 SlideStageLite 的 `pnpm mirror`）
- 不修改源文件（只读取）
- 不上传到任何平台（用户自己 scp / 拖拽 / 走 CI）
