# slidestage-pack CLI 参考

`slidestage-pack` 把 HTML 幻灯片目录、单文件 HTML、zip 或已有 `.stage` 打包成 SlideStage 可播放的 `.stage` 文件。

推荐流程永远是：

```text
detect -> pack -> verify
```

## detect

探测源目录或文件的框架类型。

```bash
node scripts/detect_framework.mjs <source>
```

输出包含：

- `kind`：识别到的源类型。
- `rootHtml`：入口 HTML。
- `recommendedMode`：推荐打包模式。
- `hints`：辅助说明。

常见 `kind`：

- `slidestage@1.0`
- `reveal`
- `impress`
- `inline-deck`
- `webcomponent-deck`
- `router-html`
- `plain-html`
- `ambiguous`
- `empty`

## pack

打包为 `.stage`。

```bash
node scripts/pack_stage.mjs \
  --src ./my-deck \
  --out ./my-deck.stage
```

常用参数：

| 参数 | 说明 |
| --- | --- |
| `--src <path>` | 源目录、HTML、zip 或 `.stage`。 |
| `--out <path>` | 输出 `.stage` 路径。 |
| `--mode <mode>` | 显式指定 `split`、`wrap`、`single` 或 `passthrough`。 |
| `--title <text>` | 覆盖 manifest title。 |
| `--author <text>` | 写入 manifest author。 |
| `--id <id>` | 覆盖 manifest id。 |
| `--version <version>` | 覆盖 manifest version。 |
| `--width <px>` | 设置逻辑舞台宽度。 |
| `--height <px>` | 设置逻辑舞台高度。 |
| `--thumbnails` | 生成缩略图，需要 Playwright。 |
| `--fallback` | 写入可解压本地播放的 fallback 文件。 |
| `--strict` | warnings 视为错误。 |
| `--strict-schema` | 使用 `@slidestage/spec` 做权威 schema 校验。 |
| `--use-core` | 委托给 `@slidestage/core/converter`。 |

## verify

校验 `.stage` 是否可交付。

```bash
node scripts/verify_stage.mjs ./my-deck.stage
```

校验内容：

- zip 可解压。
- 根目录有 `manifest.json`。
- `schema === "slidestage@1.0"`。
- 必填字段存在。
- slide 文件都存在。
- 路径安全。
- 包大小、单文件大小、slide 数量不超过限制。
- `totalSlides` 与 `slides.length` 一致。
- `slides[].index` 顺序正确。

## 模式选择

| 模式 | 用途 |
| --- | --- |
| `split` | 每张 slide 输出一个独立 HTML，适合结构化 inline deck。 |
| `wrap` | 保留原框架 runtime，适合 reveal.js / impress.js。 |
| `single` | 普通 HTML 作为一张 slide。 |
| `passthrough` | 已有 `.stage` 重新校验/打包。 |

默认使用自动模式。只有你明确知道取舍时才手动覆盖。

## 何时使用 `--use-core`

如果当前环境已经能 import `@slidestage/core`，可以使用：

```bash
node scripts/pack_stage.mjs \
  --src ./my-deck \
  --out ./my-deck.stage \
  --use-core
```

这会让 Pack 复用 Lite/Core 的 converter pipeline，减少行为漂移。

## 何时使用 `--strict-schema`

当你要发布、上传或归档正式 deck 时，建议开启：

```bash
node scripts/pack_stage.mjs \
  --src ./my-deck \
  --out ./my-deck.stage \
  --strict-schema
```

它会使用 `@slidestage/spec` 的 Zod schema 校验最终 manifest。

## 交付报告

每次打包后，向用户报告：

- 输出路径。
- 文件大小。
- SHA-256。
- slide 数量。
- 源框架和模式。
- warnings。

不要交付未校验的 `.stage`。
