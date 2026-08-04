# Changelog

All notable Captiono changes are documented here.

## v1.6.0 — First public release / 首个公开版本

### 中文

#### 新功能

- 自动读取 YouTube 和 Bilibili 当前视频已有字幕，并支持站内视频切换。
- 将零散字幕片段整理为可点击时间跳转的连续句子列表。
- 字幕随播放自动滚动；用户手动浏览时暂停跟随，可一键回到当前字幕。
- 用本地词库与规则标记重点英语表达，并在悬浮时显示中文语境义。
- 支持整句和精确选区批注、表达收藏、全文复制、研读笔记及 Markdown/JSON 导出。
- 支持系统、浅色和深色主题。
- 字幕、收藏、批注和设置按视频保存在 Chrome 本地扩展存储中。

#### 稳定性与兼容性

- YouTube 支持读取页面字幕清单，以及播放器生成的临时签名字幕资源。
- Bilibili 面板严格挂载在原生弹幕列表上方，不遮挡播放器，不侵入右栏顶层结构。
- 修复 Captiono 可能导致 Bilibili 原生顶部内容缺失的问题。
- 修复鼠标悬浮字幕行时面板或宿主右栏颤抖的问题。
- 每个视频标签页维护独立的瞬时状态，避免不同页面共享面板内容。

#### 已知限制

- 仅支持 YouTube 和 Bilibili 已有字幕；不进行音频转写。
- 平台没有提供字幕时，Captiono 无法生成字幕。
- YouTube/Bilibili 页面结构或内部字幕接口变更后，Provider 可能需要更新。

### English

#### New

- Automatically reads existing captions on YouTube and Bilibili, including in-site video navigation.
- Converts fragmented cues into a continuous sentence list with timestamp seeking.
- Follows playback automatically, pauses while the learner browses, and resumes on demand.
- Highlights useful English expressions with a local lexicon and contextual Chinese glosses.
- Supports sentence and exact-selection annotations, saved phrases, full-transcript copy, study notes, and Markdown/JSON exports.
- Supports system, light, and dark appearance modes.
- Stores captions, saved phrases, annotations, and preferences locally, scoped by video.

#### Stability and compatibility

- Reads both YouTube page caption manifests and temporary signed caption resources minted by the player.
- Mounts the Bilibili panel immediately before the native danmaku list without covering the player or restructuring the top-level sidebar.
- Fixes missing native Bilibili header/sidebar content after installing Captiono.
- Fixes panel and host-sidebar jitter while hovering transcript rows.
- Keeps transient state isolated per video tab.

#### Known limitations

- Only existing YouTube and Bilibili captions are supported; Captiono does not transcribe audio.
- Captiono cannot create captions when the platform provides none.
- Provider updates may be required when YouTube or Bilibili changes page structure or internal caption APIs.
