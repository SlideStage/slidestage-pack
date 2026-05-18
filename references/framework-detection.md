# Framework Detection Signatures

`detect_framework.mjs` 用下列签名识别源框架。优先级**从上到下**，首个命中即返回。

## 1 · `slidestage@1.0`（passthrough 候选）

| 签名 | 说明 |
| --- | --- |
| 包根存在 `manifest.json` | UTF-8 JSON |
| `manifest.schema === "slidestage@1.0"` | 严格相等 |

**推荐 mode**：`passthrough`（只重新打包，保留原 manifest，确保 sha256 稳定）。  
**强制重打包**：用户传 `--mode split/wrap/single` 时不允许，会报错。

---

## 2 · `webcomponent-deck`（huashu-design）

| 签名 | 说明 |
| --- | --- |
| 根 HTML 含 `<deck-stage>` | 大小写不敏感 |

**额外提取**：
- `<deck-slide>` 数量（拆分粒度）
- `customElements.define('deck-stage'|'deck-slide', ...)` 内联脚本（split 时移除）

**推荐 mode**：`split`（每个 `<deck-slide>` → 一张 slide）。失败 fallback → `wrap`。  
**注意**：拆分时复制整段 head，但移除 `deck-stage.js` 和内联的 `customElements.define`。

---

## 3 · `router-html`（huashu-design）

| 签名 | 说明 |
| --- | --- |
| 根 HTML 含 `window.DECK_MANIFEST = [...]` | 数组字面量，支持 JSON 和 JS-literal（单引号 / 无引号 key / 尾逗号 / 注释）|

**额外提取**：每个条目 `{ file, label }`。

**推荐 mode**：`split`。每个 entry 对应包内已存在的 HTML 文件。  
**注意**：
- 文件必须是根 HTML 的兄弟/子孙路径（不能 `../` 跳出包根）
- 引用的 slide 不存在 → 跳过 + warning
- 全部都找不到 → fallback `wrap`

---

## 4 · `reveal`（reveal.js）

| 签名（任一即可） | 说明 |
| --- | --- |
| 含 `<div class="reveal">` + `<div class="slides">` | 标准 reveal 容器 |
| `<script src="...reveal[.min].js">` | 加载 reveal runtime |

**推荐 mode**：`wrap`（保留所有 fragments / transitions / themes）。  
**`split` 备选**：拆 `.reveal > .slides > section`，包括 vertical stack `<section><section>...</section></section>`。
- **代价**：fragments、transitions、speaker notes 全失效。
- **使用场景**：只想要静态画面，不在意 reveal 的运行时特性。

---

## 5 · `impress`（impress.js）

| 签名（任一即可） | 说明 |
| --- | --- |
| `<div id="impress">` | 标准 impress 容器 |
| `<script src="...impress[.min].js">` | 加载 impress runtime |

**推荐 mode**：`wrap`（保留 3D 摄影机、step 数据属性、API hooks）。  
**`split` 备选**：拆 `.step`，每个 step 独立成页。
- **代价**：3D 变换、`data-x/y/z/rotate/scale` 失效（变成静态文档流）。
- **使用场景**：只要内容、不要 impress 那些花哨变换。

---

## 6 · `inline-deck`（html-ppt-skill）

| 签名（任一即可） | 说明 |
| --- | --- |
| `<section class="slide">` + `<div class="deck">` | 标志性容器 |
| `<section class="slide">` + `<script src="*runtime.js">` | runtime 管理的 deck |

**额外提取**：
- top-level `<section class="slide">` 数量
- `runtime.js` / `fx-runtime.js` 脚本（split 时移除）

**推荐 mode**：`split`（每个 `<section class="slide">` → 一张 slide）。失败 fallback → `wrap`。  
**注意**：
- 嵌套 `<section>` 用 balanced-tag 扫描器跟踪，nested section 算成一张 slide
- `data-title` > `<h1>` 文本 > `Slide N` 决定 label

---

## 7 · `plain-html`（兜底）

任何单 HTML 不匹配以上 6 种 → `plain-html`。

**推荐 mode**：`single`（整个 HTML 作为一张 slide）。  
**自动行为**：如果含 `<script>` 标签，自动写 `compat.requires = ["same-origin-storage", "broadcast-channel"]`，loader 会弹信任提示让用户开权限。

---

## Edge cases

| 现象 | kind | 处理 |
| --- | --- | --- |
| 多个 top-level HTML 且无 `index.html` / `deck.html` 等 | `ambiguous` | 报错，要求改名或单文件 |
| 既无 HTML 又无 `manifest.json` | `empty` | 报错 |
| 根目录有 `manifest.json` 但 schema 不是 `slidestage@1.0` | 走到下一条 sniff | warning |
| HTML 同时含 `<deck-stage>` 和 `class="reveal"` | `webcomponent-deck` | 优先级在前 |
| HTML 同时含 `window.DECK_MANIFEST` 和 `<deck-stage>` | `webcomponent-deck` | deck-stage 优先 |
| HTML 含 reveal class 但 script 是空的 | `reveal` | 只要满足任一 reveal 签名就算 |

## Root HTML 识别

当包内有多个 top-level HTML 时，按下面顺序找 root：

1. `index.html` / `index.htm`
2. `deck_index.html` / `deck_index.htm`
3. `deck.html` / `deck.htm`
4. `slides.html` / `slide.html`
5. `presentation.html`

都没有就报 `ambiguous`。

## 测试样本

每种 kind 都有最小可识别样本在 `~/.agents/skills/slidestage-pack/tests/fixtures/`。`run_tests.mjs` 跑全套回归。新加 kind 必须：

1. 加 `tests/fixtures/<kind>-basic/` 样本
2. `detect_framework.mjs` 加签名
3. `pack_stage.mjs` 加 split 分支（或显式标记 wrap-only）
4. `run_tests.mjs` 自动 pick up
