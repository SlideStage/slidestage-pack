# HTML Deck 框架识别参考

`slidestage-pack` 会先识别源 deck 类型，再选择推荐打包模式。识别顺序很重要：先命中的规则会决定 `kind`。

## 识别顺序

从高到低：

1. `slidestage@1.0`
2. `webcomponent-deck`
3. `router-html`
4. `reveal`
5. `impress`
6. `inline-deck`
7. `plain-html`

如果没有可用入口，返回 `empty`。如果存在多个可能入口但无法判断 root，返回 `ambiguous`。

## `slidestage@1.0`

命中条件：

- 根目录存在 `manifest.json`。
- `manifest.schema === "slidestage@1.0"`。

推荐模式：`passthrough`。

已有 `.stage` 不应被拆分为其他模式。默认只校验并重新输出，保持格式稳定。

## `webcomponent-deck`

命中条件：

- 根 HTML 包含 `<deck-stage>`。

常见来源：huashu-design 的 Web Component deck。

推荐模式：`split`。

打包器会按 `<deck-slide>` 拆分 slide，并移除平台不需要的 deck-stage runtime。

## `router-html`

命中条件：

- 根 HTML 包含 `window.DECK_MANIFEST = [...]`。

推荐模式：`split`。

每个 manifest entry 对应一个 slide HTML 文件。引用路径必须位于包根之内，不能通过 `../` 跳出。

## `reveal`

命中条件之一：

- HTML 包含 `<div class="reveal">` 和 `<div class="slides">`。
- 脚本引用包含 `reveal.js` 或 `reveal.min.js`。

推荐模式：`wrap`。

原因：reveal.js 的价值通常来自 fragments、transition、auto-animate、插件和 notes runtime。`split` 会丢失这些运行时行为。

只有你明确只需要静态页面，才使用 `--mode split`。

## `impress`

命中条件之一：

- HTML 包含 `<div id="impress">`。
- 脚本引用包含 `impress.js`。

推荐模式：`wrap`。

原因：impress.js 的 3D 摄影机、坐标和 step 变换依赖运行时。`split` 会把它降级为静态文档流。

## `inline-deck`

命中条件之一：

- HTML 包含 `<div class="deck">` 和多个 `<section class="slide">`。
- HTML 包含 `<section class="slide">`，并引用常见 runtime 脚本。

常见来源：html-ppt-skill 或类似 inline HTML deck。

推荐模式：`split`。

每个顶层 `.slide` section 会成为一张独立 slide。打包器会尽量保留 `<html>`、`<body>` attributes 和 head 样式。

## `plain-html`

命中条件：

- 有单个 HTML 入口。
- 不匹配以上任何框架。

推荐模式：`single`。

如果 HTML 中包含脚本，打包器会在 manifest 中声明必要的 `compat.requires`，播放时由 Lite/Pro 请求用户授权。

## Root HTML 查找

当源目录中有多个顶层 HTML 时，按顺序寻找：

1. `index.html`
2. `index.htm`
3. `deck_index.html`
4. `deck_index.htm`
5. `deck.html`
6. `deck.htm`
7. `slides.html`
8. `slide.html`
9. `presentation.html`

如果仍无法确定入口，返回 `ambiguous`，需要用户指定或重命名入口。

## 模式取舍

| 源类型 | 默认模式 | 主要原因 |
| --- | --- | --- |
| `.stage` | `passthrough` | 保持已有格式和 manifest。 |
| huashu webcomponent | `split` | 每张 deck-slide 可独立成为 slide。 |
| huashu router | `split` | 路由清单已经提供 slide 文件。 |
| reveal.js | `wrap` | 保留 reveal runtime。 |
| impress.js | `wrap` | 保留 3D 运行时。 |
| inline deck | `split` | 结构天然按 section 拆分。 |
| plain HTML | `single` | 没有 deck 结构。 |

## 常见误判处理

如果 reveal.js deck 被 split 后动画丢失，重新打包并显式使用：

```bash
node scripts/pack_stage.mjs --src ./deck --out ./deck.stage --mode wrap
```

如果目录中多个 HTML 入口导致 ambiguous，优先把主入口命名为 `index.html`。

如果已有 `.stage` 被识别为普通 zip，检查根目录 `manifest.json` 和 `schema` 字段。
