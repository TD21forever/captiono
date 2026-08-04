# Captiono

Captiono 是一个面向英语视频学习的 Chrome 页面面板产品。首版只
支持 YouTube 和 Bilibili：进入视频页后自动读取平台已有字幕，并在当前标签页右侧
挂载独立的研读面板，把字幕整理成可批注、可复制和可导出的学习文稿。

## 产品能力

- 视频页加载或站内切换视频后自动读取字幕，不需要先点击“读取”。
- 每个视频标签页拥有自己的 Shadow DOM 面板；收起、滚动、搜索和草稿不会串到其他标签页。
- YouTube 读取页面字幕清单和播放器生成的临时字幕资源。
- Bilibili 读取播放器字幕清单和平台提供的字幕 JSON。
- 自动优先选择英语人工字幕，其次选择英语自动字幕。
- 支持多字幕轨切换；手动刷新只用于错误恢复。
- 将字幕片段合并成完整句子，并与当前播放时间联动。
- 一键复制整句，也支持 `⌘/Ctrl + Shift + C`。
- 标记重点表达并显示中文解释。
- 对整句或精确选区添加问题、好表达和笔记线程。
- 按视频保存字幕、收藏和批注。
- 复制研读笔记，或导出 Markdown / JSON 交给任意 AI 继续处理。

## 明确边界

- 不支持 TED 专用文字稿。
- 不提供 SRT、VTT 或 TXT 导入。
- 不捕获标签页音频，也不提供 ASR 转写。
- 不承诺读取没有字幕的视频。
- YouTube 与 Bilibili 的页面内部能力可能改版，需要分别维护 Provider。

## 隐私和权限

- 扩展没有 Captiono 字幕后端。
- 字幕直接来自当前 YouTube 或 Bilibili 页面及其平台接口。
- 不申请 `tabCapture`、麦克风或 `offscreen` 权限。
- 临时签名字幕地址不会写入存储、日志或导出内容。
- 只保存规范化后的字幕、收藏和用户批注。

## 本地运行

```sh
npm install
npm run dev
```

## 构建扩展

```sh
npm run build:extension
```

在 Chrome 的扩展程序页面加载 `dist/extension`。完整验收步骤见
[`INSTALL.md`](./INSTALL.md)，Provider 决策见
[`SUBTITLE-ARCHITECTURE.md`](./SUBTITLE-ARCHITECTURE.md)。

隐私政策见 [`PRIVACY.md`](./PRIVACY.md)，Chrome Web Store 上架文案见
[`STORE_LISTING.md`](./STORE_LISTING.md)。

## 验证

```sh
npm test
npm run build:extension
```

若已启动一个通过 `--load-extension=dist/extension` 加载扩展的隔离 Chrome，并在
`127.0.0.1:9333` 开启 CDP，还可以运行：

```sh
npm run test:extension:cdp
```
