# Captiono 字幕 Provider 架构

更新日期：2026-08-02  
实现版本：1.3.0

## 产品决策

首版只支持 YouTube 和 Bilibili，不建设万能字幕接口，也不使用 TED 文字稿、
字幕文件导入或标签页音频转写扩大表面覆盖率。

正常流程只有一条：

```text
进入支持的视频页
      ↓
自动匹配平台 Provider
      ↓
发现并选择已有字幕轨
      ↓
读取并标准化 CaptionDocument
      ↓
研读、短语解释、批注、复制和导出
```

## Provider Registry

支持页面由 `PLATFORM_PROVIDERS` 匹配：

```text
YouTubeProvider
├── 标准 TextTrack
├── ytInitialPlayerResponse.captionTracks
└── 播放器生成的 timedtext JSON3

BilibiliProvider
├── 标准 TextTrack
├── 页面 aid / cid / bvid
├── /x/player/wbi/v2 字幕清单
└── subtitle_url JSON
```

两站的 TextTrack 和平台能力属于各自 Provider 的读取策略，不是面向用户暴露的
多级 fallback。用户只看到自动读取结果和可选字幕轨。

## 自动触发

Content Script 在以下事件触发读取：

- 首次加载视频页；
- 页面出现或变更 `<video>` / `<track>`；
- TextTrack 轨道增删或 cue 变化；
- YouTube/Bilibili SPA 导航改变媒体 ID；
- 用户手动切换字幕轨；
- 用户选择“重新读取当前字幕”。

展开页面面板不再是首次读取字幕的必要条件。手动刷新仅用于平台请求失败后的恢复。

## YouTube

YouTube 官方 `captions.download` 要求调用者拥有编辑视频的权限，不能下载任意
公开视频，因此扩展读取当前页面播放器已获授权的字幕资源。

对于无需额外播放器签名的字幕，Content Script 直接读取同源 JSON3。对于带短期
签名的字幕，Service Worker 在 MAIN world 执行受限桥接：绑定当前 tab、frame、
video ID、语言和轨道，观察播放器生成的 `/api/timedtext`，读取后立即丢弃 URL。

## Bilibili

Bilibili Provider 从页面状态获取 `aid` / `cid`；取不到时根据 BV 或 episode ID
查询当前视频标识。Service Worker 随后：

1. 请求 `/x/player/wbi/v2`；
2. 读取 `data.subtitle.subtitles`；
3. 优先选择英语人工字幕，其次英语自动字幕；
4. 请求所选 `subtitle_url`；
5. 将 `body[].from/to/content` 标准化为毫秒 cue。

只有 Bilibili API 与字幕 CDN 在 `host_permissions` 中；字幕 URL 必须是 HTTPS，
且域名必须属于 Bilibili 或 hdslb.com。

## 统一数据和来源

所有来源最终进入相同文档模型：

```ts
interface CaptionDocument {
  id: string;
  source:
    | "page-text-track"
    | "youtube-page-manifest"
    | "youtube-player-caption"
    | "bilibili-page-subtitle";
  mediaBinding: {
    provider: "youtube" | "bilibili";
    mediaId: string;
    pageUrl: string;
    title: string;
  };
  language: { code: string; label: string };
  selectedTrackId: string;
  tracks: CaptionTrack[];
  cues: CaptionCue[];
}
```

页面切换后，只有 `provider + mediaId` 与当前视频一致的文档才能显示为实时字幕。

## 权限和隐私

扩展权限限定为 `scripting` 和 `storage`，并只声明 YouTube、Bilibili API 与
字幕 CDN 的 host permissions。产品不使用 Chrome Side Panel；每个视频标签页在
自己的 isolated world 内运行字幕桥接，并挂载一个右侧 Shadow DOM 页面面板。

React UI 与字幕桥接通过同标签页本地订阅通信。扩展按钮只使用
`chrome.action.onClicked` 传入的 `tab.id` 切换该标签页，不查询全局 active tab。
展开/收起、滚动、搜索和未提交草稿属于标签页瞬时状态；持久化数据按文档拆分到
`chrome.storage.local`，避免不同视频并发写回同一份大对象。

明确不申请：

- `tabCapture`；
- `offscreen`；
- 麦克风；
- `<all_urls>`。

临时字幕 URL、Cookie 和原始平台响应不持久化。产品只保存标准化字幕、收藏和
用户批注。

## MVP 验收

- 支持页无需点击“读取”即可开始获取字幕。
- 页面面板自动挂载并直接显示当前结果或短暂加载状态。
- 两个视频标签页各自只有一个 Shadow DOM host，展开、滚动和草稿互不串联。
- YouTube 与 Bilibili 字幕都保留正确来源、语言和媒体 ID。
- 切换视频或分 P 后不会沿用上一视频的实时状态。
- 字幕轨选择、句子跳转、整句复制、批注和 Markdown/JSON 导出形成闭环。
- 无字幕时明确说明，不转写音频，也不要求用户导入文件。
