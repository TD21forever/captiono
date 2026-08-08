# Captiono Chrome Web Store Listing

## Product name

Captiono

## Summary

在 YouTube 和 Bilibili 字幕中标记重点表达、添加批注，并导出你的英语研读笔记。

## Detailed description

Captiono 把 YouTube 和 Bilibili 当前视频已有的字幕整理成一份可交互的学习文稿。

- 自动读取当前视频已有字幕，无需手动导入。
- 点击时间即可从对应位置继续播放。
- 跟随播放进度；用户手动浏览时暂停自动滚动，完全空闲 8 秒后自动回到当前字幕。
- 标记值得学习的英语短语，并显示中文语境解释。
- 复制选中内容、整句或完整字幕。
- 为句子或精确选区添加批注。
- 复制研读笔记，或将收藏与批注导出为 Markdown / JSON，交给任意 AI 继续学习。
- 支持浅色、深色及跟随系统外观。

Captiono 不录制标签页音频，不使用麦克风，也不提供隐藏的字幕后端。字幕来自当前
YouTube 或 Bilibili 页面及平台字幕接口。学习记录保存在用户本机的 Chrome 扩展存储中。

## Single purpose

帮助用户在 YouTube 和 Bilibili 视频已有字幕中学习语言：查看和定位字幕、标记重点表达、
添加批注，并导出个人学习记录。

## Permission justifications

### storage

在用户本机保存规范化字幕、重点短语、批注和外观设置，使学习进度在重新打开页面后仍可使用。

### scripting

当扩展安装、更新或用户主动点击扩展图标时，在已打开的 YouTube 或 Bilibili 视频标签页中
恢复 Captiono 页面模块。代码仅来自扩展安装包，不执行远程代码。

### Host permissions

- `*.youtube.com`: 读取当前 YouTube 视频的播放器字幕信息并展示页面模块。
- `www.bilibili.com`: 读取当前 Bilibili 视频页面信息并展示页面模块。
- `api.bilibili.com` and `*.hdslb.com`: 读取当前 Bilibili 视频公开提供的字幕清单与字幕文件。

## Data disclosure

Captiono handles website content (video captions and metadata) and user-generated content
(annotations and saved phrases). Processing and storage occur locally on the user's device.
Captiono does not sell data, use it for advertising, or transmit stored learning data to the developer.

## Privacy policy URL

Publish `PRIVACY.md` in the public repository, then use:

https://github.com/TD21forever/captiono/blob/main/PRIVACY.md
