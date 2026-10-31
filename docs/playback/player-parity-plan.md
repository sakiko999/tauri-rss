# 播放器：B 站网页端对齐计划（P0 起）

> 目标：UI 与交互对齐 B 站网页端播放器（点播为主），**排除**高级弹幕（mode 7/8/9、BAS、
> 代码弹幕）、互动视频、社交与弹幕写操作。工程量与依据见 2026-11-01 调研
> （全量约 130-190 人日；仅「像 B 站」的点播闭环约 72-102 人日）。
> 前置：`docs/ui/design-system-plan.md` 的 F1/F2（浮层原语与边界）。

## 现状（2026-11-01）

已具备：四引擎分发（mp4/HLS/FLV/DASH）、播放/拖拽/缓冲/悬停时间、音量/静音、倍速、
按 resolve 多流切清晰度、全屏、剧场、视频小窗 + 音频迷你条、跨路由不打断、续播、队列
自动下一条、Canvas 弹幕（mode 1-5）、B 站章节、统计信息。

结构性阻碍：`VideoShell` 写死 `PlayerControls`（无插槽）；三套菜单且 Radix Portal 挂
body（**全屏下菜单不可见，现存缺陷**）；`useVideoElement` 4Hz 全树重渲；`PlayableMedia`
8 个 early-return 分支；Audio/Video 两套不对称会话；播放器无自己的 UI 原语与 token。

## 阶段与任务

### P0a 播放器地基（先做，约 6-9 人日）

| ID | 任务 | 验收 |
| --- | --- | --- |
| P0a-1 | `VideoShell` 增加插槽（controls/topBar/overlays），`PlayerControls` 改声明式槽位；大播放键/右键/统计抽成独立组件 | 现有控件与视觉零回归；新增控件只改一处 |
| P0a-2 | `player/ui` 原语 + `getPlayerContainer()`（播放页/小窗/全屏容器）；`PlayerToast` | 全屏下倍速/清晰度/右键菜单与提示可见；host 搬移后仍有效 |
| P0a-3 | `PlayerPrefs`（全局 volume/muted/rate + 按平台 quality；弹幕/字幕样式留 P1） | 换条目不重置音量/倍速；不动 core AppSettings schema |
| P0a-4 | WebView2 能力 spike：画中画、MediaSession/系统媒体键、HEVC/AV1 解码、Fullscreen API 与 Tauri 窗口全屏 | 结论写回本文档；不支持项明确降级，不假装支持 |

### P0b 会话与时间源（约 9-13 人日）

| ID | 任务 | 验收 |
| --- | --- | --- |
| P0b-1 | 媒体状态外置（`useSyncExternalStore` + selector）：进度条/弹幕/波形各自 rAF 订阅，控件树只订阅低频状态 | 播放中控件树不再 4Hz 重渲；弹幕/续播/切档无回归 |
| P0b-2 | `PlayableMedia` 拆 `usePlaybackResolution` / `usePlaybackSession` / `PlayerProvider` + 统一 `MediaController` | 播放/暂停/seek/静音/ended/进度契约不变；音频视频共用 |
| P0b-3 | 播放模式状态机 `normal / wide / web / full / mini`（收编 PlayerPage 的 theater local state） | 模式互斥；Esc 先关浮层再退模式；全屏与小窗不再互相强退 |

### P1 核心交互（约 43-62 人日）

控件栏补齐（时间输入、上一/下一、设置齿轮、字幕、PiP 占位）→ 进度条章节分段与悬停
缩略图 → 设置面板（播放方式/比例/镜像/关灯）→ 弹幕引擎参数化 + 设置/过滤/列表/发送框
→ CC/AI 字幕 → 快捷键全集 + 右键菜单 + OSD + MediaSession → 片尾面板与倒计时 → 续播提示。

### P2 数据型（约 27-40 人日）

`ResolvePlayback` 增加可序列化 sidecar（`playerInfo`：subtitles/preview/pages/related/
online/audioTracks/encoding）；分 P 走「`resolvePlay` 可选 page + 续播键带 page」（不改 XML
契约）；清晰度复合档位 / ABR（需先解决隧道带宽估算）/ VIP 标记；高能进度条；在线人数。
写操作（弹幕发送、进度上报）单开 RPC，凭证只在服务进程。

### P3/P4

PiP、截图、音效、历史弹幕、webmask（可选）；四引擎 × 平台 × 模式矩阵回归、性能预算
（弹幕+字幕+预览同开）、三引擎懒加载（dash/hls/flv 目前静态进首屏 ≈1.55MB）。

## 每个阶段结束都要做

`bun run check`（含 `--layer service`）+ `bun scripts/ui-play-check.ts`（真播）+ 全屏/小窗/
路由切换手测；纯函数（档位键、时间输入、弹幕过滤、prefs 迁移）加 `.check.ts` 并登记。
