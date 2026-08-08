# Changelog

All notable Captiono changes are documented here.

## v1.6.1 — Interaction and host-page stability / 交互与宿主页面稳定性

### 中文

#### 改进

- 用户手动滚动字幕后进入浏览状态；完全空闲 8 秒后自动回到当前字幕，并保持在列表顶部约三分之一处。
- 鼠标停留、文本选择、批注编辑、搜索或设置期间不会抢夺滚动位置。
- 批注改为紧凑的原位编辑交互，支持点击外部关闭、回车保存，并在原文中显示精确选区标记与批注计数。
- 增强重点短语、本地存储、完整字幕复制及研读笔记导出流程。
- 更新 Captiono 产品图标，在小尺寸下更清晰地表达“选中字幕并添加批注”。
- README 新增真实的批注工作流和“把学习内容交给任意 AI”产品场景。

#### 稳定性与兼容性

- Bilibili 仅在播放器、原生右栏、搜索及个人导航连续稳定后挂载，首次自动挂载保持折叠，避免影响顶部状态栏和推荐内容。
- 修复 Bilibili 站内切换、选集点击、原生分享按钮及推荐视频可能受到扩展事件或布局侵入的问题。
- 修复字幕行、按钮及设置菜单悬浮时的抖动、空面板闪烁与重复刷新。
- 改进 YouTube 临时签名字幕资源、Bilibili 字幕清单及当前媒体身份绑定，避免新视频显示旧字幕。
- 同一视频刷新字幕时保留最后一次成功结果；只有媒体身份改变时才清空旧内容。

### English

#### Improvements

- Manual transcript scrolling enters browse mode; after eight seconds of complete inactivity, Captiono returns the active sentence to roughly the top third of the list.
- Pointer presence, text selection, annotation editing, search, and settings postpone automatic following.
- Annotations now use a compact inline editor with outside-click dismissal, Enter-to-save, exact-range markers, and visible thread counts.
- Improves useful-phrase highlighting, local persistence, full-transcript copy, and study-note exports.
- Introduces a new Captiono icon that keeps the “select captions, then annotate” metaphor legible at small sizes.
- Adds real annotation and bring-your-own-AI workflows to the bilingual README.

#### Stability and compatibility

- Bilibili mounting waits for a continuously stable player, native sidebar, search control, and personal navigation; the first automatic mount stays collapsed to protect the host layout.
- Fixes extension interference with Bilibili in-site navigation, episode selection, share controls, and recommendations.
- Fixes hover jitter, empty-panel flashes, and repeated caption refreshes.
- Strengthens YouTube signed-caption discovery, Bilibili caption manifests, and active-media binding so a new video never shows stale captions.
- Keeps the last successful transcript visible during same-video recovery and clears it only when media identity changes.

## v1.6.0 — First public release / 首个公开版本

### 中文

#### 新功能

- 自动读取 YouTube 和 Bilibili 当前视频已有字幕，并支持站内视频切换。
- 将零散字幕片段整理为可点击时间跳转的连续句子列表。
- 字幕随播放自动滚动；用户手动浏览时暂停跟随，完全空闲 8 秒后自动回到当前字幕，也可随时一键返回。
- 用本地词库与规则标记重点英语表达，并在悬浮时显示中文语境义。
- 支持整句和精确选区批注、表达收藏、全文复制、研读笔记及 Markdown/JSON 导出，可把整理后的学习上下文交给任意 AI 继续分析。
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
- Follows playback automatically, pauses while the learner browses, and returns to the active sentence after eight seconds of complete inactivity or on demand.
- Highlights useful English expressions with a local lexicon and contextual Chinese glosses.
- Supports sentence and exact-selection annotations, saved phrases, full-transcript copy, study notes, and Markdown/JSON exports that can be continued in any AI tool.
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
