# 生成你的第一份 `.stage` 演示包

本教程带你把一个最小 HTML deck 打包成 `.stage`，并验证它可以交给 SlideStage Lite 或 SlideStage Pro 使用。

## 前提条件

你需要：

- Node.js 20 或更新版本。
- 已安装 `slidestage-pack`，或正在这个仓库里运行命令。
- 一份 HTML 幻灯片目录。

如果你还没有 deck，可以先创建一个最小示例。

```bash
mkdir my-deck
cat > my-deck/index.html <<'HTML'
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>我的第一份 SlideStage deck</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; background: #0a0a0a; color: #fafafa; }
      .deck { width: 100vw; height: 100vh; }
      .slide { width: 100vw; height: 100vh; display: grid; place-items: center; }
      h1 { font-size: 72px; }
    </style>
  </head>
  <body>
    <div class="deck">
      <section class="slide" data-title="封面">
        <h1>Hello SlideStage</h1>
        <aside class="notes">开场时介绍这是一份最小 .stage 示例。</aside>
      </section>
      <section class="slide" data-title="第二页">
        <h1>第二页</h1>
      </section>
    </div>
  </body>
</html>
HTML
```

## 1. 探测源框架

先让 packer 判断源目录是什么类型。

```bash
node scripts/detect_framework.mjs my-deck
```

对上面的示例，结果应类似：

```json
{
  "kind": "inline-deck",
  "recommendedMode": "split"
}
```

`inline-deck` 表示 packer 识别到了 `<div class="deck">` 和 `<section class="slide">`。`split` 表示它会把每个 slide 拆成独立 HTML 文件。

## 2. 打包为 `.stage`

运行打包命令：

```bash
node scripts/pack_stage.mjs --src my-deck --out my-deck.stage
```

打包器会：

- 读取 `index.html`。
- 拆分每张 slide。
- 生成 `manifest.json`。
- 抽取 speaker notes。
- 固定 zip 时间戳，让相同输入得到稳定指纹。

## 3. 校验产物

每次交付前都应校验 `.stage`。

```bash
node scripts/verify_stage.mjs my-deck.stage
```

校验会检查：

- zip 可解压。
- 根目录存在合法的 `manifest.json`。
- `schema` 等于 `slidestage@1.0`。
- `slides[].file` 指向的文件都存在。
- 路径没有 `..`、绝对路径、反斜杠或控制字符。
- 包大小和 slide 数没有超过限制。

如果校验通过，这个文件就可以进入 SlideStage 生态。

## 4. 播放或上传

你可以选择：

- 把 `my-deck.stage` 拖进 SlideStage Lite 播放。
- 上传到 SlideStage Pro 的 deck 资料库。
- 作为构建产物交给其他人归档或发布。

## 下一步

如果源 deck 是 reveal.js 或 impress.js，默认通常会使用 `wrap` 模式来保留原框架运行时。只有当你明确想让平台逐页管理 slide 时，才考虑 `--mode split`。

如果 deck 依赖外部图片、字体或 CSS，可以在打包后使用 Lite 的 `pnpm mirror` 生成离线包。
