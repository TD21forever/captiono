# Captiono

<p align="center">
  <strong>把 YouTube 和 Bilibili 字幕变成可跳转、可标记、可批注的英语学习稿。</strong>
</p>

<p align="center">
  简体中文 · <a href="./README.en.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/TD21forever/captiono/releases/latest"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/TD21forever/captiono?display_name=tag&style=flat-square"></a>
  <img alt="Chrome 139+" src="https://img.shields.io/badge/Chrome-139%2B-4285F4?style=flat-square&logo=googlechrome&logoColor=white">
  <img alt="YouTube and Bilibili" src="https://img.shields.io/badge/Platforms-YouTube%20%7C%20Bilibili-E5483D?style=flat-square">
</p>

<p align="center">
  <img src="./qa/v2/editorial-main-final-480x900.png" width="480" alt="Captiono 字幕学习面板">
</p>

Captiono 是一个嵌入视频页面右栏的 Chrome 扩展。打开带字幕的 YouTube 或
Bilibili 视频后，它会自动读取平台已有字幕，并把字幕整理成紧凑、连续的学习稿。
你可以跟随播放、点击时间跳转、收藏表达、添加批注，并导出 Markdown 或 JSON。

## 功能亮点

- **自动读取字幕**：进入视频或站内切换视频后自动加载，无需先点击“读取”。
- **跟随视频播放**：当前字幕保持在列表上方约三分之一处；手动浏览时暂停跟随，可一键返回当前进度。
- **重点表达**：用本地规则标记值得学习的英语短语，悬浮显示中文语境义。
- **轻量批注**：对整句或精确选区添加待解问题、收藏表达和学习笔记。
- **快速复用**：复制选区、整句、全部字幕或研读笔记，并导出 Markdown / JSON。
- **按视频保存**：字幕、收藏和批注按视频隔离，多个标签页互不覆盖。
- **页面内面板**：作为 YouTube/Bilibili 原生右栏中的独立模块存在，不遮挡播放器和页面控件。
- **浅色与深色主题**：可跟随系统，也可手动切换。

## 安装

Chrome 应用商店版本正在准备中。现在可以从 GitHub Release 安装：

1. 在 [Releases](https://github.com/TD21forever/captiono/releases/latest) 下载 `captiono-1.6.0.zip`。
2. 解压 ZIP。
3. 打开 `chrome://extensions`，启用“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择解压后的 `captiono-1.6.0` 文件夹。
5. 打开一个带字幕的 YouTube 或 Bilibili 视频。

更新已有安装时，请先在扩展卡片上点击刷新，再刷新已经打开的视频页。完整验收步骤见
[INSTALL.md](./INSTALL.md)。

## 支持范围

| 平台 | 字幕来源 | 状态 |
| --- | --- | --- |
| YouTube | 页面字幕清单、播放器生成的临时字幕资源 | 支持 |
| Bilibili | 播放器字幕清单、平台字幕 JSON | 支持 |

Captiono 只读取平台已经提供的字幕。它不捕获标签页音频，不进行 ASR 转写，也不维护
私有字幕库；没有字幕的视频仍然无法生成字幕。Provider 设计与限制见
[SUBTITLE-ARCHITECTURE.md](./SUBTITLE-ARCHITECTURE.md)。

## 隐私

- 没有 Captiono 字幕后端，也不使用分析或广告 SDK。
- 字幕直接来自当前 YouTube/Bilibili 页面及平台字幕接口。
- 字幕、收藏、批注和设置仅保存在 Chrome 本地扩展存储中。
- 不申请 `tabCapture`、麦克风或 `offscreen` 权限。
- 临时签名字幕地址不会写入存储、日志或导出内容。

完整说明见 [PRIVACY.md](./PRIVACY.md)。

## 本地开发

```sh
npm install
npm run dev
```

构建可加载的 Chrome 扩展：

```sh
npm run build:extension
```

构建结果位于 `dist/extension`，发布 ZIP 位于 `dist/captiono-1.6.0.zip`。

## 验证

```sh
npm test
npm run build:extension
```

项目当前包含字幕 Provider、合句、跟随状态、重点短语、批注、存储、导出和扩展打包等
自动化测试。版本更新见 [CHANGELOG.md](./CHANGELOG.md)。

## 反馈

如果某个视频无法读取字幕，或 Captiono 影响了宿主页面布局，请提交
[Issue](https://github.com/TD21forever/captiono/issues)，并附上视频链接、平台和复现截图。
